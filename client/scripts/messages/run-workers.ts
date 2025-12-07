import "dotenv/config";
import { runMessageFetchWorker } from "./fetch-user-tweets";
import { MessageWorkerDefinition } from "./types";

function parseWorkerConfig(): MessageWorkerDefinition[] {
  const raw = process.env.MESSAGE_WORKERS_CONFIG;
  if (!raw) {
    return [
      {
        name: process.env.MESSAGE_WORKER_NAME || "default",
        apiKeyEnv: process.env.MESSAGE_WORKER_API_ENV || "X_API_BEARER_TOKEN",
        workerIndex: Number(process.env.MESSAGE_WORKER_INDEX || 0),
        workerTotal: Number(process.env.MESSAGE_WORKER_TOTAL || 1),
        requestsPer15Minutes: process.env.X_TWEETS_REQS_PER_15M
          ? Number(process.env.X_TWEETS_REQS_PER_15M)
          : undefined,
        maxPagesPerUser: process.env.MESSAGE_MAX_PAGES
          ? Number(process.env.MESSAGE_MAX_PAGES)
          : undefined,
        maxUsersPerRun: process.env.MESSAGE_MAX_USERS
          ? Number(process.env.MESSAGE_MAX_USERS)
          : undefined,
        maxTweetsPerUser: process.env.MESSAGE_MAX_TWEETS
          ? Number(process.env.MESSAGE_MAX_TWEETS)
          : undefined,
      },
    ];
  }

  try {
    const parsed = JSON.parse(raw) as
      | MessageWorkerDefinition
      | MessageWorkerDefinition[];
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [parsed];
  } catch (error) {
    throw new Error(
      `Unable to parse MESSAGE_WORKERS_CONFIG JSON: ${String(error)}`
    );
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const workerDefs = parseWorkerConfig();
  if (workerDefs.length === 0) {
    console.log("No message workers configured. Nothing to do.");
    return;
  }

  console.log(
    `Launching ${workerDefs.length} message fetch worker(s): ${workerDefs
      .map((def) => def.name)
      .join(", ")}`
  );

  const heartbeat = setInterval(() => {
    console.log(`[orchestrator] heartbeat ${new Date().toISOString()}`);
  }, 60_000);

  try {
    await Promise.all(
      workerDefs.map(async (def) => {
        const bearerToken = process.env[def.apiKeyEnv];
        if (!bearerToken) {
          throw new Error(
            `Missing bearer token env "${def.apiKeyEnv}" for worker "${def.name}"`
          );
        }
        await runMessageFetchWorker({
          databaseUrl,
          bearerToken,
          workerIndex: def.workerIndex,
          workerTotal: def.workerTotal,
          apiKeyAlias: def.name,
          shardKey: def.name,
          requestsPer15Minutes: def.requestsPer15Minutes,
          maxPagesPerUser: def.maxPagesPerUser,
          maxUsersPerRun: def.maxUsersPerRun,
          maxTweetsPerUser: def.maxTweetsPerUser,
        });
      })
    );
  } finally {
    clearInterval(heartbeat);
  }
}

main()
  .then(() => {
    console.log("All message workers finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Message worker orchestrator failed:", error);
    process.exit(1);
  });
