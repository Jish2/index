import "dotenv/config";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { neon } from "@neondatabase/serverless";

interface SQLClient {
  query: (
    query: string,
    params?: unknown[]
  ) => Promise<
    Array<Record<string, unknown>> | { rows?: Array<Record<string, unknown>> }
  >;
}

interface MessageRow {
  tweet_id: string;
  text: string;
  user_id: number;
  x_user_id: string;
  tweet_created_at: string;
  x_username: string | null;
  name: string | null;
}

const EMBED_MODEL = process.env.MESSAGE_EMBED_MODEL || "text-embedding-3-large";
const BATCH_SIZE = Number(process.env.MESSAGE_EMBED_BATCH || 32);
const MAX_BATCHES = process.env.MESSAGE_EMBED_MAX_BATCHES
  ? Number(process.env.MESSAGE_EMBED_MAX_BATCHES)
  : undefined;

function toRows<T extends Record<string, unknown>>(
  payload:
    | Array<Record<string, unknown>>
    | { rows?: Array<Record<string, unknown>> }
): T[] {
  return Array.isArray(payload)
    ? (payload as T[])
    : ((payload.rows ?? []) as T[]);
}

function buildEmbeddingText(row: MessageRow) {
  const header = row.x_username
    ? `@${row.x_username}`
    : `user:${row.x_user_id}`;
  const createdAt = new Date(row.tweet_created_at).toISOString();
  return `${header} — ${createdAt}\n${row.text}`;
}

async function fetchPendingMessages(sql: SQLClient, limit: number) {
  const query = `
    SELECT 
      m."tweet_id",
      m."text",
      m."user_id",
      m."x_user_id",
      m."tweet_created_at",
      u."xUsername" as "x_username",
      u."name"
    FROM "messages" m
    JOIN "users" u ON m."user_id" = u."id"
    WHERE m."embeddedAt" IS NULL
    ORDER BY m."tweet_created_at" DESC
    LIMIT $1
  `;
  return toRows<MessageRow>(await sql.query(query, [limit]));
}

async function markEmbedded(
  sql: SQLClient,
  tweetIds: string[],
  version: string,
  error?: string
) {
  if (tweetIds.length === 0) {
    return;
  }

  const query = `
    UPDATE "messages"
    SET
      "embeddedAt" = CASE WHEN $2::text IS NULL THEN NOW() ELSE "embeddedAt" END,
      "embedding_error" = $2,
      "embedding_version" = CASE WHEN $2::text IS NULL THEN $3 ELSE NULL END
    WHERE "tweet_id" = ANY($1::text[])
  `;

  await sql.query(query, [tweetIds, error ?? null, version]);
}

async function upsertVectors(
  pineconeHost: string,
  apiKey: string,
  namespace: string,
  payload: Array<{
    id: string;
    values: number[];
    metadata: Record<string, unknown>;
  }>
) {
  const response = await fetch(`https://${pineconeHost}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vectors: payload,
      namespace,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Pinecone upsert failed: ${response.status} - ${text || "Unknown error"}`
    );
  }
}

async function runEmbeddingWorker() {
  const databaseUrl = process.env.DATABASE_URL;
  const pineconeApiKey = process.env.PINECONE_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const pineconeHost =
    process.env.PINECONE_INDEX_HOST ||
    "people-on-x-mdlxyiy.svc.aped-4627-b74a.pinecone.io";
  const namespace = process.env.PINECONE_MESSAGES_NAMESPACE || "messages";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  if (!pineconeApiKey) {
    throw new Error("PINECONE_API_KEY environment variable is required");
  }
  if (!openAiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const sql = neon(databaseUrl) as SQLClient;
  let totalEmbedded = 0;
  let batches = 0;

  while (true) {
    if (MAX_BATCHES !== undefined && batches >= MAX_BATCHES) {
      break;
    }

    const rows = await fetchPendingMessages(sql, BATCH_SIZE);
    if (rows.length === 0) {
      console.log("No pending tweets to embed.");
      break;
    }

    batches += 1;
    console.log(`Embedding batch ${batches}: ${rows.length} tweets`);

    const texts = rows.map((row) => buildEmbeddingText(row));
    const { embeddings } = await embedMany({
      model: openai.embedding(EMBED_MODEL),
      values: texts,
    });

    const vectors = embeddings.map((embedding, idx) => {
      const row = rows[idx];
      return {
        id: `tweet:${row.tweet_id}`,
        values: embedding,
        metadata: {
          type: "tweet",
          tweet_id: row.tweet_id,
          user_id: row.x_user_id,
          db_user_id: row.user_id,
          username: row.x_username,
          name: row.name,
          tweeted_at: row.tweet_created_at,
          text: row.text.slice(0, 800),
        },
      };
    });

    try {
      await upsertVectors(pineconeHost, pineconeApiKey, namespace, vectors);
      await markEmbedded(
        sql,
        rows.map((row) => row.tweet_id),
        EMBED_MODEL
      );
      totalEmbedded += rows.length;
      console.log(
        `  ✓ Upserted ${rows.length} vectors into Pinecone namespace "${namespace}"`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed to upsert batch: ${message}`);
      await markEmbedded(
        sql,
        rows.map((row) => row.tweet_id),
        EMBED_MODEL,
        message
      );
      break;
    }
  }

  console.log(
    `Finished embedding run. Total tweets processed: ${totalEmbedded}`
  );
}

runEmbeddingWorker()
  .then(() => {
    console.log("Message embedding worker completed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Message embedding worker failed:", error);
    process.exit(1);
  });
