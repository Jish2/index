/**
 * Collects all first-degree followings for the base user set and stores their
 * usernames in a JSON batch file. The output is later consumed by
 * ingest-first-degree.ts.
 *
 * Required env vars:
 * - DATABASE_URL
 * - X_API_BEARER_TOKEN
 *
 * Optional knobs:
 * - FIRST_DEGREE_OUTPUT_PATH (defaults to client/data/first-degree-following.json)
 * - X_FOLLOWING_REQS_PER_15M (defaults to 15 to respect Basic tier limits)
 *
 * Rate limits:
 * GET /2/users/:id/following caps at 15 requests / 15 min on the Basic plan,
 * so this script enforces an interval derived from that ceiling.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { SQLClient } from "./lib/x-ingest";

type BaseUser = {
  id: number;
  name: string;
  email: string;
  xUserId: string;
};

interface FollowingEdge {
  followerDbId: number;
  followerXUserId: string;
  followingUsername: string;
}

interface FollowingUser {
  id: string;
  username: string;
}

interface FollowingResponse {
  data?: FollowingUser[];
  meta?: {
    next_token?: string;
    result_count?: number;
  };
  errors?: Array<{ code?: number; message?: string }>;
}

const OUTPUT_PATH =
  process.env.FIRST_DEGREE_OUTPUT_PATH ||
  path.join(process.cwd(), "client", "data", "first-degree-following.json");

const REQUESTS_PER_WINDOW = Number(process.env.X_FOLLOWING_REQS_PER_15M || 15);
const WINDOW_MS = 15 * 60 * 1000;
const REQUEST_INTERVAL_MS = Math.ceil(WINDOW_MS / REQUESTS_PER_WINDOW);
const MAX_FOLLOWING_RESULTS = 1000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 10_000;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFollowingPage(
  bearerToken: string,
  userId: string,
  paginationToken?: string,
  attempt = 0
): Promise<FollowingResponse> {
  const url = new URL(`https://api.x.com/2/users/${userId}/following`);
  url.searchParams.set("max_results", String(MAX_FOLLOWING_RESULTS));
  url.searchParams.set("user.fields", "id,username");
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
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    const retryAfter = response.headers.get("Retry-After");
    const waitTime = retryAfter
      ? Number(retryAfter) * 1000
      : BASE_BACKOFF_MS * (attempt + 1);
    console.warn(
      `  ⚠ Rate limited while fetching followings for ${userId}. Waiting ${Math.round(
        waitTime / 1000
      )}s (attempt ${attempt + 1}/${MAX_RETRIES})`
    );
    await delay(waitTime);
    return fetchFollowingPage(
      bearerToken,
      userId,
      paginationToken,
      attempt + 1
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to fetch followings for ${userId}: ${response.status} - ${text || "Unknown error"}`
    );
  }

  const data = (await response.json()) as FollowingResponse;
  if (data.errors && data.errors.length > 0) {
    const msg = data.errors
      .map((err) => err.message ?? "Unknown error")
      .join("; ");
    throw new Error(`X API returned errors for ${userId}: ${msg}`);
  }

  return data;
}

async function collectFirstDegreeFollowings() {
  const databaseUrl = process.env.DATABASE_URL;
  const bearerToken = process.env.X_API_BEARER_TOKEN;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  if (!bearerToken) {
    throw new Error("X_API_BEARER_TOKEN environment variable is not set");
  }
  if (REQUESTS_PER_WINDOW <= 0) {
    throw new Error("X_FOLLOWING_REQS_PER_15M must be greater than 0");
  }

  const sql = neon(databaseUrl) as SQLClient;

  const baseUsersQuery = `
    SELECT "id", "name", "email", "xUserId"
    FROM "users"
    WHERE "isBaseUser" = true
      AND "xUserId" IS NOT NULL
    ORDER BY "id"
  `;

  const rawBaseUsers = await sql.query(baseUsersQuery);
  const baseUsers: BaseUser[] = Array.isArray(rawBaseUsers)
    ? (rawBaseUsers as BaseUser[])
    : ((rawBaseUsers.rows ?? []) as BaseUser[]);

  if (baseUsers.length === 0) {
    console.log("No base users with X user IDs found. Nothing to collect.");
    return;
  }

  const existingUsersQuery = `
    SELECT DISTINCT COALESCE(NULLIF("xUsername", ''), NULLIF("twitter", '')) AS "username"
    FROM "users"
    WHERE "xUsername" IS NOT NULL OR "twitter" IS NOT NULL
  `;
  const rawExisting = await sql.query(existingUsersQuery);
  const existingRowsRaw = Array.isArray(rawExisting)
    ? rawExisting
    : (rawExisting.rows ?? []);
  const existingRows = existingRowsRaw as Array<{ username: string | null }>;

  const existingUsernames = new Set(
    existingRows
      .map((row) => row.username)
      .filter((username): username is string => Boolean(username))
      .map((username) => username.toLowerCase())
  );

  const collectedUsernames = new Set<string>();
  const edges: FollowingEdge[] = [];
  const edgeDedup = new Set<string>();

  let totalRequests = 0;
  let totalFollowings = 0;

  console.log(
    `Collecting followings for ${baseUsers.length} base users. Interval ${REQUEST_INTERVAL_MS}ms per request.`
  );

  for (const baseUser of baseUsers) {
    console.log(
      `\nFetching followings for ${baseUser.name} (${baseUser.xUserId})`
    );
    if (!baseUser.xUserId) {
      console.warn("  ⚠ Skipping due to missing xUserId");
      continue;
    }

    let paginationToken: string | undefined;
    let page = 0;

    while (true) {
      await delay(REQUEST_INTERVAL_MS);
      totalRequests += 1;
      page += 1;

      try {
        const response = await fetchFollowingPage(
          bearerToken,
          baseUser.xUserId,
          paginationToken
        );

        const users = response.data ?? [];
        paginationToken = response.meta?.next_token;

        if (users.length === 0) {
          console.log(`  • Page ${page}: no followings returned`);
        } else {
          console.log(`  • Page ${page}: received ${users.length} followings`);
        }

        for (const follower of users) {
          totalFollowings += 1;
          if (!follower.username) {
            continue;
          }

          const normalized = follower.username.toLowerCase();

          const edgeKey = `${baseUser.id}:${normalized}`;
          if (!edgeDedup.has(edgeKey)) {
            edges.push({
              followerDbId: baseUser.id,
              followerXUserId: baseUser.xUserId,
              followingUsername: follower.username,
            });
            edgeDedup.add(edgeKey);
          }

          if (existingUsernames.has(normalized)) {
            continue;
          }
          if (collectedUsernames.has(normalized)) {
            continue;
          }
          collectedUsernames.add(normalized);
        }

        if (!paginationToken) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ Failed on page ${page}: ${message}`);
        break;
      }
    }
  }

  const finalList = Array.from(collectedUsernames).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUsersProcessed: baseUsers.length,
    totalApiRequests: totalRequests,
    totalFollowingsFetched: totalFollowings,
    uniqueNewUsernames: finalList.length,
    edgeCount: edges.length,
    usernames: finalList,
    edges,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log(`\nSaved ${finalList.length} unique usernames to ${OUTPUT_PATH}`);
}

collectFirstDegreeFollowings()
  .then(() => {
    console.log("\nDone collecting first-degree followings.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to collect first-degree followings:", error);
    process.exit(1);
  });
