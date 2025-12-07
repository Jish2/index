ALTER TABLE "users" ADD COLUMN "isBaseUser" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "users" SET "isBaseUser" = true;