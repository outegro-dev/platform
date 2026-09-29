import { z } from "zod";
import { isoDateTime } from "./primitives.js";

/**
 * Battleship (specification chapter 16): what crosses the wire between
 * battleship-web and battleship-backend. The rules live in
 * `@outegro/battleship-engine`; views here mirror its plain-data views.
 */

/** Service key of grants and events. */
export const battleshipService = "battleship";

/** Features granted by Payments through `billing.grant.changed.v1`. */
export const battleshipFeatures = {
  premium: "premium",
  silverFleet: "cosmetics.silver-fleet",
} as const;

export const botLevelSchema = z.enum(["easy", "medium", "hard", "expert"]);
/** Bot levels that need Premium, enforced by the server (TC-BS-08). */
export const premiumBotLevels = ["hard", "expert"] as const;

export const matchModeSchema = z.enum(["bot", "quick", "private"]);
export const matchPhaseSchema = z.enum(["placement", "battle", "finished"]);
export const finishReasonSchema = z.enum([
  "fleet_destroyed",
  "resigned",
  "timeout",
  "disconnected",
]);
/** Players are "you" and "opponent" on the wire: user ids never reach the other side. */
export const sideSchema = z.enum(["you", "opponent"]);

// Board

const coordinate = z.number().int().min(0).max(9);
export const cellSchema = z.object({ x: coordinate, y: coordinate });
export const shipPlacementSchema = z.object({
  x: coordinate,
  y: coordinate,
  length: z.number().int().min(1).max(4),
  orientation: z.enum(["horizontal", "vertical"]),
});
export const cellStateSchema = z.enum(["unknown", "miss", "hit", "sunk"]);
export const shotOutcomeSchema = z.enum(["miss", "hit", "sunk"]);

const gridSchema = z.array(z.array(cellStateSchema));

/** The opponent's board as you know it: never live ships (TC-BS-03). */
export const targetViewSchema = z.object({
  size: z.number().int(),
  cells: gridSchema,
  sunkShips: z.array(shipPlacementSchema),
  remaining: z.array(z.number().int()),
});

/** Your own board: your ships with their hits and every shot you received. */
export const ownViewSchema = z.object({
  size: z.number().int(),
  ships: z.array(
    shipPlacementSchema.extend({
      hits: z.array(cellSchema),
      sunk: z.boolean(),
    }),
  ),
  shots: gridSchema,
});

// Cosmetics

export const shipSkinSchema = z.enum(["classic", "silver"]);
export const hitEffectSchema = z.enum(["flame", "shards"]);
export const boardThemeSchema = z.enum(["day", "night-sea"]);

export const cosmeticsSchema = z.object({
  ships: shipSkinSchema,
  hitEffect: hitEffectSchema,
  theme: boardThemeSchema,
});
export type Cosmetics = z.infer<typeof cosmeticsSchema>;
export type CosmeticSlot = keyof Cosmetics;

export const defaultCosmetics: Cosmetics = {
  ships: "classic",
  hitEffect: "flame",
  theme: "day",
};

/**
 * The feature each item needs (null: free). Premium unlocks every item while
 * it is active. A new set is a new product in Payments plus entries here.
 */
export const cosmeticCatalog: {
  [S in CosmeticSlot]: Record<Cosmetics[S], string | null>;
} = {
  ships: { classic: null, silver: battleshipFeatures.silverFleet },
  hitEffect: { flame: null, shards: battleshipFeatures.silverFleet },
  theme: { day: null, "night-sea": battleshipFeatures.silverFleet },
};

export function cosmeticUnlocked<S extends CosmeticSlot>(
  slot: S,
  item: Cosmetics[S],
  features: ReadonlySet<string>,
): boolean {
  const needs = cosmeticCatalog[slot][item];
  return (
    needs === null ||
    features.has(needs) ||
    features.has(battleshipFeatures.premium)
  );
}

/** What is actually shown: an item whose grant ended falls back to the default (TC-BS-09). */
export function effectiveCosmetics(
  equipped: Cosmetics,
  features: ReadonlySet<string>,
): Cosmetics {
  return {
    ships: cosmeticUnlocked("ships", equipped.ships, features)
      ? equipped.ships
      : defaultCosmetics.ships,
    hitEffect: cosmeticUnlocked("hitEffect", equipped.hitEffect, features)
      ? equipped.hitEffect
      : defaultCosmetics.hitEffect,
    theme: cosmeticUnlocked("theme", equipped.theme, features)
      ? equipped.theme
      : defaultCosmetics.theme,
  };
}

// Match snapshot

export const opponentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot"), level: botLevelSchema }),
  z.object({
    kind: z.literal("human"),
    nickname: z.string(),
    rating: z.number().int(),
    premium: z.boolean(),
  }),
]);

/** Everything one player may know about a match; sent on join and reconnect. */
export const matchSnapshotSchema = z.object({
  matchId: z.uuid(),
  mode: matchModeSchema,
  rated: z.boolean(),
  phase: matchPhaseSchema,
  opponent: opponentSchema,
  turn: sideSchema.nullable(),
  /** End of the current turn or placement window; null without a clock. */
  deadline: isoDateTime.nullable(),
  winner: sideSchema.nullable(),
  reason: finishReasonSchema.nullable(),
  moves: z.number().int().nonnegative(),
  yourFleetPlaced: z.boolean(),
  opponentFleetPlaced: z.boolean(),
  opponentConnected: z.boolean(),
  own: ownViewSchema.nullable(),
  target: targetViewSchema.nullable(),
  /** Revealed only once the match is finished. */
  opponentFleet: z.array(shipPlacementSchema).nullable(),
});
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;

export const ratingChangeSchema = z.object({
  before: z.number().int(),
  after: z.number().int(),
  delta: z.number().int(),
});

// WebSocket protocol: JSON `{ type, seq, payload }`

/** Private room codes: 6 characters without look-alikes (0/O, 1/I). */
export const roomCodeSchema = z
  .string()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/, "invalid_room_code");

const clientMessage = <T extends string, P extends z.ZodType>(
  type: T,
  payload: P,
) =>
  z.object({
    type: z.literal(type),
    /** Per connection, increasing; errors refer back to it. */
    seq: z.number().int().positive(),
    payload,
  });

const empty = z.object({}).strict();

export const clientMessageSchema = z.discriminatedUnion("type", [
  clientMessage("queue.join", z.object({ mode: z.literal("quick") })),
  clientMessage("queue.leave", empty),
  clientMessage("bot.start", z.object({ level: botLevelSchema })),
  clientMessage("room.create", empty),
  clientMessage("room.join", z.object({ code: roomCodeSchema })),
  clientMessage("room.cancel", empty),
  clientMessage(
    "fleet.place",
    z.object({ ships: z.array(shipPlacementSchema).min(1).max(20) }),
  ),
  clientMessage("shot.fire", cellSchema),
  clientMessage("match.resign", empty),
  /** Ask for a fresh match.state (after a gap or on doubt). */
  clientMessage("match.sync", empty),
  clientMessage("ping", z.object({ t: z.number() })),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];

export const playerSummarySchema = z.object({
  nickname: z.string(),
  rating: z.number().int(),
  premium: z.boolean(),
  cosmetics: cosmeticsSchema,
});

/** Codes of rejected commands; an error never changes state (TC-BS-04). */
export const gameErrorCodeSchema = z.enum([
  // Rules (engine)
  "not_a_player",
  "wrong_phase",
  "not_your_turn",
  "fleet_already_placed",
  "wrong_composition",
  "out_of_bounds",
  "overlap",
  "touching",
  "already_shot",
  // Service
  "bad_message",
  "premium_required",
  "already_in_match",
  "already_queued",
  "no_active_match",
  "room_not_found",
  "own_room",
  "rate_limited",
  "internal",
]);
export type GameErrorCode = z.infer<typeof gameErrorCodeSchema>;

const serverMessage = <T extends string, P extends z.ZodType>(
  type: T,
  payload: P,
) =>
  z.object({
    type: z.literal(type),
    seq: z.number().int().positive(),
    payload,
  });

export const serverMessageSchema = z.discriminatedUnion("type", [
  /** First message of every connection. */
  serverMessage(
    "session.ready",
    z.object({
      player: playerSummarySchema,
      activeMatchId: z.uuid().nullable(),
      queuedSince: isoDateTime.nullable(),
      room: z
        .object({ code: roomCodeSchema, expiresAt: isoDateTime })
        .nullable(),
      serverTime: isoDateTime,
    }),
  ),
  /** Rating, Premium or cosmetics changed (a purchase lands without re-login, TC-BS-09). */
  serverMessage("player.updated", z.object({ player: playerSummarySchema })),
  serverMessage(
    "queue.joined",
    z.object({ mode: z.literal("quick"), since: isoDateTime }),
  ),
  serverMessage("queue.left", empty),
  serverMessage("queue.matched", z.object({ matchId: z.uuid() })),
  serverMessage(
    "room.created",
    z.object({ code: roomCodeSchema, expiresAt: isoDateTime }),
  ),
  serverMessage(
    "room.cancelled",
    z.object({ reason: z.enum(["cancelled", "expired"]) }),
  ),
  serverMessage("match.state", z.object({ match: matchSnapshotSchema })),
  serverMessage("fleet.placed", z.object({ side: sideSchema })),
  serverMessage(
    "match.started",
    z.object({ turn: sideSchema, deadline: isoDateTime.nullable() }),
  ),
  serverMessage(
    "shot.result",
    z.object({
      by: sideSchema,
      x: coordinate,
      y: coordinate,
      outcome: shotOutcomeSchema,
      /** The sunk ship, revealed. */
      ship: shipPlacementSchema.optional(),
      /** Water around a sunk ship, now known. */
      revealed: z.array(cellSchema),
      nextTurn: sideSchema.nullable(),
      deadline: isoDateTime.nullable(),
    }),
  ),
  serverMessage(
    "turn.skipped",
    z.object({
      side: sideSchema,
      missedInRow: z.number().int().positive(),
      nextTurn: sideSchema,
      deadline: isoDateTime.nullable(),
    }),
  ),
  serverMessage(
    "opponent.presence",
    z.object({
      connected: z.boolean(),
      /** Until when the opponent may come back before losing. */
      graceUntil: isoDateTime.nullable(),
    }),
  ),
  serverMessage(
    "match.finished",
    z.object({
      winner: sideSchema,
      reason: finishReasonSchema,
      rating: ratingChangeSchema.nullable(),
      opponentFleet: z.array(shipPlacementSchema),
    }),
  ),
  serverMessage(
    "error",
    z.object({
      code: gameErrorCodeSchema,
      /** seq of the rejected client message, when there is one. */
      ref: z.number().int().positive().nullable(),
    }),
  ),
  serverMessage("pong", z.object({ t: z.number() })),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerMessageType = ServerMessage["type"];
export type ServerPayload<T extends ServerMessageType> = Extract<
  ServerMessage,
  { type: T }
>["payload"];

// HTTP (battleship-backend `/v1`, called by the battleship-web BFF)

export const nicknameSchema = z
  .string()
  .trim()
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} _-]{1,18}[\p{L}\p{N}]$/u,
    "invalid_nickname",
  );

export const playerProfileSchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
  rating: z.number().int(),
  /** Fewer than 30 rated matches: K = 32. */
  provisional: z.boolean(),
  matches: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  premium: z.boolean(),
  premiumUntil: isoDateTime.nullable(),
  features: z.array(z.string()),
  cosmetics: z.object({
    equipped: cosmeticsSchema,
    effective: cosmeticsSchema,
  }),
});
export type PlayerProfile = z.infer<typeof playerProfileSchema>;

export const updateProfileSchema = z
  .object({
    nickname: nicknameSchema.optional(),
    cosmetics: cosmeticsSchema.partial().optional(),
  })
  .refine((value) => value.nickname !== undefined || value.cosmetics, {
    message: "empty_update",
  });

export const wsTicketSchema = z.object({
  ticket: z.string().min(32).max(128),
  expiresAt: isoDateTime,
});

export const leaderboardPeriodSchema = z.enum(["all", "week"]);
export const leaderboardSchema = z.object({
  period: leaderboardPeriodSchema,
  /** Week start, Monday 00:00 UTC, for period "week". */
  since: isoDateTime.nullable(),
  items: z.array(
    z.object({
      rank: z.number().int().positive(),
      nickname: z.string(),
      rating: z.number().int(),
      wins: z.number().int().nonnegative(),
      matches: z.number().int().nonnegative(),
      premium: z.boolean(),
    }),
  ),
  /** The caller's own place; null when signed out or unranked. */
  you: z
    .object({
      rank: z.number().int().positive().nullable(),
      rating: z.number().int(),
      wins: z.number().int().nonnegative(),
      matches: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;

export const playerStatsSchema = z.object({
  matches: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  /** 0..1; null before the first match. */
  winRate: z.number().min(0).max(1).nullable(),
  /** Hits / shots, 0..1; null before the first shot. */
  accuracy: z.number().min(0).max(1).nullable(),
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  averageMovesToWin: z.number().nonnegative().nullable(),
  botWins: z.record(botLevelSchema, z.number().int().nonnegative()),
  /** Shots per cell, [y][x]; Premium only, otherwise null. */
  heatmap: z.array(z.array(z.number().int().nonnegative())).nullable(),
});
export type PlayerStats = z.infer<typeof playerStatsSchema>;

export const matchSummarySchema = z.object({
  matchId: z.uuid(),
  mode: matchModeSchema,
  opponent: opponentSchema,
  result: z.enum(["win", "loss"]),
  reason: finishReasonSchema,
  moves: z.number().int().nonnegative(),
  ratingDelta: z.number().int().nullable(),
  finishedAt: isoDateTime,
});

/** Full record of a finished match (Premium): both fleets and every shot. */
export const matchReplaySchema = z.object({
  matchId: z.uuid(),
  mode: matchModeSchema,
  opponent: opponentSchema,
  winner: sideSchema,
  reason: finishReasonSchema,
  fleets: z.object({
    you: z.array(shipPlacementSchema),
    opponent: z.array(shipPlacementSchema),
  }),
  moves: z.array(
    z.object({
      n: z.number().int().positive(),
      by: sideSchema,
      x: coordinate,
      y: coordinate,
      outcome: shotOutcomeSchema,
    }),
  ),
  startedAt: isoDateTime,
  finishedAt: isoDateTime,
});
