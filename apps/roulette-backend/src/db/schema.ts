import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** Grumbles fit a JS number: wallet amounts stay below 10^15. */
const grumbles = (name: string) => bigint(name, { mode: "number" });

export const playerStatuses = ["active", "suspended", "deleted"] as const;
export const roundStatuses = [
  "betting",
  "locked",
  "rolling",
  "settled",
] as const;
export const betColors = ["red", "black", "green"] as const;
export const betStatuses = ["accepted", "won", "lost"] as const;

/**
 * A roulette account, created on first access. The nickname is the game's
 * own: identity names and emails never reach the bet lists.
 */
export const players = pgTable(
  "players",
  {
    userId: uuid("user_id").primaryKey(),
    nickname: text("nickname").notNull(),
    status: text("status", { enum: playerStatuses })
      .notNull()
      .default("active"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("players_nickname_uq")
      .on(sql`lower(${t.nickname})`)
      .where(sql`${t.status} <> 'deleted'`),
  ],
);

/**
 * One round. The id is also the link of the seed chain it reveals, and the
 * fencing token of the engine: every transition is a conditional update
 * from the expected status (ADR-012).
 */
export const rounds = pgTable(
  "rounds",
  {
    id: integer("id").primaryKey(),
    status: text("status", { enum: roundStatuses }).notNull(),
    openedAt: at("opened_at").notNull(),
    bettingEndsAt: at("betting_ends_at").notNull(),
    lockedAt: at("locked_at"),
    rollingAt: at("rolling_at"),
    settleAt: at("settle_at"),
    settledAt: at("settled_at"),
    nextRoundAt: at("next_round_at"),
    number: smallint("number"),
    color: text("color", { enum: betColors }),
    /** The revealed seed: SHA-256(seed) is the previous round's seed. */
    seed: text("seed"),
    bets: integer("bets").notNull().default(0),
    staked: grumbles("staked").notNull().default(0),
    paidOut: grumbles("paid_out").notNull().default(0),
  },
  (t) => [
    index("rounds_settled_idx").on(t.id).where(sql`${t.status} = 'settled'`),
  ],
);

/**
 * An accepted bet: written only after the wallet debit, in the same
 * transaction that sees the round still taking bets.
 */
export const bets = pgTable(
  "bets",
  {
    /** Derived from the user and clientBetId: a retry maps to the same bet and ref. */
    id: uuid("id").primaryKey(),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id),
    userId: uuid("user_id").notNull(),
    clientBetId: uuid("client_bet_id").notNull(),
    color: text("color", { enum: betColors }).notNull(),
    amount: grumbles("amount").notNull(),
    status: text("status", { enum: betStatuses }).notNull().default("accepted"),
    payout: grumbles("payout"),
    createdAt: at("created_at").notNull(),
    settledAt: at("settled_at"),
  },
  (t) => [
    index("bets_round_idx").on(t.roundId),
    index("bets_user_idx").on(t.userId, t.createdAt),
  ],
);
