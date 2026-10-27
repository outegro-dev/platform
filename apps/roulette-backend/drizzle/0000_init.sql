CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"client_bet_id" uuid NOT NULL,
	"color" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"payout" bigint,
	"created_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "players" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"betting_ends_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"rolling_at" timestamp with time zone,
	"settle_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"next_round_at" timestamp with time zone,
	"number" smallint,
	"color" text,
	"seed" text,
	"bets" integer DEFAULT 0 NOT NULL,
	"staked" bigint DEFAULT 0 NOT NULL,
	"paid_out" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bets_round_idx" ON "bets" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "bets_user_idx" ON "bets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "players_nickname_uq" ON "players" USING btree (lower("nickname")) WHERE "players"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "rounds_settled_idx" ON "rounds" USING btree ("id") WHERE "rounds"."status" = 'settled';