import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

interface SQLClient {
  query: (
    query: string,
    params?: unknown[]
  ) => Promise<Array<UserRow> | { rows?: UserRow[] }>;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  xUserId: string | null;
  xUsername: string | null;
  xDescription: string | null;
  xLocation: string | null;
  xUrl: string | null;
  xVerified: boolean | null;
  xVerifiedType: string | null;
  xFollowersCount: number | null;
  xFollowingCount: number | null;
  xListedCount: number | null;
  xTweetCount: number | null;
  derivedSummary: string | null;
  derivedTopics: string[] | null;
}

async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-large"),
    values: [text],
  });

  const embedding = embeddings[0];
  if (!embedding || embedding.length === 0) {
    throw new Error("OpenAI returned an empty embedding");
  }

  return embedding;
}

function buildEmbeddingText(user: UserRow): string {
  const parts: string[] = [];

  if (user.name) parts.push(user.name);
  if (user.xUsername) parts.push(`@${user.xUsername}`);
  if (user.derivedSummary) parts.push(user.derivedSummary);
  if (user.xDescription) parts.push(user.xDescription);
  if (user.derivedTopics && user.derivedTopics.length > 0) {
    parts.push(`Topics: ${user.derivedTopics.join(", ")}`);
  }
  if (user.xLocation) parts.push(`Location: ${user.xLocation}`);

  return parts.join("\n");
}

function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function fetchVectorExists(
  id: string,
  baseUrl: string,
  namespace: string,
  apiKey: string
): Promise<boolean> {
  const response = await fetch(`${baseUrl}/vectors/fetch`, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids: [id], namespace }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Pinecone fetch error (${response.status}): ${responseText || "<empty>"}`
    );
  }

  if (!responseText) {
    return false;
  }

  let payload: {
    vectors?: Record<string, { values?: number[] }>;
  };

  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Pinecone fetch parse error: ${
        (error as Error).message
      } (${responseText})`
    );
  }

  const vector = payload.vectors?.[id];
  return Boolean(vector && vector.values && vector.values.length > 0);
}

async function ensurePineconeEmbeddings() {
  const databaseUrl = process.env.DATABASE_URL;
  const pineconeApiKey = process.env.PINECONE_API_KEY;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  if (!pineconeApiKey) {
    throw new Error("PINECONE_API_KEY environment variable is not set");
  }

  const namespace = process.env.PINECONE_NAMESPACE || "users";
  const indexHost = normalizeHost(
    process.env.PINECONE_INDEX_HOST ||
      "people-on-x-mdlxyiy.svc.aped-4627-b74a.pinecone.io"
  );
  const baseUrl = `https://${indexHost}`;

  const sql = neon(databaseUrl) as SQLClient;

  const usersQuery = `
    SELECT
      "id",
      "name",
      "email",
      "xUserId",
      "xUsername",
      "xDescription",
      "xLocation",
      "xUrl",
      "xVerified",
      "xVerifiedType",
      "xFollowersCount",
      "xFollowingCount",
      "xListedCount",
      "xTweetCount",
      "derivedSummary",
      "derivedTopics"
    FROM "users"
    WHERE "xUserId" IS NOT NULL
    ORDER BY "id"
  `;

  const rawUsers = await sql.query(usersQuery);
  const users: UserRow[] = Array.isArray(rawUsers)
    ? rawUsers
    : rawUsers.rows ?? [];

  if (users.length === 0) {
    console.log("No users with an X user ID found");
    return;
  }

  console.log(`Found ${users.length} X users to inspect`);

  let upsertedCount = 0;

  for (const user of users) {
    if (!user.xUserId) {
      continue;
    }

    try {
      if (
        await fetchVectorExists(
          user.xUserId,
          baseUrl,
          namespace,
          pineconeApiKey
        )
      ) {
        console.log(`  ✓ @${user.xUsername || user.email} already indexed`);
        continue;
      }

      const embeddingText = buildEmbeddingText(user);
      if (!embeddingText) {
        console.warn(
          `  ⚠ Skipping @${user.xUsername || user.email}: no text to embed`
        );
        continue;
      }

      const embedding = await createEmbedding(embeddingText);

      const metadata: Record<string, string | number | boolean | string[]> = {
        user_id: user.xUserId,
        name: user.name,
        followers: user.xFollowersCount ?? 0,
        following: user.xFollowingCount ?? 0,
        listed: user.xListedCount ?? 0,
        tweet_count: user.xTweetCount ?? 0,
        verified: Boolean(user.xVerified),
      };

      if (user.xUsername) metadata.username = user.xUsername;
      if (user.xDescription) metadata.description = user.xDescription;
      if (user.xLocation) metadata.location = user.xLocation;
      if (user.xUrl) metadata.url = user.xUrl;
      if (user.xVerifiedType) metadata.verified_type = user.xVerifiedType;
      if (user.derivedSummary) metadata.derived_summary = user.derivedSummary;
      if (user.derivedTopics && user.derivedTopics.length > 0) {
        metadata.derived_topics = user.derivedTopics;
      }

      const upsertResponse = await fetch(`${baseUrl}/vectors/upsert`, {
        method: "POST",
        headers: {
          "Api-Key": pineconeApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vectors: [
            {
              id: user.xUserId,
              values: embedding,
              metadata,
            },
          ],
          namespace,
        }),
      });

      if (!upsertResponse.ok) {
        const errorText = await upsertResponse.text();
        throw new Error(`Pinecone upsert error: ${errorText}`);
      }

      console.log(
        `  ✓ Indexed @${user.xUsername || user.email} (${embedding.length}d)`
      );
      upsertedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `  ⚠ Failed to index @${user.xUsername || user.email}: ${message}`
      );
    }
  }

  console.log(
    `\nFinished. Upserted ${upsertedCount} new embeddings into Pinecone.`
  );
}

ensurePineconeEmbeddings()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to ensure Pinecone embeddings:", error);
    process.exit(1);
  });
