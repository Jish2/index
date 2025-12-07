import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { neon } from "@neondatabase/serverless";

const DEFAULT_PINECONE_HOST =
  "people-on-x-mdlxyiy.svc.aped-4627-b74a.pinecone.io";
const DEFAULT_NAMESPACE = "users";
const DEFAULT_TOP_K = 6;
const MAX_TOP_K = 10;
const EMBED_MODEL =
  process.env.PERSON_FINDER_EMBED_MODEL || "text-embedding-3-large";

interface PineconeMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface UserRecord {
  xUserId: string;
  xUsername: string | null;
  name: string | null;
  xDescription: string | null;
  xLocation: string | null;
  derivedRole: string | null;
  derivedTopics: string[] | null;
  derivedSummary: string | null;
  xFollowersCount: number | null;
  xUrl: string | null;
  profilePic: string | null;
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

type SqlClient = Pick<ReturnType<typeof neon>, "query">;

async function fetchDbUsers(sql: SqlClient, ids: string[]) {
  if (ids.length === 0) {
    return new Map<string, UserRecord>();
  }

  const rows = toRows<UserRecord>(
    await sql.query(
      `
      SELECT 
        "xUserId",
        "xUsername",
        "name",
        "xDescription",
        "xLocation",
        "derivedRole",
        "derivedTopics",
        "derivedSummary",
        "xFollowersCount",
        "xUrl",
        "profilePic"
      FROM "users"
      WHERE "xUserId" = ANY($1::text[])
    `,
      [ids]
    )
  );

  return new Map(rows.map((row) => [row.xUserId, row]));
}

function buildReason(match: PineconeMatch, user?: UserRecord) {
  const parts: string[] = [];
  if (user?.derivedRole) {
    parts.push(`Role: ${user.derivedRole}`);
  }
  if (user?.derivedTopics?.length) {
    const topics = user.derivedTopics.slice(0, 5).join(", ");
    parts.push(`Topics: ${topics}`);
  }
  if (user?.derivedSummary) {
    parts.push(user.derivedSummary);
  }

  const metadataDescription = match.metadata?.description;
  if (typeof metadataDescription === "string" && parts.length < 2) {
    parts.push(metadataDescription);
  }

  if (parts.length === 0) {
    parts.push(
      "Relevant public activity and interests match the query intent."
    );
  }

  return parts.join(" • ");
}

export const vectorSearchTool = createTool({
  id: "people-vector-search",
  description:
    "Search the Pinecone users index to find people on X that match a natural-language description.",
  inputSchema: z.object({
    query: z
      .string()
      .min(3, "Query must be at least 3 characters long")
      .describe(
        "Natural-language description of the person you are looking for (roles, topics, goals, etc.)"
      ),
    topK: z
      .number()
      .int()
      .min(1)
      .max(MAX_TOP_K)
      .optional()
      .describe("Optional override for number of results (default 6)."),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        xUserId: z.string(),
        username: z.string().nullable(),
        name: z.string().nullable(),
        location: z.string().nullable(),
        derivedRole: z.string().nullable(),
        derivedTopics: z.array(z.string()).nullable(),
        followers: z.number().nullable(),
        similarity: z.number(),
        summary: z.string(),
        profileImageUrl: z.string().nullable(),
        url: z.string().nullable(),
      })
    ),
  }),
  execute: async ({ context, writer }) => {
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const pineconeHost =
      process.env.PINECONE_INDEX_HOST || DEFAULT_PINECONE_HOST;
    const pineconeNamespace =
      process.env.PINECONE_NAMESPACE || DEFAULT_NAMESPACE;
    const databaseUrl = process.env.DATABASE_URL;
    const openAiKey = process.env.OPENAI_API_KEY;

    if (!pineconeApiKey) {
      throw new Error("PINECONE_API_KEY environment variable is required.");
    }
    if (!openAiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required.");
    }
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is required.");
    }

    const sql = neon(databaseUrl);
    const { query, topK } = context;
    const limit = Math.min(topK ?? DEFAULT_TOP_K, MAX_TOP_K);

    const { embeddings } = await embedMany({
      model: openai.embedding(EMBED_MODEL),
      values: [query],
    });

    const [vector] = embeddings;
    if (!vector) {
      throw new Error("Failed to generate query embedding.");
    }

    const response = await fetch(`https://${pineconeHost}/query`, {
      method: "POST",
      headers: {
        "Api-Key": pineconeApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vector,
        topK: limit,
        namespace: pineconeNamespace,
        includeMetadata: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Pinecone query failed: ${response.status} - ${text || "Unknown error"}`
      );
    }

    const data = (await response.json()) as { matches?: PineconeMatch[] };
    const matches = data.matches ?? [];
    const xUserIds = matches.map((match) => match.id).filter(Boolean);
    const dbUsers = await fetchDbUsers(sql, xUserIds);

    const results = matches.map((match) => {
      const user = dbUsers.get(match.id);
      const metadata = match.metadata ?? {};

      const username =
        user?.xUsername ??
        (typeof metadata.username === "string" ? metadata.username : null);
      const name =
        user?.name ??
        (typeof metadata.name === "string" ? metadata.name : null);
      const location =
        user?.xLocation ??
        (typeof metadata.location === "string" ? metadata.location : null);

      let derivedTopics: string[] | null = null;
      if (Array.isArray(user?.derivedTopics)) {
        derivedTopics = user?.derivedTopics.map((topic) => String(topic));
      } else if (Array.isArray(metadata.topics)) {
        derivedTopics = (metadata.topics as unknown[])
          .map((topic) => String(topic))
          .slice(0, 6);
      }

      const followers =
        user?.xFollowersCount ??
        (typeof metadata.followers === "number"
          ? (metadata.followers as number)
          : null);

      const url =
        user?.xUrl ??
        (username ? `https://x.com/${username}` : null) ??
        (typeof metadata.url === "string" ? (metadata.url as string) : null);

      const profileImageUrl =
        user?.profilePic ??
        (typeof metadata.profile_image_url === "string"
          ? (metadata.profile_image_url as string)
          : null);

      return {
        xUserId: match.id,
        username,
        name,
        location,
        derivedRole: user?.derivedRole ?? null,
        derivedTopics,
        followers,
        similarity: match.score ?? 0,
        summary: buildReason(match, user),
        profileImageUrl: profileImageUrl ?? null,
        url,
      };
    });

    if (writer) {
      await writer.custom({
        type: "data-tool-people",
        id: "vector-search-results",
        data: { results },
      });
    }

    return { results };
  },
});
