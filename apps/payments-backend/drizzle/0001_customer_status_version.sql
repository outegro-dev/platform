ALTER TABLE "customers" ADD COLUMN "status_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Rows stored before the column: their status counts as current up to the
-- newest access version seen, so only a newer status event replaces it.
UPDATE "customers" SET "status_version" = "access_version";
