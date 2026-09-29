import type { ShipPlacement } from "@outegro/battleship-engine";
import type { Cosmetics } from "@outegro/contracts/battleship";
import { platformTables } from "@outegro/db/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { STARTING_RATING } from "../domain/rating.js";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const { outbox, inbox } = platformTables;

export const playerStatuses = ["active", "suspended", "deleted"] as const;
export const matchModes = ["bot", "quick", "private"] as const;
export const matchStatuses = [
  "placement",
  "battle",
  "finished",
  "aborted",
] as const;
export const botLevels = ["easy", "medium", "hard", "expert"] as const;
export const sides = ["a", "b"] as const;
export const finishReasons = [
  "fleet_destroyed",
  "resigned",
  "timeout",
  "disconnected",
] as const;
export const abortReasons = ["placement_timeout", "moderation"] as const;
export const moveOutcomes = ["miss", "hit", "sunk", "skip"] as const;

/**
 * A game account, created on first access. The nickname is the game's own
 * (identity names and emails never reach the game) and unique ignoring case.
 */
export const players = pgTable(
  "players",
  {
    userId: uuid("user_id").primaryKey(),
    nickname: text("nickname").notNull(),
    rating: integer("rating").notNull().default(STARTING_RATING),
    /** Quick matches played: Elo K = 32 below 30. */
    ratedMatches: integer("rated_matches").notNull().default(0),
    ratedWins: integer("rated_wins").notNull().default(0),
    /** Every finished match, all modes. */
    matches: integer("matches").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    /** What the player chose; what is shown depends on grants in force. */
    cosmetics: jsonb("cosmetics").$type<Cosmetics>().notNull(),
    leaderboardHidden: boolean("leaderboard_hidden").notNull().default(false),
    status: text("status", { enum: playerStatuses })
      .notNull()
      .default("active"),
    /** Identity's accessVersion of the last status applied (newer wins). */
    accessVersion: integer("access_version").notNull().default(0),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    // Deleted accounts all read "Deleted player", so they are left out.
    uniqueIndex("players_nickname_uq")
      .on(sql`lower(${t.nickname})`)
      .where(sql`${t.status} <> 'deleted'`),
    index("players_leaderboard_idx")
      .on(t.rating.desc(), t.ratedWins.desc())
      .where(
        sql`${t.status} = 'active' and not ${t.leaderboardHidden} and ${t.ratedMatches} > 0`,
      ),
    index("players_created_idx").on(t.createdAt),
  ],
);

/**
 * One match. Side "a" is the human in bot matches, the room owner in private
 * ones. Fleets are server-only: they never leave the service while the match
 * is live (TC-BS-03).
 */
export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey(),
    mode: text("mode", { enum: matchModes }).notNull(),
    status: text("status", { enum: matchStatuses }).notNull(),
    playerA: uuid("player_a").notNull(),
    /** null for the bot. */
    playerB: uuid("player_b"),
    botLevel: text("bot_level", { enum: botLevels }),
    fleetA: jsonb("fleet_a").$type<ShipPlacement[]>(),
    fleetB: jsonb("fleet_b").$type<ShipPlacement[]>(),
    firstTurn: text("first_turn", { enum: sides }).notNull(),
    winner: text("winner", { enum: sides }),
    reason: text("reason", { enum: finishReasons }),
    abortReason: text("abort_reason", { enum: abortReasons }),
    /** Shots fired (skipped turns are not moves). */
    moves: integer("moves").notNull().default(0),
    rated: boolean("rated").notNull(),
    /** Points the winner gained and the loser lost; null when unrated. */
    ratingDelta: integer("rating_delta"),
    createdAt: at("created_at").notNull(),
    battleStartedAt: at("battle_started_at"),
    finishedAt: at("finished_at"),
    /** Bumped on every stored change; the aggregate version of events. */
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("matches_live_idx")
      .on(t.createdAt)
      .where(sql`${t.status} in ('placement', 'battle')`),
    index("matches_player_a_idx").on(t.playerA, t.finishedAt),
    index("matches_player_b_idx").on(t.playerB, t.finishedAt),
    index("matches_created_idx").on(t.createdAt, t.id),
  ],
);

/** Every shot and skipped turn, in order: replaying them rebuilds the match. */
export const moves = pgTable(
  "moves",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    side: text("side", { enum: sides }).notNull(),
    /** null for a skipped turn. */
    x: smallint("x"),
    y: smallint("y"),
    outcome: text("outcome", { enum: moveOutcomes }).notNull(),
    at: at("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.n] })],
);

/** Rating changes of quick matches; also feeds the weekly leaderboard. */
export const ratingHistory = pgTable(
  "rating_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    before: integer("before").notNull(),
    after: integer("after").notNull(),
    delta: integer("delta").notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    uniqueIndex("rating_history_match_user_uq").on(t.matchId, t.userId),
    index("rating_history_user_idx").on(t.userId, t.at),
    index("rating_history_at_idx").on(t.at),
  ],
);

/**
 * Projection of commercial grants owned by Payments (billing.grant.changed,
 * service "battleship" only). `version` is the aggregateVersion: older events
 * never overwrite newer state.
 */
export const grants = pgTable(
  "grants",
  {
    grantId: uuid("grant_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    feature: text("feature").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    state: text("state", { enum: ["active", "revoked", "expired"] }).notNull(),
    validFrom: at("valid_from").notNull(),
    validUntil: at("valid_until"),
    version: integer("version").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [index("grants_user_idx").on(t.userId, t.feature)],
);

/** Append-only record of moderation (who, what, to whom, why, when). */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: at("at").notNull(),
  },
  (t) => [
    index("admin_audit_at_idx").on(t.at, t.id),
    index("admin_audit_target_idx").on(t.targetType, t.targetId, t.at),
  ],
);
