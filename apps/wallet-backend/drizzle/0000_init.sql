CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"ref" text NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone NOT NULL
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
CREATE TABLE "reconciliation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"details" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"checked_wallets" integer DEFAULT 0 NOT NULL,
	"issues_found" integer DEFAULT 0 NOT NULL,
	"failed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_accounts" (
	"code" text NOT NULL,
	"unit" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "system_accounts_code_unit_pk" PRIMARY KEY("code","unit")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_version" integer DEFAULT -1 NOT NULL,
	"access_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_refs" (
	"ref" text PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"tx_id" uuid,
	"request_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_tx" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"object_ref" text,
	"ref" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_before" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"wallet_version" integer NOT NULL,
	"counter_account" text NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"meta" jsonb,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_tx_amount_nonzero" CHECK ("wallet_tx"."amount" <> 0),
	CONSTRAINT "wallet_tx_balance_formula" CHECK ("wallet_tx"."balance_after" = "wallet_tx"."balance_before" + "wallet_tx"."amount"),
	CONSTRAINT "wallet_tx_balance_nonnegative" CHECK ("wallet_tx"."balance_after" >= 0),
	CONSTRAINT "wallet_tx_version_positive" CHECK ("wallet_tx"."wallet_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"restricted_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallets_user_id_unit_pk" PRIMARY KEY("user_id","unit"),
	CONSTRAINT "wallets_balance_nonnegative" CHECK ("wallets"."balance" >= 0),
	CONSTRAINT "wallets_restricted_reason" CHECK (("wallets"."state" = 'active') = ("wallets"."restricted_reason" is null))
);
--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_issues_open_uq" ON "reconciliation_issues" USING btree ("kind","subject") WHERE "reconciliation_issues"."state" = 'open';--> statement-breakpoint
CREATE INDEX "reconciliation_issues_seen_idx" ON "reconciliation_issues" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_started_idx" ON "reconciliation_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_tx_version_uq" ON "wallet_tx" USING btree ("user_id","unit","wallet_version");--> statement-breakpoint
CREATE INDEX "wallet_tx_history_idx" ON "wallet_tx" USING btree ("user_id","unit","created_at","id");--> statement-breakpoint
CREATE INDEX "wallet_tx_created_idx" ON "wallet_tx" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wallet_tx_source_idx" ON "wallet_tx" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "wallets_updated_idx" ON "wallets" USING btree ("unit","updated_at","user_id");