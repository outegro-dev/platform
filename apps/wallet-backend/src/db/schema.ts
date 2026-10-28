import {
  adminAuditActions,
  reconciliationIssueKinds,
  systemAccountCodes,
  txKinds,
  walletSources,
  walletStates,
  walletUnits,
} from "@outegro/contracts/wallet";
import { platformTables } from "@outegro/db/schema";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** Grumbles are whole numbers; JS float never takes part. */
const grumbles = (name: string) => bigint(name, { mode: "bigint" });

// Events from Identity and Payments; nothing is published yet (no outbox).
export const { inbox } = platformTables;

export const userStatuses = ["active", "suspended", "deleted"] as const;
/** What a ref was used for: an operation, or a rollback that came first. */
export const refOperations = [
  "grant",
  "adjust",
  "set",
  "debit",
  "credit",
  "rollback",
  "tombstone",
  "purchase",
  "clawback",
] as const;
export const issueStates = ["open", "resolved"] as const;
export const lotReversalKinds = ["refund", "chargeback"] as const;
export const runModes = ["sample", "full"] as const;

/**
 * A wallet: the balance of one unit of one player, a cache of the journal
 * changed only by an operation in the same transaction. `version` counts
 * the operations; the journal row of each carries it.
 */
export const wallets = pgTable(
  "wallets",
  {
    userId: uuid("user_id").notNull(),
    unit: text("unit", { enum: walletUnits }).notNull(),
    balance: grumbles("balance").notNull().default(sql`0`),
    state: text("state", { enum: walletStates }).notNull().default("active"),
    restrictedReason: text("restricted_reason"),
    /**
     * Grumbles of refunded or charged-back packs the wallet no longer
     * held (phase 2). While above zero the wallet is restricted; the next
     * pack bought pays it off first.
     */
    debt: grumbles("debt").notNull().default(sql`0`),
    version: integer("version").notNull().default(0),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.unit] }),
    check("wallets_balance_nonnegative", sql`${t.balance} >= 0`),
    check("wallets_debt_nonnegative", sql`${t.debt} >= 0`),
    check(
      "wallets_restricted_reason",
      sql`(${t.state} = 'active') = (${t.restrictedReason} is null)`,
    ),
    index("wallets_updated_idx").on(t.unit, t.updatedAt, t.userId),
  ],
);

/**
 * The journal: one row per operation, the player's leg with its sign; the
 * other leg is `counter_account` with the opposite amount. Insert only: the
 * application role has no UPDATE, DELETE or TRUNCATE, and a trigger refuses
 * them for every role (migration 0001).
 */
export const walletTx = pgTable(
  "wallet_tx",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    unit: text("unit", { enum: walletUnits }).notNull(),
    kind: text("kind", { enum: txKinds }).notNull(),
    /** Which service and why: roulette, daily-bonus, battleship-shop, pay, admin. */
    source: text("source", { enum: walletSources }).notNull(),
    /** The object the operation is about: `round:1207`, `order:<uuid>`. */
    objectRef: text("object_ref"),
    ref: text("ref").notNull(),
    amount: grumbles("amount").notNull(),
    balanceBefore: grumbles("balance_before").notNull(),
    balanceAfter: grumbles("balance_after").notNull(),
    walletVersion: integer("wallet_version").notNull(),
    counterAccount: text("counter_account", {
      enum: systemAccountCodes,
    }).notNull(),
    reason: text("reason"),
    actorId: uuid("actor_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    correlationId: text("correlation_id"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("wallet_tx_version_uq").on(t.userId, t.unit, t.walletVersion),
    index("wallet_tx_history_idx").on(t.userId, t.unit, t.createdAt, t.id),
    index("wallet_tx_created_idx").on(t.createdAt),
    index("wallet_tx_source_idx").on(t.source, t.createdAt),
    check("wallet_tx_amount_nonzero", sql`${t.amount} <> 0`),
    check(
      "wallet_tx_balance_formula",
      sql`${t.balanceAfter} = ${t.balanceBefore} + ${t.amount}`,
    ),
    check("wallet_tx_balance_nonnegative", sql`${t.balanceAfter} >= 0`),
    check("wallet_tx_version_positive", sql`${t.walletVersion} > 0`),
  ],
);

/**
 * Idempotency: one row per ref, claimed before the operation is applied,
 * with the request's fingerprint and the journal row it led to. That row
 * never changes, so it is the stored answer of every repeat. Apart from
 * the journal, so the journal may be partitioned by time later (a
 * partitioned table's UNIQUE must include its key). A rollback before its
 * debit leaves a `tombstone` with no operation; so does its `rollback` row.
 */
export const walletRefs = pgTable("wallet_refs", {
  ref: text("ref").primaryKey(),
  operation: text("operation", { enum: refOperations }).notNull(),
  txId: uuid("tx_id"),
  fingerprint: text("request_fingerprint").notNull(),
  createdAt: at("created_at").notNull(),
});

/** The second leg of every operation; with all wallets they sum to zero per unit. */
export const systemAccounts = pgTable(
  "system_accounts",
  {
    code: text("code", { enum: systemAccountCodes }).notNull(),
    unit: text("unit", { enum: walletUnits }).notNull(),
    balance: grumbles("balance").notNull().default(sql`0`),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.unit] })],
);

/**
 * Accounts as Identity reports them: the status restricts wallets, the
 * access version makes admin commands refuse stale tokens. Versions only
 * move forward, so late or repeated events change nothing.
 */
export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey(),
  status: text("status", { enum: userStatuses }).notNull().default("active"),
  statusVersion: integer("status_version").notNull().default(-1),
  accessVersion: integer("access_version").notNull().default(0),
  updatedAt: at("updated_at").notNull(),
});

/** One open row per (kind, subject); a clean pass resolves it. */
export const reconciliationIssues = pgTable(
  "reconciliation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: reconciliationIssueKinds }).notNull(),
    subject: text("subject").notNull(),
    state: text("state", { enum: issueStates }).notNull().default("open"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    firstSeenAt: at("first_seen_at").notNull(),
    lastSeenAt: at("last_seen_at").notNull(),
    resolvedAt: at("resolved_at"),
  },
  (t) => [
    uniqueIndex("reconciliation_issues_open_uq")
      .on(t.kind, t.subject)
      .where(sql`${t.state} = 'open'`),
    index("reconciliation_issues_seen_idx").on(t.lastSeenAt),
  ],
);

export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mode: text("mode", { enum: runModes }).notNull(),
    startedAt: at("started_at").notNull(),
    finishedAt: at("finished_at"),
    checkedWallets: integer("checked_wallets").notNull().default(0),
    issuesFound: integer("issues_found").notNull().default(0),
    /** The pass threw; its counts are not to be trusted. */
    failed: boolean("failed").notNull().default(false),
  },
  (t) => [index("reconciliation_runs_started_idx").on(t.startedAt)],
);

/**
 * Packs bought with money (phase 2): one per payment, with what was paid,
 * so a refund or a chargeback knows what the grumbles cost. Insert only.
 */
export const walletLots = pgTable(
  "wallet_lots",
  {
    paymentId: uuid("payment_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    unit: text("unit", { enum: walletUnits }).notNull(),
    orderId: uuid("order_id").notNull(),
    productKey: text("product_key").notNull(),
    grumbles: grumbles("grumbles").notNull(),
    moneyMinor: bigint("money_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    scale: integer("scale").notNull(),
    /** The `purchase` operation that credited it. */
    txId: uuid("tx_id").notNull(),
    paidAt: at("paid_at").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    index("wallet_lots_user_idx").on(t.userId, t.unit, t.paidAt),
    check("wallet_lots_grumbles_positive", sql`${t.grumbles} > 0`),
    check("wallet_lots_money_positive", sql`${t.moneyMinor} > 0`),
  ],
);

/**
 * A refund or a chargeback of a pack, once per payments' case: how many
 * grumbles it asked back, how many the wallet still held and took
 * (`clawback`, null when none), and the rest, which became debt.
 */
export const walletLotReversals = pgTable(
  "wallet_lot_reversals",
  {
    caseId: uuid("case_id").primaryKey(),
    /** A lot's payment: checked before the insert (lots never change). */
    paymentId: uuid("payment_id").notNull(),
    userId: uuid("user_id").notNull(),
    unit: text("unit", { enum: walletUnits }).notNull(),
    kind: text("kind", { enum: lotReversalKinds }).notNull(),
    grumbles: grumbles("grumbles").notNull(),
    taken: grumbles("taken").notNull(),
    debt: grumbles("debt").notNull(),
    moneyMinor: bigint("money_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    scale: integer("scale").notNull(),
    txId: uuid("tx_id"),
    occurredAt: at("occurred_at").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    index("wallet_lot_reversals_payment_idx").on(t.paymentId),
    check(
      "wallet_lot_reversals_split",
      sql`${t.taken} + ${t.debt} = ${t.grumbles}`,
    ),
    check(
      "wallet_lot_reversals_nonnegative",
      sql`${t.taken} >= 0 and ${t.debt} >= 0 and ${t.grumbles} > 0`,
    ),
  ],
);

/** Operators' commands, written in the transaction of the operation. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull(),
    action: text("action", { enum: adminAuditActions }).notNull(),
    userId: uuid("user_id").notNull(),
    unit: text("unit", { enum: walletUnits }).notNull(),
    amount: grumbles("amount").notNull(),
    reason: text("reason").notNull(),
    ref: text("ref").notNull(),
    requestId: text("request_id"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt, t.id)],
);
