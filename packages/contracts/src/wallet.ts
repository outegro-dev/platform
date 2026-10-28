import { z } from "zod";
import {
  adminReasonSchema,
  isoDateTime,
  pageQuerySchema,
  pageSchema,
} from "./primitives.js";

export { adminReasonSchema };

/**
 * Wallet (ADR-011, docs/02-contracts/wallet.md): grumbles, the platform's
 * one internal currency. wallet-backend owns balances and the journal;
 * payments (purchases) and roulette-backend (stakes, payouts) call its
 * internal API, players and operators read it over HTTP. Amounts are
 * whole numbers carried as decimal strings, so JSON never loses digits.
 */

/** Units the wallet keeps: one, grumbles. The column stays on every row. */
export const walletUnits = ["GRM"] as const;
export const walletUnitSchema = z.enum(walletUnits);
export type WalletUnit = z.infer<typeof walletUnitSchema>;

/** A command's amount: a whole number from 1 to 10^15 − 1, as a string. */
export const amountSchema = z.string().regex(/^[1-9]\d{0,14}$/);
/** A balance or a signed journal amount, as a string. */
export const signedAmountSchema = z.string().regex(/^-?\d+$/);

/** An idempotency key from a caller: one operation per ref, ever. */
export const walletRefSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
/**
 * A ref as the journal stores it: a caller's, or one the wallet built,
 * such as `rollback:` + a caller's 200 characters.
 */
export const storedRefSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,209}$/);
/** Refs the wallet builds itself; the internal API refuses them. */
export const reservedRefPrefixes = [
  "grant:",
  "adjust:",
  "set:",
  "rollback:",
] as const;
const callerRefSchema = walletRefSchema.refine(
  (ref) => !reservedRefPrefixes.some((prefix) => ref.startsWith(prefix)),
  { message: "reserved prefix" },
);

export const txKinds = [
  "grant",
  "adjust",
  "debit",
  "credit",
  "reversal",
] as const;
export type TxKind = (typeof txKinds)[number];

export const walletStates = ["active", "restricted"] as const;
export type WalletState = (typeof walletStates)[number];

/** The second leg of every operation. Their sum with all wallets is zero. */
export const systemAccountCodes = [
  "issued_bonus",
  "issued_purchase",
  "spent",
  "adjust",
  "expired",
] as const;
export type SystemAccountCode = (typeof systemAccountCodes)[number];

/**
 * Which service an operation came from and why: every journal row has one.
 * `admin` is the console's commands; the rest call the internal API.
 */
export const walletSources = [
  "roulette",
  "daily-bonus",
  "battleship-shop",
  "pay",
  "admin",
] as const;
export type WalletSource = (typeof walletSources)[number];
/** Sources of the internal API (the console's commands are `admin`). */
export const callerSources = [
  "roulette",
  "daily-bonus",
  "battleship-shop",
  "pay",
] as const;
export type CallerSource = (typeof callerSources)[number];
const callerSourceSchema = z.enum(callerSources);

/** The object an operation is about: `round:1207`, `order:<uuid>`. */
export const objectRefSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);

/** The caller's own context (an order, a roulette round), kept in the journal. */
export const walletMetaSchema = z
  .record(z.string(), z.unknown())
  .refine((meta) => JSON.stringify(meta).length <= 2048, {
    message: "meta over 2 KB",
  });
const reasonSchema = z.string().trim().min(1).max(500);
const correlationIdSchema = z.string().min(1).max(128);

/* ---------- Internal API (service token) ---------- */

export const debitRequestSchema = z.object({
  ref: callerRefSchema,
  userId: z.uuid(),
  unit: walletUnitSchema,
  amount: amountSchema,
  source: callerSourceSchema,
  objectRef: objectRefSchema.optional(),
  reason: reasonSchema.optional(),
  meta: walletMetaSchema.optional(),
  correlationId: correlationIdSchema.optional(),
});
export type DebitRequest = z.infer<typeof debitRequestSchema>;

export const creditItemSchema = z.object({
  ref: callerRefSchema,
  userId: z.uuid(),
  amount: amountSchema,
  objectRef: objectRefSchema.optional(),
  reason: reasonSchema.optional(),
  meta: walletMetaSchema.optional(),
});
export type CreditItem = z.infer<typeof creditItemSchema>;

export const creditBatchRequestSchema = z
  .object({
    unit: walletUnitSchema,
    /** One batch, one source: payouts of a round, a daily bonus. */
    source: callerSourceSchema,
    items: z.array(creditItemSchema).min(1).max(1000),
    correlationId: correlationIdSchema.optional(),
  })
  .superRefine((batch, ctx) => {
    const seen = new Set<string>();
    batch.items.forEach((item, i) => {
      if (seen.has(item.ref))
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "ref"],
          message: "duplicate ref",
        });
      seen.add(item.ref);
    });
  });
export type CreditBatchRequest = z.infer<typeof creditBatchRequestSchema>;

export const rollbackRequestSchema = z.object({
  ref: callerRefSchema,
  reason: reasonSchema.optional(),
  correlationId: correlationIdSchema.optional(),
});
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;

/** One applied operation; `replayed` says it was stored before this call. */
export const operationSchema = z.object({
  txId: z.uuid(),
  ref: storedRefSchema,
  userId: z.uuid(),
  unit: walletUnitSchema,
  kind: z.enum(txKinds),
  source: z.enum(walletSources),
  objectRef: z.string().nullable(),
  amount: signedAmountSchema,
  balanceBefore: signedAmountSchema,
  balanceAfter: signedAmountSchema,
  createdAt: isoDateTime,
  replayed: z.boolean(),
});
export type Operation = z.infer<typeof operationSchema>;

export const creditBatchResponseSchema = z.object({
  items: z.array(operationSchema),
});

export const rollbackResponseSchema = z.object({
  ref: walletRefSchema,
  /** reversed: the debit came back; tombstoned: there was none, and none may come. */
  state: z.enum(["reversed", "tombstoned"]),
  reversal: operationSchema.nullable(),
  replayed: z.boolean(),
});
export type RollbackResponse = z.infer<typeof rollbackResponseSchema>;

/** Balances of many players at once (roulette: a socket has no user token). */
export const balancesRequestSchema = z.object({
  unit: walletUnitSchema,
  userIds: z.array(z.uuid()).min(1).max(1000),
});
export type BalancesRequest = z.infer<typeof balancesRequestSchema>;

export const balanceItemSchema = z.object({
  userId: z.uuid(),
  unit: walletUnitSchema,
  balance: signedAmountSchema,
  state: z.enum(walletStates),
  /** False for a player without operations yet: the balance is zero. */
  exists: z.boolean(),
});
export type BalanceItem = z.infer<typeof balanceItemSchema>;

/** One item per requested id, in the request's order. */
export const balancesResponseSchema = z.object({
  items: z.array(balanceItemSchema),
});

/* ---------- Player ---------- */

export const unitQuerySchema = z.object({
  unit: walletUnitSchema.default("GRM"),
});

export const walletViewSchema = z.object({
  unit: walletUnitSchema,
  balance: signedAmountSchema,
  state: z.enum(walletStates),
  /** False until the first operation: the balance is zero then. */
  exists: z.boolean(),
  updatedAt: isoDateTime.nullable(),
});
export type WalletView = z.infer<typeof walletViewSchema>;

export const historyQuerySchema = pageQuerySchema.extend({
  unit: walletUnitSchema.default("GRM"),
});

/** What a player sees of an operation: no reason, ref, author or meta. */
export const historyItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(txKinds),
  source: z.enum(walletSources),
  amount: signedAmountSchema,
  balanceBefore: signedAmountSchema,
  balanceAfter: signedAmountSchema,
  createdAt: isoDateTime,
});
export type HistoryItem = z.infer<typeof historyItemSchema>;
export const historyPageSchema = pageSchema(historyItemSchema);

/* ---------- Admin ---------- */

export const adminWalletsQuerySchema = pageQuerySchema.extend({
  unit: walletUnitSchema.default("GRM"),
  state: z.enum(walletStates).optional(),
  userId: z.uuid().optional(),
});

export const adminWalletSchema = z.object({
  userId: z.uuid(),
  unit: walletUnitSchema,
  balance: signedAmountSchema,
  state: z.enum(walletStates),
  /** account_suspended, account_deleted; null while active. */
  restrictedReason: z.string().nullable(),
  version: z.number().int().nonnegative(),
  exists: z.boolean(),
  createdAt: isoDateTime.nullable(),
  updatedAt: isoDateTime.nullable(),
});
export type AdminWallet = z.infer<typeof adminWalletSchema>;
export const adminWalletsPageSchema = pageSchema(adminWalletSchema);

export const adminTxSchema = historyItemSchema.extend({
  ref: storedRefSchema,
  objectRef: z.string().nullable(),
  walletVersion: z.number().int().positive(),
  counterAccount: z.enum(systemAccountCodes),
  reason: z.string().nullable(),
  actorId: z.uuid().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  correlationId: z.string().nullable(),
});
export type AdminTx = z.infer<typeof adminTxSchema>;

export const adminWalletCardSchema = z.object({
  wallet: adminWalletSchema,
  history: pageSchema(adminTxSchema),
});
export type AdminWalletCard = z.infer<typeof adminWalletCardSchema>;

/** A wallet's journal in the console, optionally of one source. */
export const adminJournalQuerySchema = historyQuerySchema.extend({
  source: z.enum(walletSources).optional(),
});

/** Grant or take grumbles; `preview` shows before → after and writes nothing. */
export const adminCommandSchema = z.object({
  unit: walletUnitSchema,
  amount: amountSchema,
  reason: adminReasonSchema,
  /** One per opened form: sending the same form twice applies it once. */
  commandId: z.uuid(),
  preview: z.boolean().default(false),
});
export type AdminCommand = z.infer<typeof adminCommandSchema>;

export const commandPreviewSchema = z.object({
  preview: z.literal(true),
  balanceBefore: signedAmountSchema,
  balanceAfter: signedAmountSchema,
});
export type CommandPreview = z.infer<typeof commandPreviewSchema>;

/**
 * Set the balance: the wallet works out the difference and grants or
 * takes it (one operation, ref `set:{commandId}`); the same balance is
 * 422 with nothing to do. `preview` shows before → after.
 */
export const setBalanceCommandSchema = z.object({
  unit: walletUnitSchema,
  balance: z.string().regex(/^(0|[1-9]\d{0,14})$/),
  reason: adminReasonSchema,
  commandId: z.uuid(),
  preview: z.boolean().default(false),
});
export type SetBalanceCommand = z.infer<typeof setBalanceCommandSchema>;

export const reconciliationIssueKinds = [
  "balance_drift",
  "chain_break",
  "system_drift",
  "zero_sum",
] as const;
export type ReconciliationIssueKind = (typeof reconciliationIssueKinds)[number];

export const reconciliationIssueSchema = z.object({
  id: z.uuid(),
  kind: z.enum(reconciliationIssueKinds),
  /** wallet:<userId>:<unit>, system:<code>:<unit> or unit:<unit>. */
  subject: z.string(),
  state: z.enum(["open", "resolved"]),
  details: z.record(z.string(), z.unknown()),
  firstSeenAt: isoDateTime,
  lastSeenAt: isoDateTime,
  resolvedAt: isoDateTime.nullable(),
});
export type ReconciliationIssue = z.infer<typeof reconciliationIssueSchema>;

export const reconciliationRunSchema = z.object({
  id: z.uuid(),
  mode: z.enum(["sample", "full"]),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  checkedWallets: z.number().int().nonnegative(),
  issuesFound: z.number().int().nonnegative(),
  /** The pass threw before it finished its checks. */
  failed: z.boolean(),
});
export type ReconciliationRun = z.infer<typeof reconciliationRunSchema>;

export const reconciliationViewSchema = z.object({
  issues: z.array(reconciliationIssueSchema),
  runs: z.array(reconciliationRunSchema),
});
export type ReconciliationView = z.infer<typeof reconciliationViewSchema>;

export const adminOverviewSchema = z.object({
  unit: walletUnitSchema,
  /** Grumbles on players' wallets now. */
  onHand: signedAmountSchema,
  wallets: z.number().int().nonnegative(),
  restricted: z.number().int().nonnegative(),
  operations24h: z.object(
    Object.fromEntries(
      txKinds.map((kind) => [kind, z.number().int().nonnegative()]),
    ) as Record<TxKind, z.ZodNumber>,
  ),
  systemAccounts: z.array(
    z.object({
      code: z.enum(systemAccountCodes),
      balance: signedAmountSchema,
    }),
  ),
  /** The day's turnover by source: grumbles in and out of players' wallets. */
  turnover24h: z.array(
    z.object({
      source: z.enum(walletSources),
      operations: z.number().int().nonnegative(),
      credited: signedAmountSchema,
      debited: signedAmountSchema,
    }),
  ),
  openIssues: z.number().int().nonnegative(),
  lastReconciliation: reconciliationRunSchema.nullable(),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminAuditActions = [
  "wallet.grant",
  "wallet.adjust",
  "wallet.set",
] as const;

export const adminAuditEntrySchema = z.object({
  id: z.uuid(),
  action: z.enum(adminAuditActions),
  actorId: z.uuid(),
  userId: z.uuid(),
  unit: walletUnitSchema,
  amount: signedAmountSchema,
  reason: z.string(),
  ref: storedRefSchema,
  requestId: z.string().nullable(),
  createdAt: isoDateTime,
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;
export const adminAuditPageSchema = pageSchema(adminAuditEntrySchema);
