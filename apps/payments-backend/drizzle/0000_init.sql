CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'paid' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_periods_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "billing_periods_order" CHECK ("billing_periods"."period_end" > "billing_periods"."period_start")
);
--> statement-breakpoint
CREATE TABLE "checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"provider" text NOT NULL,
	"provider_invoice_id" text,
	"payment_url" text,
	"buyer_email" text NOT NULL,
	"buyer_language" text NOT NULL,
	"return_url" text NOT NULL,
	"failure_reason" text,
	"checks" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone,
	"requested_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "checkout_attempts_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"source_ref" text NOT NULL,
	"payment_id" uuid,
	"refund_id" uuid,
	"user_id" uuid,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "financial_entries_source_ref_unique" UNIQUE("source_ref")
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"service" text NOT NULL,
	"feature" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"state" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"reason" text,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
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
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"price_id" uuid NOT NULL,
	"price_version" integer NOT NULL,
	"kind" text NOT NULL,
	"service" text NOT NULL,
	"feature" text NOT NULL,
	"periodicity" text NOT NULL,
	"grace_days" integer NOT NULL,
	"provider_offer_id" text NOT NULL,
	"title" jsonb NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"correlation_id" text NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "orders_amount_positive" CHECK ("orders"."amount_minor" > 0)
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
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"subscription_id" uuid,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_contract_id" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"state" text DEFAULT 'confirmed' NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_key" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"version" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	CONSTRAINT "prices_amount_positive" CHECK ("prices"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"key" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"feature" text NOT NULL,
	"kind" text NOT NULL,
	"periodicity" text NOT NULL,
	"provider" text NOT NULL,
	"provider_offer_id" text NOT NULL,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"title" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"source" text NOT NULL,
	"event_key" text NOT NULL,
	"type" text NOT NULL,
	"raw_type" text,
	"status" text NOT NULL,
	"note" text,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"fact" jsonb,
	"contract_id" text,
	"parent_contract_id" text,
	"order_id" uuid,
	"subscription_id" uuid,
	"payment_id" uuid,
	"refund_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reconciliation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subject_key" text NOT NULL,
	"related" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	CONSTRAINT "reconciliation_issues_subject_key_unique" UNIQUE("subject_key")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"payment_id" uuid,
	"user_id" uuid,
	"currency" text,
	"amount_minor" bigint,
	"refund_type" text,
	"state" text NOT NULL,
	"reason" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_by" uuid,
	"provider_event_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"service" text NOT NULL,
	"feature" text NOT NULL,
	"periodicity" text NOT NULL,
	"grace_days" integer NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"provider" text NOT NULL,
	"provider_parent_contract_id" text NOT NULL,
	"buyer_email" text NOT NULL,
	"state" text NOT NULL,
	"provider_status" text,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"paid_until" timestamp with time zone NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"provider_expires_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancel_attempts" integer DEFAULT 0 NOT NULL,
	"next_cancel_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subscriptions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_key_products_key_fk" FOREIGN KEY ("product_key") REFERENCES "public"."products"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_id_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_product_key_products_key_fk" FOREIGN KEY ("product_key") REFERENCES "public"."products"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_log" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_periods_subscription_idx" ON "billing_periods" USING btree ("subscription_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempts_key_uq" ON "checkout_attempts" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_attempts_invoice_uq" ON "checkout_attempts" USING btree ("provider","provider_invoice_id");--> statement-breakpoint
CREATE INDEX "checkout_attempts_due_idx" ON "checkout_attempts" USING btree ("next_check_at") WHERE "checkout_attempts"."next_check_at" is not null;--> statement-breakpoint
CREATE INDEX "financial_entries_time_idx" ON "financial_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_source_uq" ON "grants" USING btree ("source_type","source_id","service","feature");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_manual_active_uq" ON "grants" USING btree ("user_id","service","feature") WHERE "grants"."source_type" = 'manual' and "grants"."state" = 'active';--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grants_expiry_idx" ON "grants" USING btree ("valid_until") WHERE "grants"."state" = 'active' and "grants"."valid_until" is not null;--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at","created_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_contract_uq" ON "payments" USING btree ("provider","provider_contract_id");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id","confirmed_at");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_subscription_idx" ON "payments" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_version_uq" ON "prices" USING btree ("product_key","currency","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_current_uq" ON "prices" USING btree ("product_key","currency") WHERE "prices"."valid_until" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_offer_uq" ON "products" USING btree ("provider","provider_offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_key_uq" ON "provider_events" USING btree ("provider","event_key");--> statement-breakpoint
CREATE INDEX "provider_events_contract_idx" ON "provider_events" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "provider_events_order_idx" ON "provider_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "provider_events_received_idx" ON "provider_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "provider_events_retry_idx" ON "provider_events" USING btree ("next_attempt_at") WHERE "provider_events"."status" in ('received', 'unmatched', 'failed');--> statement-breakpoint
CREATE INDEX "reconciliation_issues_status_idx" ON "reconciliation_issues" USING btree ("status","first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_ref_uq" ON "refunds" USING btree ("provider","kind","provider_ref");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_state_idx" ON "refunds" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_parent_uq" ON "subscriptions" USING btree ("provider","provider_parent_contract_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "subscriptions_due_idx" ON "subscriptions" USING btree ("paid_until") WHERE "subscriptions"."state" <> 'expired';