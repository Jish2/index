import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { readEnvSecret } from "../lib/env";

config({ path: ".env.local" });

if (existsSync(".env.development.local")) {
  config({ path: ".env.development.local", override: true });
}

if (!process.env.AWS_ACCESS_KEY_ID) {
  process.env.AWS_PROFILE ??= "dev-admin";
  process.env.AWS_BEDROCK_SKIP_ROLE_ASSUME ??= "true";
}

async function assertOpenAiApiKey() {
  const apiKey = readEnvSecret("OPENAI_API_KEY");
  if (!apiKey) {
    console.error(
      "\nMissing OPENAI_API_KEY. People search needs OpenAI embeddings (text-embedding-3-large).\n" +
        "Add a valid key to client/.env.local, then rerun pnpm dev.\n"
    );
    process.exit(1);
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-large",
      input: "healthcheck",
    }),
  });

  if (response.ok) {
    return;
  }

  console.error(
    "\nOPENAI_API_KEY is set but rejected by OpenAI (people search will fail).\n" +
      "Create a new key at https://platform.openai.com/api-keys and update:\n" +
      "  client/.env.local\n" +
      "  vercel env add OPENAI_API_KEY <environment>\n"
  );
  process.exit(1);
}

async function main() {
  await assertOpenAiApiKey();

  const child = spawn("next", ["dev"], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
