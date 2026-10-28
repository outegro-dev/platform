CREATE TABLE "wallet_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"service" text NOT NULL,
	"feature" text NOT NULL,
	"title" jsonb NOT NULL,
	"grumbles" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure" text,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"balance_after" bigint,
	"correlation_id" text NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallet_orders_grumbles_positive" CHECK ("wallet_orders"."grumbles" > 0)
);
--> statement-breakpoint
ALTER TABLE "wallet_orders" ADD CONSTRAINT "wallet_orders_product_key_products_key_fk" FOREIGN KEY ("product_key") REFERENCES "public"."products"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_orders_key_uq" ON "wallet_orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "wallet_orders_user_idx" ON "wallet_orders" USING btree ("user_id","created_at");