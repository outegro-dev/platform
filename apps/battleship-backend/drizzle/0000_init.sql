CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
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
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"player_a" uuid NOT NULL,
	"player_b" uuid,
	"bot_level" text,
	"fleet_a" jsonb,
	"fleet_b" jsonb,
	"first_turn" text NOT NULL,
	"winner" text,
	"reason" text,
	"abort_reason" text,
	"moves" integer DEFAULT 0 NOT NULL,
	"rated" boolean NOT NULL,
	"rating_delta" integer,
	"created_at" timestamp with time zone NOT NULL,
	"battle_started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"match_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"side" text NOT NULL,
	"x" smallint,
	"y" smallint,
	"outcome" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "moves_match_id_n_pk" PRIMARY KEY("match_id","n")
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
CREATE TABLE "players" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"rating" integer DEFAULT 1000 NOT NULL,
	"rated_matches" integer DEFAULT 0 NOT NULL,
	"rated_wins" integer DEFAULT 0 NOT NULL,
	"matches" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"cosmetics" jsonb NOT NULL,
	"leaderboard_hidden" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"before" integer NOT NULL,
	"after" integer NOT NULL,
	"delta" integer NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_at_idx" ON "admin_audit" USING btree ("at","id");--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit" USING btree ("target_type","target_id","at");--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "grants" USING btree ("user_id","feature");--> statement-breakpoint
CREATE INDEX "matches_live_idx" ON "matches" USING btree ("created_at") WHERE "matches"."status" in ('placement', 'battle');--> statement-breakpoint
CREATE INDEX "matches_player_a_idx" ON "matches" USING btree ("player_a","finished_at");--> statement-breakpoint
CREATE INDEX "matches_player_b_idx" ON "matches" USING btree ("player_b","finished_at");--> statement-breakpoint
CREATE INDEX "matches_created_idx" ON "matches" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at","created_at") WHERE "outbox"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "players_nickname_uq" ON "players" USING btree (lower("nickname")) WHERE "players"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "players_leaderboard_idx" ON "players" USING btree ("rating" DESC NULLS LAST,"rated_wins" DESC NULLS LAST) WHERE "players"."status" = 'active' and not "players"."leaderboard_hidden" and "players"."rated_matches" > 0;--> statement-breakpoint
CREATE INDEX "players_created_idx" ON "players" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_history_match_user_uq" ON "rating_history" USING btree ("match_id","user_id");--> statement-breakpoint
CREATE INDEX "rating_history_user_idx" ON "rating_history" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "rating_history_at_idx" ON "rating_history" USING btree ("at");