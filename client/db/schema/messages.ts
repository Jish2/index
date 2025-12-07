import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const messagesTable = pgTable(
  "messages",
  {
    tweetId: varchar("tweet_id", { length: 50 }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    xUserId: varchar("x_user_id", { length: 50 }).notNull(),
    text: text("text").notNull(),
    lang: varchar("lang", { length: 16 }),
    likeCount: integer("like_count").default(0),
    replyCount: integer("reply_count").default(0),
    repostCount: integer("repost_count").default(0),
    quoteCount: integer("quote_count").default(0),
    tweetCreatedAt: timestamp("tweet_created_at", {
      withTimezone: false,
      mode: "date",
    }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    conversationId: varchar("conversation_id", { length: 50 }),
    inReplyToUserId: varchar("in_reply_to_user_id", { length: 50 }),
    referencedTweetId: varchar("referenced_tweet_id", { length: 50 }),
    rawPayload: jsonb("raw_payload"),
    embeddedAt: timestamp("embeddedAt", { withTimezone: false }),
    embeddingError: text("embedding_error"),
    embeddingVersion: varchar("embedding_version", { length: 32 }),
  },
  (table) => ({
    userIdx: index("messages_user_id_idx").on(table.userId),
    createdIdx: index("messages_tweet_created_at_idx").on(table.tweetCreatedAt),
    embeddedIdx: index("messages_embedded_at_idx").on(table.embeddedAt),
  })
);

export const messageFetchProgressTable = pgTable(
  "message_fetch_progress",
  {
    userId: integer("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    shardKey: varchar("shard_key", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    totalFetched: integer("total_fetched").notNull().default(0),
    newestTweetId: varchar("newest_tweet_id", { length: 50 }),
    oldestTweetId: varchar("oldest_tweet_id", { length: 50 }),
    lastRunStartedAt: timestamp("last_run_started_at"),
    lastRunFinishedAt: timestamp("last_run_finished_at"),
    lastError: text("last_error"),
    initialSyncComplete: boolean("initial_sync_complete")
      .notNull()
      .default(false),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => ({
    shardKeyIdx: index("message_fetch_progress_shard_key_idx").on(
      table.shardKey
    ),
    statusIdx: index("message_fetch_progress_status_idx").on(table.status),
  })
);
