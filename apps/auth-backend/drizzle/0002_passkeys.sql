CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"aaguid" uuid NOT NULL,
	"rp_id" text NOT NULL,
	"backup_eligible" boolean NOT NULL,
	"backed_up" boolean NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_uq" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id","created_at");