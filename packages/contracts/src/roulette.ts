import { z } from "zod";
import { isoDateTime } from "./primitives.js";

/**
 * Roulette (ADR-012): what crosses the wire between roulette-web and
 * roulette-backend, and between roulette-backend and fair-roll-backend. The
 * wheel, payouts and the fair roll live in `@outegro/roulette-engine`.
 */

/** Free game chips: never bought, never exchanged for grumbles or between players. */
export const chipUnit = "CHIP";

export const rouletteColorSchema = z.enum(["red", "black", "green"]);
export const roulettePhaseSchema = z.enum([
  "betting",
  "locked",
  "rolling",
  "settled",
]);

const seedHex = z.string().regex(/^[0-9a-f]{64}$/);
const roundId = z.number().int().positive();
const chips = z.number().int().nonnegative();

export const tableSchema = z.object({
  minBet: z.number().int().positive(),
  maxBet: z.number().int().positive(),
  betsPerRound: z.number().int().positive(),
  payoutLimitPerColor: z.number().int().positive(),
  multipliers: z.object({
    red: z.number(),
    black: z.number(),
    green: z.number(),
  }),
  timings: z.object({
    bettingMs: z.number().int().positive(),
    lockedMs: z.number().int().positive(),
    rollingMs: z.number().int().positive(),
    settledMs: z.number().int().positive(),
  }),
});
export type TableView = z.infer<typeof tableSchema>;

/** One line of a colour's list: the biggest bets first. */
export const betLineSchema = z.object({
  betId: z.uuid(),
  nickname: z.string(),
  amount: chips,
});

export const colorTotalsSchema = z.object({
  count: z.number().int().nonnegative(),
  sum: chips,
  /** The seven biggest bets; the rest is "and N more". */
  top: z.array(betLineSchema).max(7),
});

export const roundResultSchema = z.object({
  number: z.number().int().min(0).max(14),
  color: rouletteColorSchema,
  /** The round's revealed seed: SHA-256(seed) is the previous round's seed. */
  seed: seedHex,
});

/** The full state of the current round, broadcast 4 times a second. */
export const roundViewSchema = z.object({
  round: roundId,
  phase: roulettePhaseSchema,
  /** Absolute times; clients correct them with the ping offset. */
  bettingEndsAt: isoDateTime,
  rollingAt: isoDateTime.nullable(),
  settleAt: isoDateTime.nullable(),
  nextRoundAt: isoDateTime.nullable(),
  /** Known from `rolling` on. */
  result: roundResultSchema.nullable(),
  totals: z.object({
    red: colorTotalsSchema,
    black: colorTotalsSchema,
    green: colorTotalsSchema,
  }),
});
export type RoundView = z.infer<typeof roundViewSchema>;

export const historyItemSchema = z.object({
  round: roundId,
  number: z.number().int().min(0).max(14),
  color: rouletteColorSchema,
});
export type HistoryItem = z.infer<typeof historyItemSchema>;

export const ownBetSchema = z.object({
  betId: z.uuid(),
  clientBetId: z.uuid(),
  round: roundId,
  color: rouletteColorSchema,
  amount: chips,
});
export type OwnBet = z.infer<typeof ownBetSchema>;

export const roulettePlayerSchema = z.object({
  nickname: z.string(),
  balance: chips,
});

// WebSocket protocol. Client: `{ type, seq, payload }`; server: `{ type, payload }`,
// replies carry `ref` = the client's seq. State is a full snapshot, so the
// server does not number its frames: a lost tick is healed by the next one.

const clientMessage = <T extends string, P extends z.ZodType>(
  type: T,
  payload: P,
) =>
  z.object({
    type: z.literal(type),
    seq: z.number().int().positive(),
    payload,
  });

export const rouletteClientMessageSchema = z.discriminatedUnion("type", [
  clientMessage(
    "bet.place",
    z.object({
      /** A fresh id per click: a retry or a double click repeats it. */
      clientBetId: z.uuid(),
      color: rouletteColorSchema,
      amount: z.number().int().positive(),
    }),
  ),
  clientMessage("ping", z.object({ t: z.number() })),
]);
export type RouletteClientMessage = z.infer<typeof rouletteClientMessageSchema>;

/** Codes of refused bets and commands; a refusal never moves chips. */
export const rouletteErrorCodeSchema = z.enum([
  "bad_message",
  "round_closed",
  "bet_too_small",
  "bet_too_large",
  "too_many_bets",
  "table_limit",
  "insufficient_funds",
  "wallet_restricted",
  "wallet_unavailable",
  "account_blocked",
  "rate_limited",
  "internal",
]);
export type RouletteErrorCode = z.infer<typeof rouletteErrorCodeSchema>;

const serverMessage = <T extends string, P extends z.ZodType>(
  type: T,
  payload: P,
) =>
  z.object({
    type: z.literal(type),
    ref: z.number().int().positive().optional(),
    payload,
  });

export const rouletteServerMessageSchema = z.discriminatedUnion("type", [
  /** First message of every connection. */
  serverMessage(
    "session.ready",
    z.object({
      player: roulettePlayerSchema,
      table: tableSchema,
      round: roundViewSchema.nullable(),
      /** Your bets in the current round, so a reload keeps them highlighted. */
      yourBets: z.array(ownBetSchema),
      history: z.array(historyItemSchema),
      serverTime: isoDateTime,
    }),
  ),
  /** Broadcast: the same frame to every socket. */
  serverMessage("round.state", z.object({ round: roundViewSchema })),
  serverMessage(
    "bet.accepted",
    z.object({ bet: ownBetSchema, balance: chips }),
  ),
  /** Your balance after a round paid out (or refunded) your bets. */
  serverMessage(
    "balance",
    z.object({
      balance: chips,
      round: roundId,
      /** What the round paid you, 0 when every bet lost. */
      payout: chips,
    }),
  ),
  serverMessage(
    "error",
    z.object({
      code: rouletteErrorCodeSchema,
      /** seq of the refused client message, when there is one. */
      ref: z.number().int().positive().nullable(),
    }),
  ),
  serverMessage("pong", z.object({ t: z.number(), serverTime: isoDateTime })),
]);
export type RouletteServerMessage = z.infer<typeof rouletteServerMessageSchema>;
export type RouletteServerMessageType = RouletteServerMessage["type"];
export type RouletteServerPayload<T extends RouletteServerMessageType> =
  Extract<RouletteServerMessage, { type: T }>["payload"];

// HTTP (roulette-backend `/v1`, called by the roulette-web BFF)

export const rouletteMeSchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
  balance: chips,
  unit: z.literal(chipUnit),
});
export type RouletteMe = z.infer<typeof rouletteMeSchema>;

export const rouletteTicketSchema = z.object({
  ticket: z.string().min(32).max(128),
  expiresAt: isoDateTime,
});

export const historyPageSchema = z.object({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
});

/** What /fair shows for one round: enough to check it without trusting us. */
export const fairRoundSchema = z.object({
  round: roundId,
  phase: roulettePhaseSchema,
  commit: seedHex,
  publicSeed: z.string(),
  /** Revealed once the round spins. */
  seed: seedHex.nullable(),
  number: z.number().int().min(0).max(14).nullable(),
  color: rouletteColorSchema.nullable(),
  /** The previous round's seed (round 1: the commit). */
  previousSeed: seedHex.nullable(),
  bets: z.number().int().nonnegative(),
  staked: chips,
  paidOut: chips,
});
export type FairRound = z.infer<typeof fairRoundSchema>;

export const fairInfoSchema = z.object({
  commit: seedHex,
  publicSeed: z.string(),
  chainLength: z.number().int().positive(),
  lastRevealed: z.number().int().nonnegative(),
});
export type FairInfo = z.infer<typeof fairInfoSchema>;

// Internal: roulette-backend → fair-roll-backend (service token)

export const fairChainSchema = fairInfoSchema;

export const fairRevealSchema = z.object({
  round: roundId,
  seed: seedHex,
  number: z.number().int().min(0).max(14),
  color: rouletteColorSchema,
});
export type FairReveal = z.infer<typeof fairRevealSchema>;
