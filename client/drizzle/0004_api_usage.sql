CREATE TABLE IF NOT EXISTS "api_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"total_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
