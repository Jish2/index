import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import {
  SQLClient,
  buildEmbeddingText,
  createEmbedding,
  fetchXUserData,
  updateUserInDB,
  upsertEmbeddingToPinecone,
} from "./lib/x-ingest";

interface UserRow {
  id: number;
  email: string;
  twitter: string | null;
  xUserId: string | null;
  xUsername: string | null;
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
          const indexHost =
            process.env.PINECONE_INDEX_HOST ||
            `people-on-x-mdlxyiy.svc.aped-4627-b74a.pinecone.io`;

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
