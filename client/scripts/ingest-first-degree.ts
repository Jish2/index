/**
 * Reads the collected first-degree usernames JSON file, fetches full profiles
 * from X, inserts/updates rows in the users table, and backfills embeddings +
 * Pinecone vectors.
 *
 * Required env vars:
 * - DATABASE_URL
 * - X_API_BEARER_TOKEN
 * - OPENAI_API_KEY
 * - PINECONE_API_KEY
 *
 * Optional knobs:
 * - FIRST_DEGREE_INPUT_PATH (defaults to client/data/first-degree-following.json)
 * - PINECONE_INDEX_HOST / PINECONE_NAMESPACE
 * - X_BY_USERNAME_INTERVAL_MS (defaults to 3000ms => <=300 req / 15 min)
 * - --random/--randomize (shuffles the candidate list before processing)
 * - --sample-size=N (process only N random usernames when used with --random)
 * - --ignore-first=N (when combined with --randomize, drop the first N sequential entries before sampling)
 *
 * CLI flags for resumable ingestion:
 * - --start-index=NUMBER (skip usernames before this index)
 * - --limit=NUMBER (process at most N usernames starting at start-index)
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import {
  SQLClient,
  XUserData,
  buildEmbeddingText,
  createEmbedding,
  fetchXUserData,
  updateUserInDB,
  upsertEmbeddingToPinecone,
} from "./lib/x-ingest";

interface UsernameBatch {
  generatedAt: string;
  usernames: string[];
  edges?: FollowingEdgeEntry[];
}

interface FollowingEdgeEntry {
  followerDbId: number;
  followerXUserId?: string | null;
  followingUsername: string;
}

interface CLIOptions {
  startIndex: number;
  limit?: number;
  randomize?: boolean;
  sampleSize?: number;
  ignoreFirst?: number;
}

const INPUT_PATH =
  process.env.FIRST_DEGREE_INPUT_PATH ||
  path.join(process.cwd(), "client", "data", "first-degree-following.json");
const REQUEST_INTERVAL_MS = Number(
  process.env.X_BY_USERNAME_INTERVAL_MS || 3000
);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCLIOptions(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = { startIndex: 0 };

  for (const arg of args) {
    if (arg.startsWith("--start-index=")) {
      options.startIndex = parseInt(arg.split("=")[1] || "0", 10) || 0;
    } else if (arg.startsWith("--limit=")) {
      const limit = parseInt(arg.split("=")[1] || "0", 10);
      if (limit > 0) {
        options.limit = limit;
      }
    } else if (arg === "--random" || arg === "--randomize") {
      options.randomize = true;
    } else if (arg.startsWith("--sample-size=")) {
      const sampleSize = parseInt(arg.split("=")[1] || "0", 10);
      if (sampleSize > 0) {
        options.sampleSize = sampleSize;
      }
    } else if (arg.startsWith("--ignore-first=")) {
      const ignore = parseInt(arg.split("=")[1] || "0", 10);
      if (ignore > 0) {
        options.ignoreFirst = ignore;
      }
    }
  }

  return options;
}

function shuffleCandidates<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function readUsernameBatch(): Promise<UsernameBatch> {
  try {
    const raw = await fs.readFile(INPUT_PATH, "utf8");
    return JSON.parse(raw) as UsernameBatch;
  } catch (error) {
    throw new Error(
      `Unable to read ${INPUT_PATH}. Run collect-first-degree.ts first. ${String(
        error
      )}`
    );
  }
}

async function loadExistingUsers(
  sql: SQLClient
): Promise<Map<string, { id: number }>> {
  const query = `
    SELECT "id",
           LOWER(COALESCE(NULLIF("xUsername", ''), NULLIF("twitter", ''))) AS "username"
    FROM "users"
    WHERE "xUsername" IS NOT NULL OR "twitter" IS NOT NULL
  `;
  const result = await sql.query(query);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const map = new Map<string, { id: number }>();
  for (const row of rows) {
    const username = row.username as string | null;
    if (!username) continue;
    const id = row.id as number | undefined;
    if (!id) continue;
    map.set(username, { id });
  }
  return map;
}

function buildEdgeMap(
  edges: FollowingEdgeEntry[] | undefined
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  if (!edges) {
    return map;
  }

  for (const edge of edges) {
    const username = edge.followingUsername?.trim();
    if (!username) continue;
    const normalized = username.toLowerCase();
    const followerId = edge.followerDbId;
    if (!Number.isInteger(followerId)) continue;
    if (!map.has(normalized)) {
      map.set(normalized, new Set());
    }
    map.get(normalized)!.add(followerId);
  }

  return map;
}

async function upsertFollowingEdges(
  sql: SQLClient,
  followerIds: Set<number>,
  followingId: number
) {
  if (followerIds.size === 0) {
    return;
  }

  const CHUNK_SIZE = 100;
  const followers = Array.from(followerIds);

  for (let i = 0; i < followers.length; i += CHUNK_SIZE) {
    const chunk = followers.slice(i, i + CHUNK_SIZE);
    const values: number[] = [];
    const placeholders: string[] = [];

    chunk.forEach((followerId, idx) => {
      const followerParam = idx * 2 + 1;
      const followingParam = idx * 2 + 2;
      placeholders.push(`($${followerParam}, $${followingParam})`);
      values.push(followerId, followingId);
    });

    const query = `
      INSERT INTO "following" ("follower_id", "following_id")
      VALUES ${placeholders.join(", ")}
      ON CONFLICT DO NOTHING
    `;

    await sql.query(query, values);
  }
}

async function findExistingUserId(
  sql: SQLClient,
  xUserData: XUserData
): Promise<number | null> {
  const normalizedUsername = xUserData.username.toLowerCase();
  const query = `
    SELECT "id"
    FROM "users"
    WHERE "xUserId" = $1
       OR LOWER("xUsername") = $2
       OR LOWER("twitter") = $2
    LIMIT 1
  `;
  const result = await sql.query(query, [xUserData.id, normalizedUsername]);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0] as { id: number } | undefined;
  return row ? row.id : null;
}

async function insertUserFromX(
  sql: SQLClient,
  xUserData: XUserData
): Promise<number> {
  const insertQuery = `
    INSERT INTO "users" (
      "name",
      "email",
      "twitter",
      "isBaseUser",
      "createdAt",
      "updatedAt"
    )
    VALUES ($1, $2, $3, false, NOW(), NOW())
    RETURNING "id"
  `;

  const email = `${xUserData.id}@x.local`;
  const insertResult = await sql.query(insertQuery, [
    xUserData.name || xUserData.username,
    email,
    xUserData.username,
  ]);

  const rows = Array.isArray(insertResult)
    ? (insertResult as Array<{ id: number }>)
    : ((insertResult.rows ?? []) as Array<{ id: number }>);
  const row = rows[0];
  if (!row) {
    throw new Error("Insert returned no rows");
  }
  return row.id;
}

async function ingestFirstDegree() {
  const databaseUrl = process.env.DATABASE_URL;
  const bearerToken = process.env.X_API_BEARER_TOKEN;
  const pineconeApiKey = process.env.PINECONE_API_KEY;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  if (!bearerToken) {
    throw new Error("X_API_BEARER_TOKEN environment variable is not set");
  }
  if (!pineconeApiKey) {
    throw new Error("PINECONE_API_KEY environment variable is not set");
  }
  if (REQUEST_INTERVAL_MS <= 0) {
    throw new Error("X_BY_USERNAME_INTERVAL_MS must be greater than 0");
  }

  const namespace = process.env.PINECONE_NAMESPACE || "users";
  const indexHost =
    process.env.PINECONE_INDEX_HOST ||
    "people-on-x-mdlxyiy.svc.aped-4627-b74a.pinecone.io";
  const cliOptions = parseCLIOptions();

  const sql = neon(databaseUrl) as SQLClient;
  const batch = await readUsernameBatch();

  if (!Array.isArray(batch.usernames) || batch.usernames.length === 0) {
    console.log("No usernames found in the input batch.");
    return;
  }

  const normalizedCandidates = batch.usernames
    .map((username) => username.trim())
    .filter(Boolean)
    .map((username, index) => ({
      username,
      normalized: username.toLowerCase(),
      inputIndex: index,
    }));

  const existingUsers = await loadExistingUsers(sql);
  const edgeMap = buildEdgeMap(batch.edges);
  const processedUsernames = new Set<string>();

  let workingCandidates = normalizedCandidates;
  let slice: typeof normalizedCandidates;

  let sliceLabel = "";
  let sequentialStartIndex = 0;
  let sequentialEndIndex = 0;

  if (cliOptions.randomize) {
    const skipCount = Math.min(
      cliOptions.ignoreFirst ?? cliOptions.startIndex ?? 0,
      normalizedCandidates.length
    );
    const pool = normalizedCandidates.slice(skipCount);
    workingCandidates = shuffleCandidates(pool);
    const maxCount =
      cliOptions.sampleSize ?? cliOptions.limit ?? workingCandidates.length;
    slice = workingCandidates.slice(0, maxCount);
    sliceLabel = `random sample (skipped first ${skipCount})`;
    sequentialStartIndex = 0;
    sequentialEndIndex = slice.length;
  } else {
    sequentialStartIndex = Math.min(
      cliOptions.startIndex,
      normalizedCandidates.length
    );
    sequentialEndIndex = cliOptions.limit
      ? Math.min(
          sequentialStartIndex + cliOptions.limit,
          normalizedCandidates.length
        )
      : normalizedCandidates.length;
    slice = normalizedCandidates.slice(
      sequentialStartIndex,
      sequentialEndIndex
    );
    sliceLabel = `indices ${sequentialStartIndex}-${sequentialEndIndex - 1}`;
  }

  console.log(
    `Processing ${slice.length} usernames (${sliceLabel}) from ${INPUT_PATH}`
  );

  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let reusedExisting = 0;
  let skippedMissing = 0;
  let errors = 0;
  let embeddingsCreated = 0;
  let requestsMade = 0;
  let edgesInserted = 0;

  for (let i = 0; i < slice.length; i++) {
    const candidate = slice[i];
    const absoluteIndex = cliOptions.randomize
      ? candidate.inputIndex
      : sequentialStartIndex + i;
    const followerIds = edgeMap.get(candidate.normalized) ?? new Set<number>();

    const cachedUser = existingUsers.get(candidate.normalized);
    if (cachedUser) {
      try {
        await upsertFollowingEdges(sql, followerIds, cachedUser.id);
        edgesInserted += followerIds.size;
      } catch (edgeError) {
        const message =
          edgeError instanceof Error ? edgeError.message : String(edgeError);
        console.error(
          `  ⚠ Failed to upsert edges for @${candidate.username}: ${message}`
        );
      }
      processedUsernames.add(candidate.normalized);
      reusedExisting += 1;
      continue;
    }

    console.log(
      `\n[${absoluteIndex + 1}/${normalizedCandidates.length}] @${candidate.username}`
    );

    if (requestsMade > 0) {
      await delay(REQUEST_INTERVAL_MS);
    }

    requestsMade += 1;

    try {
      const xUserData = await fetchXUserData(bearerToken, candidate.username);
      if (!xUserData) {
        console.log("  ⚠ Skipping: user not found or fetch failed");
        skippedMissing += 1;
        continue;
      }

      const normalizedFetched = xUserData.username.toLowerCase();
      if (existingUsers.has(normalizedFetched)) {
        try {
          const normalizedFollowerSet =
            edgeMap.get(normalizedFetched) ?? followerIds;
          await upsertFollowingEdges(
            sql,
            normalizedFollowerSet,
            existingUsers.get(normalizedFetched)!.id
          );
          edgesInserted += normalizedFollowerSet.size;
        } catch (edgeError) {
          const message =
            edgeError instanceof Error ? edgeError.message : String(edgeError);
          console.error(
            `  ⚠ Failed to upsert edges for @${normalizedFetched}: ${message}`
          );
        }
        processedUsernames.add(normalizedFetched);
        reusedExisting += 1;
        continue;
      }

      let userId = await findExistingUserId(sql, xUserData);
      if (!userId) {
        userId = await insertUserFromX(sql, xUserData);
        inserted += 1;
      } else {
        updated += 1;
      }

      await updateUserInDB(sql, userId, xUserData);

      const embeddingText = buildEmbeddingText(xUserData);
      let embedding: number[] | null = null;
      try {
        embedding = await createEmbedding(embeddingText);
        embeddingsCreated += 1;
      } catch (embeddingError) {
        const message =
          embeddingError instanceof Error
            ? embeddingError.message
            : String(embeddingError);
        console.error(`  ⚠ Failed to create embedding: ${message}`);
      }

      if (embedding) {
        try {
          await upsertEmbeddingToPinecone(
            xUserData,
            embedding,
            {
              apiKey: pineconeApiKey,
              indexHost,
              namespace,
            },
            {
              description: xUserData.description,
              location: xUserData.location,
              verified_type: xUserData.verified_type,
            }
          );
        } catch (pineconeError) {
          const message =
            pineconeError instanceof Error
              ? pineconeError.message
              : String(pineconeError);
          console.error(`  ⚠ Pinecone upsert failed: ${message}`);
        }
      }

      existingUsers.set(normalizedFetched, { id: userId });
      if (normalizedFetched !== candidate.normalized) {
        existingUsers.set(candidate.normalized, { id: userId });
      }

      try {
        await upsertFollowingEdges(sql, followerIds, userId);
        edgesInserted += followerIds.size;
        processedUsernames.add(candidate.normalized);
      } catch (edgeError) {
        const message =
          edgeError instanceof Error ? edgeError.message : String(edgeError);
        console.error(
          `  ⚠ Failed to upsert edges for new user @${xUserData.username}: ${message}`
        );
      }

      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Error processing @${candidate.username}: ${message}`);
      errors += 1;
    }
  }

  for (const [normalized, followerIds] of edgeMap.entries()) {
    if (processedUsernames.has(normalized)) {
      continue;
    }
    const cachedUser = existingUsers.get(normalized);
    if (!cachedUser) {
      continue;
    }
    try {
      await upsertFollowingEdges(sql, followerIds, cachedUser.id);
      edgesInserted += followerIds.size;
      processedUsernames.add(normalized);
    } catch (edgeError) {
      const message =
        edgeError instanceof Error ? edgeError.message : String(edgeError);
      console.error(
        `  ⚠ Failed to upsert edges for @${normalized}: ${message}`
      );
    }
  }

  console.log("\n=== First-degree ingestion summary ===");
  console.log(`Total usernames in slice: ${slice.length}`);
  console.log(`Processed (fetched + stored): ${processed}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped existing (already in DB): ${reusedExisting}`);
  console.log(`Skipped missing/fetch failures: ${skippedMissing}`);
  console.log(`Errors: ${errors}`);
  console.log(`Embeddings created: ${embeddingsCreated}`);
  console.log(`Following edges inserted: ${edgesInserted}`);
}

ingestFirstDegree()
  .then(() => {
    console.log("\nDone ingesting first-degree users.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to ingest first-degree users:", error);
    process.exit(1);
  });
