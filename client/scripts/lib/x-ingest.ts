import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

export interface XUserData {
  id: string;
  username: string;
  name: string;
  description?: string;
  location?: string;
  profile_image_url?: string;
  url?: string;
  created_at?: string;
  verified?: boolean;
  verified_type?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    listed_count: number;
    tweet_count: number;
  };
}

export interface SQLQueryResult {
  rowCount?: number;
  rows?: Record<string, unknown>[];
}

export interface SQLClient {
  query: (
    query: string,
    params?: unknown[]
  ) => Promise<SQLQueryResult | Array<Record<string, unknown>>>;
}

export interface FetchUserOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface PineconeMetadata {
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface PineconeConfig {
  apiKey: string;
  indexHost: string;
  namespace: string;
}

export async function fetchXUserData(
  bearerToken: string,
  username: string,
  retryCount = 0,
  options: FetchUserOptions = {}
): Promise<XUserData | null> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 3000;

  try {
    const url = `https://api.x.com/2/users/by/username/${username}?user.fields=id,username,name,description,location,profile_image_url,url,created_at,verified,verified_type,public_metrics`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`User @${username} not found`);
        return null;
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitTime = retryAfter
          ? parseInt(retryAfter) * 1000
          : baseDelay * Math.pow(2, retryCount);

        if (retryCount < maxRetries) {
          console.log(
            `  ⚠ Rate limit hit for @${username}, waiting ${waitTime / 1000}s before retry ${
              retryCount + 1
            }/${maxRetries}...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          return fetchXUserData(bearerToken, username, retryCount + 1, options);
        } else {
          throw new Error(
            `Rate limit exceeded after ${maxRetries} retries for @${username}`
          );
        }
      }

      const errorText = await response.text();
      throw new Error(`X API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { data: XUserData };
    return data.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error fetching @${username}:`, errorMessage);
    return null;
  }
}

export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-large"),
    values: [text],
  });
  return embeddings[0];
}

export function buildEmbeddingText(
  user: XUserData,
  derivedSummary?: string,
  derivedTopics?: string[]
): string {
  const parts: string[] = [];

  if (user.name) parts.push(user.name);
  if (user.username) parts.push(`@${user.username}`);
  if (derivedSummary) parts.push(derivedSummary);
  if (user.description) parts.push(user.description);
  if (derivedTopics && derivedTopics.length > 0) {
    parts.push(`Topics: ${derivedTopics.join(", ")}`);
  }
  if (user.location) parts.push(`Location: ${user.location}`);

  return parts.join("\n");
}

export async function updateUserInDB(
  sql: SQLClient,
  userId: number,
  xUserData: XUserData
) {
  const createdAt = xUserData.created_at
    ? new Date(xUserData.created_at).toISOString()
    : null;

  const query = `
    UPDATE "users"
    SET 
      "xUserId" = $1,
      "xUsername" = $2,
      "xDescription" = $3,
      "xLocation" = $4,
      "xUrl" = $5,
      "xVerified" = $6,
      "xVerifiedType" = $7,
      "xFollowersCount" = $8,
      "xFollowingCount" = $9,
      "xListedCount" = $10,
      "xTweetCount" = $11,
      "xCreatedAt" = $12,
      "updatedAt" = NOW(),
      "lastRefreshedAt" = NOW()
    WHERE "id" = $13
  `;

  await sql.query(query, [
    xUserData.id,
    xUserData.username,
    xUserData.description || null,
    xUserData.location || null,
    xUserData.url || null,
    xUserData.verified || false,
    xUserData.verified_type || null,
    xUserData.public_metrics?.followers_count || 0,
    xUserData.public_metrics?.following_count || 0,
    xUserData.public_metrics?.listed_count || 0,
    xUserData.public_metrics?.tweet_count || 0,
    createdAt,
    userId,
  ]);
}

export async function upsertEmbeddingToPinecone(
  xUserData: XUserData,
  embedding: number[],
  config: PineconeConfig,
  metadata: PineconeMetadata = {}
) {
  const host = config.indexHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const response = await fetch(`https://${host}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vectors: [
        {
          id: xUserData.id,
          values: embedding,
          metadata: {
            user_id: xUserData.id,
            username: xUserData.username,
            name: xUserData.name,
            followers: xUserData.public_metrics?.followers_count || 0,
            ...metadata,
          },
        },
      ],
      namespace: config.namespace,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinecone API error: ${response.status} - ${errorText}`);
  }
}
