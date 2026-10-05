CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"locale" text NOT NULL,
	"status" text NOT NULL,
	"rule" jsonb NOT NULL,
	"content_version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"meta" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "books_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "card_states" (
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "card_states_user_id_book_id_card_id_pk" PRIMARY KEY("user_id","book_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"book_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"key" text NOT NULL,
	"short" text NOT NULL,
	"title" text NOT NULL,
	"document" jsonb NOT NULL,
	"exercise_ids" text[] NOT NULL,
	"card_ids" text[] NOT NULL,
	"cards" jsonb NOT NULL,
	"sections" jsonb NOT NULL,
	"uses_event_loop" boolean NOT NULL,
	"uses_sandbox" boolean NOT NULL,
	CONSTRAINT "chapters_book_id_n_pk" PRIMARY KEY("book_id","n")
);
--> statement-breakpoint
CREATE TABLE "exercise_results" (
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"exercise_id" text NOT NULL,
	"solved" boolean NOT NULL,
	"attempts" integer NOT NULL,
	"first_solved_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exercise_results_user_id_book_id_exercise_id_pk" PRIMARY KEY("user_id","book_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"grant_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"state" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"exchange" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reader_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "reader_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "reader_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"last_chapter" integer,
	"explain_view" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_version" integer DEFAULT 0 NOT NULL,
	"status_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_states" ADD CONSTRAINT "card_states_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_results" ADD CONSTRAINT "exercise_results_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_progress" ADD CONSTRAINT "reader_progress_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_at_idx" ON "admin_audit" USING btree ("at","id");--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit" USING btree ("target_type","target_id","at");--> statement-breakpoint
CREATE INDEX "exercise_results_solved_idx" ON "exercise_results" USING btree ("first_solved_at") WHERE "exercise_results"."first_solved_at" is not null;--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "grants" USING btree ("user_id","feature");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at","created_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "reader_days_day_idx" ON "reader_days" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "reader_progress_user_book_uq" ON "reader_progress" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "reader_progress_active_idx" ON "reader_progress" USING btree ("last_active_at","id");--> statement-breakpoint
CREATE INDEX "reader_progress_book_idx" ON "reader_progress" USING btree ("book_id","last_active_at");