CREATE TABLE "following" (
	"follower_id" integer NOT NULL,
	"following_id" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "following_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
ALTER TABLE "following" ADD CONSTRAINT "following_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "following" ADD CONSTRAINT "following_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "following_follower_id_idx" ON "following" USING btree ("follower_id");--> statement-breakpoint
CREATE INDEX "following_following_id_idx" ON "following" USING btree ("following_id");