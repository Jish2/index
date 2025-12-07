CREATE TABLE IF NOT EXISTS "messages" (
	"tweet_id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"x_user_id" varchar(50) NOT NULL,
	"text" text NOT NULL,
	"lang" varchar(16),
	"like_count" integer DEFAULT 0,
	"reply_count" integer DEFAULT 0,
	"repost_count" integer DEFAULT 0,
	"quote_count" integer DEFAULT 0,
	"tweet_created_at" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"conversation_id" varchar(50),
	"in_reply_to_user_id" varchar(50),
	"referenced_tweet_id" varchar(50),
	"raw_payload" jsonb,
	"embeddedAt" timestamp,
	"embedding_error" text,
	"embedding_version" varchar(32)
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_user_id_idx" ON "messages" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_tweet_created_at_idx" ON "messages" USING btree ("tweet_created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_embedded_at_idx" ON "messages" USING btree ("embeddedAt");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_fetch_progress" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"shard_key" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"total_fetched" integer DEFAULT 0 NOT NULL,
	"newest_tweet_id" varchar(50),
	"oldest_tweet_id" varchar(50),
	"last_run_started_at" timestamp,
	"last_run_finished_at" timestamp,
	"last_error" text,
	"initial_sync_complete" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_fetch_progress" ADD CONSTRAINT "message_fetch_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_fetch_progress_shard_key_idx" ON "message_fetch_progress" USING btree ("shard_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_fetch_progress_status_idx" ON "message_fetch_progress" USING btree ("status");

