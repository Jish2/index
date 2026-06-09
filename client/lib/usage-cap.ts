import { neon } from "@neondatabase/serverless";

export const USAGE_LEDGER_ID = "global";
export const DEFAULT_USAGE_CAP_USD = 10;

// Amazon Nova Lite on Bedrock — override via env for other models.
const DEFAULT_BEDROCK_INPUT_USD_PER_MTOK = 0.00006;
const DEFAULT_BEDROCK_OUTPUT_USD_PER_MTOK = 0.00024;
const DEFAULT_OPENAI_EMBED_USD_PER_MTOK = 0.00013;

export class UsageCapExceededError extends Error {
  readonly capUsd: number;
  readonly spentUsd: number;

  constructor(capUsd: number, spentUsd: number) {
    super(
      `API usage cap reached ($${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)} all-time limit).`
    );
    this.name = "UsageCapExceededError";
    this.capUsd = capUsd;
    this.spentUsd = spentUsd;
  }
}

function getUsageCapUsd() {
  const raw = process.env.API_USAGE_CAP_USD;
  if (!raw) {
    return DEFAULT_USAGE_CAP_USD;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("API_USAGE_CAP_USD must be a positive number.");
  }
  return parsed;
}

function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required.");
  }
  return neon(databaseUrl);
}

function toRows<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (
    payload &&
    typeof payload === "object" &&
    "rows" in payload &&
    Array.isArray((payload as { rows?: unknown }).rows)
  ) {
    return ((payload as { rows?: T[] }).rows ?? []) as T[];
  }
  return [];
}

export async function getUsageTotalUsd(): Promise<number> {
  const sql = getSql();
  const rows = toRows<{ total_usd: string | number }>(
    await sql.query(
      `SELECT total_usd FROM api_usage WHERE id = $1 LIMIT 1`,
      [USAGE_LEDGER_ID]
    )
  );
  const value = rows[0]?.total_usd ?? 0;
  return Number(value);
}

export async function assertUnderUsageCap(): Promise<void> {
  const capUsd = getUsageCapUsd();
  const spentUsd = await getUsageTotalUsd();
  if (spentUsd >= capUsd) {
    throw new UsageCapExceededError(capUsd, spentUsd);
  }
}

export async function recordUsageCost(
  costUsd: number,
  source: string
): Promise<{ spentUsd: number; capUsd: number }> {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new Error(`Invalid usage cost for ${source}.`);
  }
  if (costUsd === 0) {
    const capUsd = getUsageCapUsd();
    const spentUsd = await getUsageTotalUsd();
    return { spentUsd, capUsd };
  }

  const capUsd = getUsageCapUsd();
  const sql = getSql();

  const rows = toRows<{ total_usd: string | number }>(
    await sql.query(
      `
      INSERT INTO api_usage (id, total_usd)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE
      SET total_usd = api_usage.total_usd + EXCLUDED.total_usd,
          updated_at = now()
      RETURNING total_usd
      `,
      [USAGE_LEDGER_ID, costUsd]
    )
  );

  const spentUsd = Number(rows[0]?.total_usd ?? 0);
  if (spentUsd > capUsd) {
    console.warn(
      `[usage-cap] ${source} pushed spend to $${spentUsd.toFixed(4)} (cap $${capUsd.toFixed(2)})`
    );
  }

  return { spentUsd, capUsd };
}

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export function estimateBedrockCostUsd(usage: TokenUsage): number {
  const inputPerM = Number(
    process.env.BEDROCK_INPUT_USD_PER_MTOK ?? DEFAULT_BEDROCK_INPUT_USD_PER_MTOK
  );
  const outputPerM = Number(
    process.env.BEDROCK_OUTPUT_USD_PER_MTOK ??
      DEFAULT_BEDROCK_OUTPUT_USD_PER_MTOK
  );

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens =
    usage.outputTokens ??
    Math.max(0, (usage.totalTokens ?? 0) - inputTokens);

  return (inputTokens / 1_000_000) * inputPerM + (outputTokens / 1_000_000) * outputPerM;
}

export function estimateEmbeddingCostUsd(tokens: number): number {
  const perM = Number(
    process.env.OPENAI_EMBED_USD_PER_MTOK ?? DEFAULT_OPENAI_EMBED_USD_PER_MTOK
  );
  return (tokens / 1_000_000) * perM;
}

export async function recordBedrockUsage(usage: TokenUsage): Promise<void> {
  const costUsd = estimateBedrockCostUsd(usage);
  await recordUsageCost(costUsd, "bedrock-agent");
}

export async function recordEmbeddingUsage(tokens: number): Promise<void> {
  const costUsd = estimateEmbeddingCostUsd(tokens);
  await recordUsageCost(costUsd, "openai-embed");
}
