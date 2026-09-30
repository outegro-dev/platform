-- Rows stored before the columns keep 0: Identity's aggregateVersion was not
-- kept, and every event they saw is already in the inbox, so only an event
-- not yet processed can still set these fields once; from then on it is
-- ordered like any other.
ALTER TABLE "customers" ADD COLUMN "contact_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "locale_version" integer DEFAULT 0 NOT NULL;
