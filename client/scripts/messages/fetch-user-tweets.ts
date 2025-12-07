import "dotenv/config";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { MessageFetchWorkerConfig, TweetRecord, TweetsResponse } from "./types";

interface SQLClient {
  query: (
    query: string,
    params?: unknown[]
  ) => Promise<
    Array<Record<string, unknown>> | { rows?: Array<Record<string, unknown>> }
  >;
}

const WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_REQUESTS_PER_WINDOW = 10_000; // Align with new 10k / 15 min ceiling
const MAX_RESULTS_PER_PAGE = 100;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 15_000;
const DEFAULT_MAX_TWEETS_PER_USER = 25;
const DEFAULT_MAX_USERS_PER_RUN = 200;

type UserTarget = {
  id: number;
  xUserId: string;
  xUsername: string | null;
};

function toRows<T extends Record<string, unknown>>(
  payload:
    | Array<Record<string, unknown>>
    | { rows?: Array<Record<string, unknown>> }
): T[] {
  return Array.isArray(payload)
    ? (payload as T[])
    : ((payload.rows ?? []) as T[]);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeShardKey(
  workerIndex: number,
  workerTotal: number,
  apiKeyAlias?: string
) {
  const base = `worker-${workerIndex + 1}-of-${workerTotal}`;
  return apiKeyAlias ? `${apiKeyAlias}:${base}` : base;
}

async function fetchTweetsPage(
  bearerToken: string,
  xUserId: string,
  paginationToken?: string,
  attempt = 0
): Promise<TweetsResponse> {
  const url = new URL(`https://api.x.com/2/users/${xUserId}/tweets`);
  url.searchParams.set("max_results", String(MAX_RESULTS_PER_PAGE));
  url.searchParams.set(
    "tweet.fields",
    [
      "created_at",
      "lang",
      "public_metrics",
      "conversation_id",
      "in_reply_to_user_id",
      "referenced_tweets",
    ].join(",")
  );

  if (paginationToken) {
    url.searchParams.set("pagination_token", paginationToken);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 429) {
    if (attempt >= MAX_RETRIES) {
      throw new Error("Exceeded rate-limit retry attempts");
    }
    const retryAfter = response.headers.get("Retry-After");
    const waitTime = retryAfter
      ? Number(retryAfter) * 1000
      : BASE_BACKOFF_MS * (attempt + 1);
    console.warn(
      `  ⚠ Rate limit hit while fetching tweets for ${xUserId}, sleeping ${
        waitTime / 1000
      }s (attempt ${attempt + 1}/${MAX_RETRIES})`
    );
    await delay(waitTime);
    return fetchTweetsPage(bearerToken, xUserId, paginationToken, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to fetch tweets for ${xUserId}: ${response.status} - ${text || "Unknown error"}`
    );
  }

  return (await response.json()) as TweetsResponse;
}

async function upsertTweets(
  sql: SQLClient,
  user: UserTarget,
  tweets: TweetRecord[]
) {
  if (tweets.length === 0) {
    return 0;
  }

  const columns = [
    '"tweet_id"',
    '"user_id"',
    '"x_user_id"',
    '"text"',
    '"lang"',
    '"like_count"',
    '"reply_count"',
    '"repost_count"',
    '"quote_count"',
    '"tweet_created_at"',
    '"conversation_id"',
    '"in_reply_to_user_id"',
    '"referenced_tweet_id"',
    '"raw_payload"',
  ];

  const values: unknown[] = [];
  const valueStrings = tweets.map((tweet, index) => {
    const baseIdx = index * columns.length;
    const referencedTweetId = tweet.referenced_tweets?.[0]?.id ?? null;
    const createdAtIso = tweet.created_at
      ? new Date(tweet.created_at).toISOString()
      : new Date().toISOString();

    values.push(
      tweet.id,
      user.id,
      user.xUserId,
      tweet.text,
      tweet.lang ?? null,
      tweet.public_metrics?.like_count ?? 0,
      tweet.public_metrics?.reply_count ?? 0,
      tweet.public_metrics?.retweet_count ?? 0,
      tweet.public_metrics?.quote_count ?? 0,
      createdAtIso,
      tweet.conversation_id ?? null,
      tweet.in_reply_to_user_id ?? null,
      referencedTweetId,
      JSON.stringify(tweet)
    );

    const placeholders = columns
      .map((_, colIdx) => `$${baseIdx + colIdx + 1}`)
      .join(", ");

    return `(${placeholders})`;
  });

  const query = `
    INSERT INTO "messages" (${columns.join(", ")})
    VALUES ${valueStrings.join(", ")}
    ON CONFLICT ("tweet_id") DO UPDATE SET
      "text" = EXCLUDED."text",
      "lang" = EXCLUDED."lang",
      "like_count" = EXCLUDED."like_count",
      "reply_count" = EXCLUDED."reply_count",
      "repost_count" = EXCLUDED."repost_count",
      "quote_count" = EXCLUDED."quote_count",
      "tweet_created_at" = EXCLUDED."tweet_created_at",
      "conversation_id" = EXCLUDED."conversation_id",
      "in_reply_to_user_id" = EXCLUDED."in_reply_to_user_id",
      "referenced_tweet_id" = EXCLUDED."referenced_tweet_id",
      "raw_payload" = EXCLUDED."raw_payload",
      "fetched_at" = NOW(),
      "embeddedAt" = CASE WHEN "messages"."text" <> EXCLUDED."text" THEN NULL ELSE "messages"."embeddedAt" END,
      "embedding_error" = CASE WHEN "messages"."text" <> EXCLUDED."text" THEN NULL ELSE "messages"."embedding_error" END,
      "embedding_version" = CASE WHEN "messages"."text" <> EXCLUDED."text" THEN NULL ELSE "messages"."embedding_version" END
  `;

  await sql.query(query, values);
  return tweets.length;
}

async function markProgress(
  sql: SQLClient,
  userId: number,
  shardKey: string,
  status: string,
  updates: {
    totalFetchedDelta?: number;
    newestId?: string;
    oldestId?: string;
    hadFullSync?: boolean;
    error?: string | null;
    runStarted?: boolean;
  } = {}
) {
  const query = `
    INSERT INTO "message_fetch_progress" (
      "user_id",
      "shard_key",
      "status",
      "total_fetched",
      "newest_tweet_id",
      "oldest_tweet_id",
      "last_run_started_at",
      "last_run_finished_at",
      "last_error",
      "initial_sync_complete",
      "updatedAt"
    )
    VALUES (
      $1, $2, $3,
      $4,
      $5,
      $6,
      CASE WHEN $7 THEN NOW() ELSE NULL END,
      CASE WHEN $8 THEN NOW() ELSE NULL END,
      $9,
      $10,
      NOW()
    )
    ON CONFLICT ("user_id") DO UPDATE SET
      "shard_key" = EXCLUDED."shard_key",
      "status" = EXCLUDED."status",
      "total_fetched" = "message_fetch_progress"."total_fetched" + EXCLUDED."total_fetched",
      "newest_tweet_id" = COALESCE(EXCLUDED."newest_tweet_id", "message_fetch_progress"."newest_tweet_id"),
      "oldest_tweet_id" = COALESCE(EXCLUDED."oldest_tweet_id", "message_fetch_progress"."oldest_tweet_id"),
      "last_run_started_at" = COALESCE(EXCLUDED."last_run_started_at", "message_fetch_progress"."last_run_started_at"),
      "last_run_finished_at" = COALESCE(EXCLUDED."last_run_finished_at", "message_fetch_progress"."last_run_finished_at"),
      "last_error" = EXCLUDED."last_error",
      "initial_sync_complete" = "message_fetch_progress"."initial_sync_complete" OR EXCLUDED."initial_sync_complete",
      "updatedAt" = NOW()
  `;

  await sql.query(query, [
    userId,
    shardKey,
    status,
    updates.totalFetchedDelta ?? 0,
    updates.newestId ?? null,
    updates.oldestId ?? null,
    updates.runStarted ?? false,
    status === "idle" || status === "error",
    updates.error ?? null,
    updates.hadFullSync ?? false,
  ]);
}

export async function runMessageFetchWorker(config: MessageFetchWorkerConfig) {
  const {
    databaseUrl,
    bearerToken,
    workerIndex,
    workerTotal,
    apiKeyAlias,
    shardKey: providedShardKey,
    requestsPer15Minutes = DEFAULT_REQUESTS_PER_WINDOW,
    maxPagesPerUser,
    maxUsersPerRun = DEFAULT_MAX_USERS_PER_RUN,
    maxTweetsPerUser = DEFAULT_MAX_TWEETS_PER_USER,
  } = config;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!bearerToken) {
    throw new Error("X API bearer token is required");
  }
  if (workerIndex < 0 || workerIndex >= workerTotal) {
    throw new Error("workerIndex must be within [0, workerTotal)");
  }

  const shardKey =
    providedShardKey ??
    normalizeShardKey(workerIndex, workerTotal, apiKeyAlias);
  const requestIntervalMs = Math.max(
    1000,
    Math.ceil(WINDOW_MS / Math.max(1, requestsPer15Minutes))
  );

  const sql = neon(databaseUrl) as SQLClient;

  const usersQuery = `
    SELECT "id", "xUserId", "xUsername"
    FROM "users"
    WHERE "xUserId" IS NOT NULL
      AND MOD("id", $1) = $2
    ORDER BY "id"
  `;

  const userRows = toRows<UserTarget>(
    await sql.query(usersQuery, [workerTotal, workerIndex])
  );

  const targets = userRows.slice(0, maxUsersPerRun);

  if (targets.length === 0) {
    console.log(
      `[${shardKey}] No users assigned to this shard (index ${workerIndex}/${workerTotal})`
    );
    return;
  }

  console.log(
    `[${shardKey}] Processing ${targets.length} users (rate limit: ${requestsPer15Minutes} req/15m, interval ${requestIntervalMs}ms)`
  );

  let lastRequestTime = 0;
  let totalRequests = 0;

  const waitForSlot = async () => {
    const now = Date.now();
    const earliest = lastRequestTime + requestIntervalMs;
    if (earliest > now) {
      await delay(earliest - now);
    }
    lastRequestTime = Date.now();
  };

  for (const target of targets) {
    if (!target.xUserId) {
      continue;
    }

    console.log(
      `\n[${shardKey}] Fetching tweets for @${target.xUsername ?? target.xUserId} (user ${target.id})`
    );

    await markProgress(sql, target.id, shardKey, "running", {
      runStarted: true,
      error: null,
    });

    let paginationToken: string | undefined;
    let page = 0;
    let fetchedForUser = 0;
    let newestId: string | undefined;
    let oldestId: string | undefined;
    let completedFullHistory = false;
    let hadError = false;

    try {
      while (true) {
        if (maxPagesPerUser && page >= maxPagesPerUser) {
          console.log(
            `  • Reached max pages (${maxPagesPerUser}) for @${target.xUsername ?? target.xUserId}`
          );
          break;
        }
        if (maxTweetsPerUser && fetchedForUser >= maxTweetsPerUser) {
          console.log(
            `  • Reached max tweets (${maxTweetsPerUser}) for @${target.xUsername ?? target.xUserId}`
          );
          break;
        }

        await waitForSlot();
        totalRequests += 1;
        page += 1;

        const response = await fetchTweetsPage(
          bearerToken,
          target.xUserId,
          paginationToken
        );
        const tweets = response.data ?? [];
        paginationToken = response.meta?.next_token;

        if (tweets.length === 0) {
          console.log(`  • Page ${page}: no tweets returned`);
        } else {
          console.log(
            `  • Page ${page}: fetched ${tweets.length} tweets (next token: ${
              paginationToken ? "yes" : "no"
            })`
          );
          const inserted = await upsertTweets(sql, target, tweets);
          fetchedForUser += inserted;
          newestId = newestId ?? response.meta?.newest_id ?? tweets[0]?.id;
          oldestId = response.meta?.oldest_id ?? tweets.at(-1)?.id ?? oldestId;
        }

        if (!paginationToken) {
          completedFullHistory = true;
          break;
        }
      }
    } catch (error) {
      hadError = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `  ✗ Failed while fetching tweets for @${target.xUsername ?? target.xUserId}: ${message}`
      );
      await markProgress(sql, target.id, shardKey, "error", {
        totalFetchedDelta: fetchedForUser,
        newestId,
        oldestId,
        error: message,
        hadFullSync: completedFullHistory,
      });
      continue;
    }

    await markProgress(sql, target.id, shardKey, hadError ? "error" : "idle", {
      totalFetchedDelta: fetchedForUser,
      newestId,
      oldestId,
      error: hadError ? "unknown error" : null,
      hadFullSync: completedFullHistory,
    });

    console.log(
      `  ✓ Stored ${fetchedForUser} tweets for @${target.xUsername ?? target.xUserId} (${page} pages)`
    );
  }

  console.log(
    `\n[${shardKey}] Completed run across ${targets.length} users. API calls made: ${totalRequests}`
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const databaseUrl = process.env.DATABASE_URL;
  const bearerToken = process.env.X_API_BEARER_TOKEN;
  const workerIndex = Number(process.env.MESSAGE_WORKER_INDEX || 0);
  const workerTotal = Number(process.env.MESSAGE_WORKER_TOTAL || 1);
  const apiKeyAlias = process.env.MESSAGE_API_KEY_ALIAS;
  const shardKey = process.env.MESSAGE_SHARD_KEY;
  const requestsPer15Minutes = process.env.X_TWEETS_REQS_PER_15M
    ? Number(process.env.X_TWEETS_REQS_PER_15M)
    : undefined;
  const maxPagesPerUser = process.env.MESSAGE_MAX_PAGES
    ? Number(process.env.MESSAGE_MAX_PAGES)
    : undefined;
  const maxUsersPerRun = process.env.MESSAGE_MAX_USERS
    ? Number(process.env.MESSAGE_MAX_USERS)
    : undefined;
  const maxTweetsPerUser = process.env.MESSAGE_MAX_TWEETS
    ? Number(process.env.MESSAGE_MAX_TWEETS)
    : undefined;

  runMessageFetchWorker({
    databaseUrl: databaseUrl ?? "",
    bearerToken: bearerToken ?? "",
    workerIndex,
    workerTotal,
    shardKey,
    apiKeyAlias,
    requestsPer15Minutes,
    maxPagesPerUser,
    maxUsersPerRun,
    maxTweetsPerUser,
  })
    .then(() => {
      console.log("Message fetch worker completed.");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Message fetch worker failed:", error);
      process.exit(1);
    });
}
