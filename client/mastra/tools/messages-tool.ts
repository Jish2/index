import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { neon } from "@neondatabase/serverless";

const DEFAULT_LIMIT = 5;

interface MessageRow {
  tweet_id: string;
  text: string;
  tweet_created_at: string;
  like_count: number | null;
  reply_count: number | null;
  repost_count: number | null;
  quote_count: number | null;
  x_username: string | null;
  name: string | null;
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

function toTweet(row: MessageRow) {
  const url =
    row.x_username && row.tweet_id
      ? `https://x.com/${row.x_username}/status/${row.tweet_id}`
      : null;

  return {
    tweetId: row.tweet_id,
    text: row.text,
    tweetedAt: new Date(row.tweet_created_at).toISOString(),
    likeCount: row.like_count,
    replyCount: row.reply_count,
    repostCount: row.repost_count,
    quoteCount: row.quote_count,
    username: row.x_username,
    name: row.name,
    url,
  };
}

export const messagesTool = createTool({
  id: "fetch-user-messages",
  description:
    "Fetches recent public tweets for a user from the local messages store.",
  inputSchema: z
    .object({
      xUserId: z.string().optional(),
      username: z.string().optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of tweets to fetch (default 5)."),
    })
    .refine(
      (input) => Boolean(input.xUserId || input.username),
      "Provide an xUserId or username."
    ),
  outputSchema: z.object({
    tweets: z.array(
      z.object({
        tweetId: z.string(),
        text: z.string(),
        tweetedAt: z.string(),
        likeCount: z.number().nullable(),
        replyCount: z.number().nullable(),
        repostCount: z.number().nullable(),
        quoteCount: z.number().nullable(),
        username: z.string().nullable(),
        name: z.string().nullable(),
        url: z.string().nullable(),
      })
    ),
  }),
  execute: async ({ context }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is required.");
    }

    const sql = neon(databaseUrl);
    const { xUserId, username, limit } = context;

    let resolvedXUserId = xUserId ?? null;
    if (!resolvedXUserId && username) {
      const rows = toRows<{ xUserId: string }>(
        await sql.query(
          `
          SELECT "xUserId"
          FROM "users"
          WHERE lower("xUsername") = lower($1)
          LIMIT 1
        `,
          [username]
        )
      );

      resolvedXUserId = rows[0]?.xUserId ?? null;
    }

    if (!resolvedXUserId) {
      throw new Error(
        "Unable to resolve user. Provide a valid xUserId/username."
      );
    }

    const rows = toRows<MessageRow>(
      await sql.query(
        `
        SELECT
          m."tweet_id",
          m."text",
          m."tweet_created_at",
          m."like_count",
          m."reply_count",
          m."repost_count",
          m."quote_count",
          u."xUsername" AS "x_username",
          u."name"
        FROM "messages" m
        JOIN "users" u ON m."user_id" = u."id"
        WHERE m."x_user_id" = $1
        ORDER BY m."tweet_created_at" DESC
        LIMIT $2
      `,
        [resolvedXUserId, limit ?? DEFAULT_LIMIT]
      )
    );

    return {
      tweets: rows.map(toTweet),
    };
  },
});
