CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"min_bet" bigint NOT NULL,
	"max_bet" bigint NOT NULL,
	"bets_per_round" integer NOT NULL,
	"payout_limit_per_color" bigint NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"maintenance" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");