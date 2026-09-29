import type {
  BotLevel,
  FinishReason,
  ShipPlacement,
  ShotOutcome,
} from "@outegro/battleship-engine";
import type { ServerMessage } from "@outegro/contracts/battleship";
import type { MatchMode, RatingChange } from "../rating.js";

/** Seats of a match. "a" is the human against a bot and the owner of a room. */
export type SideKey = "a" | "b";
export const SIDES: readonly SideKey[] = ["a", "b"];
export const otherSide = (side: SideKey): SideKey => (side === "a" ? "b" : "a");

/** A human seat with what the opponent may see (never the user id on the wire). */
export type HumanSeat = {
  readonly kind: "human";
  readonly userId: string;
  readonly nickname: string;
  readonly rating: number;
  readonly premium: boolean;
};
export type BotSeat = { readonly kind: "bot"; readonly level: BotLevel };
export type Seat = HumanSeat | BotSeat;

/** Engine id of the bot side; user ids are UUIDs, so it cannot collide. */
export const BOT_ID = "bot";

export type MatchRecord = {
  readonly id: string;
  readonly mode: MatchMode;
  readonly rated: boolean;
  readonly seats: Readonly<Record<SideKey, Seat>>;
  readonly firstTurn: SideKey;
  readonly createdAt: Date;
};

/** What happened, in order: replaying the log rebuilds the engine state. */
export type MatchAction =
  | {
      readonly kind: "place";
      readonly side: SideKey;
      readonly ships: readonly ShipPlacement[];
    }
  | {
      readonly kind: "shot";
      readonly side: SideKey;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: "skip"; readonly side: SideKey }
  /** The placement clock ran out. */
  | { readonly kind: "timeout"; readonly side: SideKey }
  | { readonly kind: "resign"; readonly side: SideKey }
  /** Left and did not come back, went idle against a bot, or lost the account. */
  | { readonly kind: "abandon"; readonly side: SideKey };

/** One row of `moves`: a shot or a skipped turn. */
export type StoredMove = {
  readonly n: number;
  readonly side: SideKey;
  readonly x: number | null;
  readonly y: number | null;
  readonly outcome: ShotOutcome | "skip";
};

export type AbortReason = "placement_timeout" | "moderation" | "abandoned";

/** A moderation record written in the same transaction as its effect. */
export type AuditEntry = {
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly reason: string;
  readonly data?: Record<string, unknown>;
};

export type FinishInput = {
  readonly record: MatchRecord;
  readonly winner: SideKey;
  readonly reason: FinishReason;
  /** Shots fired in the match. */
  readonly moves: number;
  /** The shot or skip that ended the match, stored with the result. */
  readonly finalMove: StoredMove | null;
  readonly at: Date;
};

export type FinishResult = {
  /** Rating changes of rated matches, per human side. */
  readonly ratings: Partial<Record<SideKey, RatingChange>>;
};

/**
 * Persistence of a live match. `finish` stores the result, statistics,
 * rating changes and the outbox event in one transaction.
 */
export interface MatchStore {
  savePlacement(
    matchId: string,
    side: SideKey,
    ships: readonly ShipPlacement[],
    battleStartedAt: Date | null,
    at: Date,
  ): Promise<void>;
  saveMove(matchId: string, move: StoredMove, at: Date): Promise<void>;
  finish(input: FinishInput): Promise<FinishResult>;
  abort(
    matchId: string,
    reason: AbortReason,
    at: Date,
    audit: AuditEntry | null,
  ): Promise<void>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A server message before the connection numbers it (`seq`). */
export type Outgoing = DistributiveOmit<ServerMessage, "seq">;

/** Where a session's messages go: every open socket of the user. */
export interface SessionOutlet {
  send(userId: string, message: Outgoing): void;
  isOnline(userId: string): boolean;
}

export type SessionEnd =
  | {
      readonly kind: "finished";
      readonly winner: SideKey;
      readonly reason: FinishReason;
      readonly result: FinishResult;
    }
  | { readonly kind: "aborted"; readonly reason: AbortReason };

/** Clocks of §16.6. */
export type GameTimings = {
  readonly placementMs: number;
  readonly turnMs: number;
  readonly graceMs: number;
  readonly botIdleMs: number;
  readonly botThinkMinMs: number;
  readonly botThinkMaxMs: number;
  /** Delay before a timer action that failed to store is tried again. */
  readonly retryMs: number;
};

export const defaultTimings: GameTimings = {
  placementMs: 90_000,
  turnMs: 30_000,
  graceMs: 60_000,
  botIdleMs: 15 * 60_000,
  botThinkMinMs: 600,
  botThinkMaxMs: 1_400,
  retryMs: 5_000,
};
