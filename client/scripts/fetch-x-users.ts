import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

interface XUserData {
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

interface UserRow {
  id: number;
  email: string;
  twitter: string | null;
  xUserId: string | null;
  xUsername: string | null;
}

interface SQLClient {
  query: (query: string, params?: unknown[]) => Promise<{ rowCount?: number }>;
}

async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }

  try {
    const { embeddings } = await embedMany({
      model: openai.embedding("text-embedding-3-large"),
      values: [text],
    });
    return embeddings[0];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error creating embedding:", errorMessage);
    throw error;
  }
}

async function fetchXUserData(
  bearerToken: string,
  username: string,
  retryCount = 0
): Promise<XUserData | null> {
  const maxRetries = 3;
  const baseDelay = 3000; // 3 seconds base delay

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

      // Handle rate limit (429) with exponential backoff
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitTime = retryAfter
          ? parseInt(retryAfter) * 1000
          : baseDelay * Math.pow(2, retryCount);

        if (retryCount < maxRetries) {
          console.log(
            `  ⚠ Rate limit hit, waiting ${waitTime / 1000}s before retry ${
              retryCount + 1
            }/${maxRetries}...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          return fetchXUserData(bearerToken, username, retryCount + 1);
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

function buildEmbeddingText(
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

async function updateUserInDB(
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

async function fetchAndProcessUsers() {
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

  const sql = neon(databaseUrl);

  // Initialize Pinecone
  // NOTE: Your index must be created with integrated embeddings using llama-text-embed-v2 (RECOMMENDED - best accuracy):
  // pc index delete -n people-on-x
  // pc index create -n people-on-x --model llama-text-embed-v2 --metric cosine --cloud aws --region us-east-1 --field_map text=content
  //
  // Model comparison (from Pinecone docs):
  // - llama-text-embed-v2: RECOMMENDED - High-performance, best accuracy for most cases, configurable dimensions
  // - multilingual-e5-large: For multilingual content (1024 dimensions)
  // - pinecone-sparse-english-v0: For keyword/hybrid search scenarios
  // Note: Pinecone SDK initialized but not used directly - using REST API for integrated embeddings
  const namespace = "users"; // Using namespace as recommended in Pinecone docs

  // Get users from database that have Twitter handles but no X data yet
  const usersQuery = `
    SELECT "id", "email", "twitter", "xUserId", "xUsername"
    FROM "users"
    WHERE "twitter" IS NOT NULL 
      AND ("xUserId" IS NULL OR "lastRefreshedAt" IS NULL OR "lastRefreshedAt" < NOW() - INTERVAL '7 days')
    ORDER BY "id"
  `;

  const users = await sql.query(usersQuery);

  if (!users || users.length === 0) {
    console.log("No users found to process");
    return;
  }

  console.log(`Found ${users.length} users to process`);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  // Process users with rate limiting (X API has rate limits)
  for (let i = 0; i < users.length; i++) {
    const user = users[i] as UserRow;
    const username = user.twitter?.replace(/^@/, "") || user.xUsername;

    if (!username) {
      console.log(`Skipping ${user.email}: no username`);
      skippedCount++;
      continue;
    }

    console.log(
      `\n[${i + 1}/${users.length}] Processing @${username} (${user.email})...`
    );

    try {
      // Fetch user data from X API
      const xUserData = await fetchXUserData(bearerToken, username);

      if (!xUserData) {
        console.log(`  ✗ Could not fetch data for @${username}`);
        skippedCount++;
        continue;
      }

      console.log(
        `  ✓ Fetched: ${xUserData.name} (${
          xUserData.public_metrics?.followers_count || 0
        } followers)`
      );

      // Build embedding text (include derived fields if available)
      const embeddingText = buildEmbeddingText(xUserData);

      // Create embedding using OpenAI
      let embedding: number[] | null = null;
      try {
        embedding = await createEmbedding(embeddingText);
        console.log(
          `  ✓ Created OpenAI embedding (${embedding.length} dimensions)`
        );
      } catch (embedError) {
        const errorMessage =
          embedError instanceof Error ? embedError.message : String(embedError);
        console.error(`  ⚠ Failed to create embedding: ${errorMessage}`);
      }

      // Update database
      await updateUserInDB(sql as SQLClient, user.id, xUserData);

      if (embedding && xUserData.id) {
        try {
          const metadata: Record<string, unknown> = {
            user_id: xUserData.id,
            username: xUserData.username,
            name: xUserData.name,
            followers: xUserData.public_metrics?.followers_count || 0,
          };

          if (xUserData.description) {
            metadata.description = xUserData.description;
          }
          if (xUserData.location) {
            metadata.location = xUserData.location;
          }
          if (xUserData.verified_type) {
            metadata.verified_type = xUserData.verified_type;
          }

          const indexHost =
            process.env.PINECONE_INDEX_HOST ||
            `people-on-x-mdlxyiy.svc.aped-4627-b74a.pinecone.io`;

          const response = await fetch(`https://${indexHost}/vectors/upsert`, {
            method: "POST",
            headers: {
              "Api-Key": pineconeApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              vectors: [
                {
                  id: xUserData.id,
                  values: embedding,
                  metadata: metadata,
                },
              ],
              namespace: namespace,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Pinecone API error: ${response.status} - ${errorText}`
            );
          }

          console.log(`  ✓ Stored embedding in Pinecone`);
        } catch (pineconeError) {
          const errorMessage =
            pineconeError instanceof Error
              ? pineconeError.message
              : String(pineconeError);
          console.error(
            `  ⚠ Failed to store embedding: ${errorMessage}`,
            pineconeError
          );
        }
      }

      successCount++;

      // Rate limiting: wait 3 seconds between requests to respect X API limits
      // GET /2/users/by/username/:username rate limits:
      // - Per-app: 300 requests / 15 minutes = 20 requests/min = 1 request every 3 seconds
      // - Per-user: 900 requests / 15 minutes = 60 requests/min = 1 request per second
      // We use 3 seconds to respect the stricter per-app limit
      if (i < users.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Error processing @${username}:`, errorMessage);
      errorCount++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total processed: ${users.length}`);
  console.log(`Successfully fetched and stored: ${successCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
}

fetchAndProcessUsers()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to fetch X users:", error);
    process.exit(1);
  });
