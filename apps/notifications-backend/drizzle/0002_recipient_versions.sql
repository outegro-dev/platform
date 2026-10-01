-- Rows stored before the columns keep 0: Identity's versions were not kept,
-- and every event they saw is already in the inbox, so only an event not yet
-- processed can still set these fields once; from then on it is ordered like
-- any other (as payments' 0002_customer_profile_versions).
ALTER TABLE "recipients" ADD COLUMN "contact_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "locale_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "status_version" integer DEFAULT 0 NOT NULL;