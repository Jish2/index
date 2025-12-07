This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Message ingestion & embeddings

The message pipeline stores raw tweets in the `messages` table and tracks shard progress in `message_fetch_progress`. Each worker owns a shard of users (`MOD(users.id, workerTotal) = workerIndex`) so you can reuse as many X API keys as you have available.

### Fetchers

- `pnpm messages:fetch` – single worker run (uses `X_API_BEARER_TOKEN`, `MESSAGE_WORKER_INDEX`, `MESSAGE_WORKER_TOTAL`).
- `pnpm messages:run` – orchestration layer that spins up one worker per entry in `MESSAGE_WORKERS_CONFIG`.

Workers stop after the most recent 25 tweets per user and the first 200 users per run by default. Override via `MESSAGE_MAX_TWEETS` / `MESSAGE_MAX_USERS` or the `maxTweetsPerUser` / `maxUsersPerRun` fields in `MESSAGE_WORKERS_CONFIG`.

`MESSAGE_WORKERS_CONFIG` is a JSON array so you can partition requests across multiple API keys/rate limits:

```bash
export MESSAGE_WORKERS_CONFIG='[
  {"name":"pro-a","apiKeyEnv":"X_API_PRO_A","workerIndex":0,"workerTotal":4,"requestsPer15Minutes":850},
  {"name":"pro-b","apiKeyEnv":"X_API_PRO_B","workerIndex":1,"workerTotal":4},
  {"name":"basic-a","apiKeyEnv":"X_API_BASIC","workerIndex":2,"workerTotal":4,"requestsPer15Minutes":60}
]'
pnpm messages:run
```

Each worker persists status + cursors in `message_fetch_progress`, so reruns resume safely even if a process crashes mid-user.

### Embeddings

`pnpm messages:embed` batches pending tweets, creates OpenAI embeddings (`text-embedding-3-large` by default), and upserts them into the Pinecone `messages` namespace. Failed upserts store the error in `messages.embedding_error` so you can re-run once the issue is resolved.

## X first-degree ingestion pipeline

Run the people graph pipeline in two phases to stay inside X Basic-tier limits.

### 1. Collect followings

```bash
npm run collect-first-degree
```

Env requirements: `DATABASE_URL`, `X_API_BEARER_TOKEN`.

- Reads `users` where `isBaseUser = true` and `xUserId` is filled in.
- Calls `GET /2/users/:id/following` with the Basic per-app cap (≤15 req / 15 min by default, override via `X_FOLLOWING_REQS_PER_15M`).
- Dedupes usernames already in Postgres and writes `client/data/first-degree-following.json` (override path via `FIRST_DEGREE_OUTPUT_PATH`), storing both the unique username array and every `(followerDbId, followingUsername)` edge for later inserts.

### 2. Ingest followings → DB + embeddings

```bash
npm run ingest-first-degree -- --start-index=0 --limit=500
# or sample randomly (e.g., process 300 random usernames)
npm run ingest-first-degree -- --randomize --sample-size=300
# skip the first 750 entries already processed, then take a 300-user random sample
npm run ingest-first-degree -- --randomize --ignore-first=750 --sample-size=300
```

Env requirements: `DATABASE_URL`, `X_API_BEARER_TOKEN`, `OPENAI_API_KEY`, `PINECONE_API_KEY` (+ optional `PINECONE_INDEX_HOST` / `PINECONE_NAMESPACE`).

- Loads the JSON batch (override via `FIRST_DEGREE_INPUT_PATH`), skips usernames already in Postgres, and enforces a default 3 s delay between `GET /2/users/by/username` calls (tune via `X_BY_USERNAME_INTERVAL_MS`).
- Inserts new `users` rows (`email = <xUserId>@x.local`), updates existing ones, creates OpenAI embeddings, upserts vectors into Pinecone, and writes to the `following` table for each captured edge (`ON CONFLICT DO NOTHING`).
- Supports resumable sequential runs via `--start-index` / `--limit`, or ad-hoc random sampling via `--randomize` (optionally pair with `--sample-size` to cap the batch and `--ignore-first` to drop leading rows you already processed).
