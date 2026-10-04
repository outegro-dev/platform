CREATE TABLE "assist_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assist_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter" integer NOT NULL,
	"cached" boolean NOT NULL,
	"outcome" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "understanding_checks" (
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter" integer NOT NULL,
	"best_score" smallint NOT NULL,
	"last_score" smallint NOT NULL,
	"checks" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "understanding_checks_user_id_book_id_chapter_pk" PRIMARY KEY("user_id","book_id","chapter")
);
--> statement-breakpoint
ALTER TABLE "card_states" ADD COLUMN "last_key" uuid;--> statement-breakpoint
ALTER TABLE "exercise_results" ADD COLUMN "last_attempt_key" uuid;--> statement-breakpoint
ALTER TABLE "exercise_results" ADD COLUMN "last_attempt_hash" text;--> statement-breakpoint
ALTER TABLE "exercise_results" ADD COLUMN "last_correct" boolean;--> statement-breakpoint
ALTER TABLE "assist_usage" ADD CONSTRAINT "assist_usage_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "understanding_checks" ADD CONSTRAINT "understanding_checks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assist_usage_user_at_idx" ON "assist_usage" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "assist_usage_at_idx" ON "assist_usage" USING btree ("at");