import { integer, pgTable, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Graph edges table representing following relationships.
 * Each row represents an outbound connection: follower_id -> following_id
 * (follower_id is following following_id)
 */
export const followingTable = pgTable("following", {
  // The user who is following (source node)
  followerId: integer("follower_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  // The user being followed (target node)
  followingId: integer("following_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  // When this relationship was created/discovered
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // Composite primary key ensures one relationship per pair
  pk: primaryKey({ columns: [table.followerId, table.followingId] }),
  // Index for efficient queries: "who does user X follow?"
  followerIdx: index("following_follower_id_idx").on(table.followerId),
  // Index for efficient queries: "who follows user X?" (reverse lookup)
  followingIdx: index("following_following_id_idx").on(table.followingId),
}));

