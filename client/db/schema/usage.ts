import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const apiUsageTable = pgTable("api_usage", {
  id: text().primaryKey(),
  totalUsd: numeric({ precision: 14, scale: 6 }).notNull().default("0"),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
