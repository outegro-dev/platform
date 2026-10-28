CREATE TABLE "wallet_lot_reversals" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"kind" text NOT NULL,
	"grumbles" bigint NOT NULL,
	"taken" bigint NOT NULL,
	"debt" bigint NOT NULL,
	"money_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"scale" integer NOT NULL,
	"tx_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_lot_reversals_split" CHECK ("wallet_lot_reversals"."taken" + "wallet_lot_reversals"."debt" = "wallet_lot_reversals"."grumbles"),
	CONSTRAINT "wallet_lot_reversals_nonnegative" CHECK ("wallet_lot_reversals"."taken" >= 0 and "wallet_lot_reversals"."debt" >= 0 and "wallet_lot_reversals"."grumbles" > 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_lots" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"order_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"grumbles" bigint NOT NULL,
	"money_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"scale" integer NOT NULL,
	"tx_id" uuid NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_lots_grumbles_positive" CHECK ("wallet_lots"."grumbles" > 0),
	CONSTRAINT "wallet_lots_money_positive" CHECK ("wallet_lots"."money_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "debt" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "wallet_lot_reversals_payment_idx" ON "wallet_lot_reversals" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "wallet_lots_user_idx" ON "wallet_lots" USING btree ("user_id","unit","paid_at");--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_debt_nonnegative" CHECK ("wallets"."debt" >= 0);--> statement-breakpoint
-- Packs and their reversals are history, like the journal: insert only.
REVOKE UPDATE, DELETE, TRUNCATE ON "wallet_lots" FROM CURRENT_USER;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "wallet_lot_reversals" FROM CURRENT_USER;
