CREATE TABLE "assist_days" (
	"day" date PRIMARY KEY NOT NULL,
	"spent" integer NOT NULL
);
--> statement-breakpoint
-- Days before the table, counted from the usage rows as the ledger counted
-- them until now (the rows of accounts deleted so far are gone): today's
-- count carries over the deploy instead of starting again from 0. Requests
-- the previous version's pod takes until it stops are not added.
INSERT INTO "assist_days" ("day", "spent")
SELECT ("at" AT TIME ZONE 'UTC')::date, count(*)
FROM "assist_usage"
WHERE NOT "cached"
	AND ("outcome" <> 'refused' OR "tokens_in" > 0 OR "tokens_out" > 0)
GROUP BY 1;--> statement-breakpoint
-- Answers cached before the columns name no book version, model or prompt
-- revision to prune them by: dropped, the next request for each asks the
-- model again. TRUNCATE, not DELETE: it holds the table until the columns
-- are added, so an answer the previous version's pod stores meanwhile
-- cannot fail the NOT NULL columns. Until that pod stops, its writes to the
-- cache fail and are logged as "Answer not cached"; its readers still get
-- their answers.
TRUNCATE "assist_cache";--> statement-breakpoint
ALTER TABLE "assist_cache" ADD COLUMN "book_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "assist_cache" ADD COLUMN "content_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "assist_cache" ADD COLUMN "model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "assist_cache" ADD COLUMN "prompt_revision" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "assist_cache" ADD CONSTRAINT "assist_cache_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;