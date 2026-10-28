CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"user_id" uuid NOT NULL,
	"claim_no" integer NOT NULL,
	"status" text NOT NULL,
	"prize_index" smallint NOT NULL,
	"base_prize" bigint NOT NULL,
	"prize" bigint NOT NULL,
	"streak" integer NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"granted_at" timestamp with time zone,
	"ip_hash" text,
	"device_hash" text,
	"settings_version" integer NOT NULL,
	CONSTRAINT "claims_user_id_claim_no_pk" PRIMARY KEY("user_id","claim_no")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean NOT NULL,
	"streaks_enabled" boolean NOT NULL,
	"prizes" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE INDEX "claims_claimed_idx" ON "claims" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "claims_ip_idx" ON "claims" USING btree ("ip_hash","claimed_at");--> statement-breakpoint
CREATE INDEX "claims_device_idx" ON "claims" USING btree ("device_hash","claimed_at");