import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  CommandPreview,
  CreditItem,
  Operation,
  RollbackResponse,
  SystemAccountCode,
  TxKind,
  WalletSource,
  WalletUnit,
} from "@outegro/contracts/wallet";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type {
  RefRow,
  TxRow,
  WalletDatabase,
  WalletTx,
} from "../common/database.js";
import { WalletMetrics } from "../common/metrics.js";
import {
  auditLog,
  type refOperations,
  systemAccounts,
  users,
  walletRefs,
  wallets,
  walletTx,
} from "../db/schema.js";

type RefOperation = (typeof refOperations)[number];

/** A claimed ref: a fresh operation's id, or the stored answer of a repeat. */
type Claim = { txId: string; replay?: Operation };

/** Who acts: an operator (admin command) or a service over the internal API. */
export type Actor = { userId: string; requestId: string | null };

type Posting = {
  ref: string;
  userId: string;
  unit: WalletUnit;
  /** The magnitude; the kind gives the sign. */
  amount: bigint;
  source: WalletSource;
  objectRef?: string | null;
  /** The other leg, when it is not the kind's own (a reversal: its debit's). */
  counter?: SystemAccountCode;
  reason?: string | null;
  actorId?: string | null;
  meta?: Record<string, unknown> | null;
  correlationId?: string | null;
};

/** The sign and the second leg of every kind (docs/02-contracts/wallet.md). */
const LEGS: Record<TxKind, { sign: 1n | -1n; counter: SystemAccountCode }> = {
  grant: { sign: 1n, counter: "issued_bonus" },
  adjust: { sign: -1n, counter: "adjust" },
  debit: { sign: -1n, counter: "spent" },
  credit: { sign: 1n, counter: "spent" },
  reversal: { sign: 1n, counter: "spent" },
};

/**
 * Credits by source: a daily bonus is issued, anything else (a payout, a
 * return) gives back what was spent. Packs bought with money (phase 2)
 * arrive through the inbox with their own leg, not through this API.
 */
const CREDIT_COUNTER: Partial<Record<WalletSource, SystemAccountCode>> = {
  "daily-bonus": "issued_bonus",
};
const counterOf = (kind: TxKind, posting: Posting): SystemAccountCode =>
  posting.counter ??
  (kind === "credit"
    ? (CREDIT_COUNTER[posting.source] ?? "spent")
    : LEGS[kind].counter);

/** Reasons a wallet is restricted while its account is not active. */
const ACCOUNT_REASON = {
  suspended: "account_suspended",
  deleted: "account_deleted",
} as const;

const fingerprintOf = (operation: RefOperation, parts: (string | bigint)[]) =>
  createHash("sha256")
    .update(JSON.stringify([operation, ...parts.map(String)]))
    .digest("hex");

const conflict = (field = "ref", why = "conflict") =>
  new AppError("IDEMPOTENCY_CONFLICT", { fieldErrors: { [field]: [why] } });

export function toOperation(row: TxRow, replayed: boolean): Operation {
  return {
    txId: row.id,
    ref: row.ref,
    userId: row.userId,
    unit: row.unit,
    kind: row.kind,
    source: row.source,
    objectRef: row.objectRef,
    amount: row.amount.toString(),
    balanceBefore: row.balanceBefore.toString(),
    balanceAfter: row.balanceAfter.toString(),
    createdAt: row.createdAt.toISOString(),
    replayed,
  };
}

/**
 * The only writer of balances. Every operation is one transaction: claim
 * the ref, move the wallet (the row lock serialises one player's
 * operations; a debit's WHERE keeps the balance from going below zero),
 * write the journal row, move the system account of the other leg.
 * Locks are taken in one order everywhere — refs, wallets by
 * (user, unit), system accounts — so operations never deadlock.
 */
@Injectable()
export class WalletLedger {
  constructor(
    @Inject(DATABASE) private readonly database: WalletDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly metrics: WalletMetrics,
  ) {}

  /** Internal API: a purchase or a stake. Refused from a restricted wallet. */
  debit(input: Posting): Promise<Operation> {
    return this.metrics.time("debit", () =>
      this.database.db.transaction(async (tx) => {
        const claimed = await this.claim(tx, "debit", input);
        if (claimed.replay) return claimed.replay;
        const row = await this.take(tx, "debit", input, claimed.txId, true);
        return toOperation(row, false);
      }),
    );
  }

  /** Internal API: payouts and returns, all items or none. */
  creditBatch(
    unit: WalletUnit,
    source: WalletSource,
    items: CreditItem[],
    correlationId: string | null,
  ): Promise<Operation[]> {
    return this.metrics.time("credit", () =>
      this.database.db.transaction(async (tx) => {
        const postings: Posting[] = items.map((item) => ({
          ...item,
          unit,
          source,
          amount: BigInt(item.amount),
          correlationId,
        }));
        // Refs first, in one order: two batches sharing refs cannot deadlock.
        const order = [...postings.entries()].sort(([, a], [, b]) =>
          a.ref < b.ref ? -1 : 1,
        );
        const claims = new Map<number, Claim>();
        for (const [i, posting] of order) {
          try {
            claims.set(i, await this.claim(tx, "credit", posting));
          } catch (error) {
            if (error instanceof AppError)
              throw new AppError(error.code, {
                fieldErrors: {
                  [`items.${i}.ref`]: error.fieldErrors.ref ?? ["conflict"],
                },
              });
            throw error;
          }
        }
        const fresh = postings.filter((_, i) => !claims.get(i)?.replay);
        await this.lockWallets(tx, fresh);
        const results: Operation[] = [];
        let total = 0n;
        for (const [i, posting] of postings.entries()) {
          const claim = claims.get(i);
          if (claim?.replay) {
            results.push(claim.replay);
            continue;
          }
          const row = await this.give(tx, "credit", posting, claim?.txId ?? "");
          total += row.amount;
          results.push(toOperation(row, false));
        }
        const [first] = postings;
        if (first)
          await this.moveSystem(tx, counterOf("credit", first), unit, -total);
        return results;
      }),
    );
  }

  /**
   * Internal API: undo a debit. A debit that never came gets a tombstone,
   * and a late debit with that ref is refused (409 rolled_back).
   */
  rollback(input: {
    ref: string;
    reason?: string | null;
    correlationId?: string | null;
  }): Promise<RollbackResponse> {
    return this.metrics.time("reversal", () =>
      this.database.db.transaction(async (tx) => {
        const now = this.clock.now();
        const rollbackRef = `rollback:${input.ref}`;
        const fingerprint = fingerprintOf("rollback", [input.ref]);
        // A tombstone takes the ref if no debit holds it. A debit still in
        // flight makes this insert wait for its commit or rollback.
        const tombstone = await tx
          .insert(walletRefs)
          .values({
            ref: input.ref,
            operation: "tombstone",
            txId: null,
            fingerprint,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ ref: walletRefs.ref });
        if (tombstone.length > 0) {
          await tx.insert(walletRefs).values({
            ref: rollbackRef,
            operation: "rollback",
            txId: null,
            fingerprint,
            createdAt: now,
          });
          this.metrics.operation("reversal", "tombstoned");
          return {
            ref: input.ref,
            state: "tombstoned",
            reversal: null,
            replayed: false,
          };
        }
        const original = await this.refRow(tx, input.ref);
        if (original.operation === "tombstone")
          return this.replayRollback(tx, input.ref);
        if (original.operation !== "debit" || !original.txId)
          throw new AppError("UNPROCESSABLE", {
            fieldErrors: { ref: ["not_debit"] },
          });
        const txId = randomUUID();
        const claimed = await tx
          .insert(walletRefs)
          .values({
            ref: rollbackRef,
            operation: "rollback",
            txId,
            fingerprint,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ ref: walletRefs.ref });
        if (claimed.length === 0) return this.replayRollback(tx, input.ref);
        const [debit] = await tx
          .select()
          .from(walletTx)
          .where(eq(walletTx.id, original.txId));
        if (!debit) throw new Error(`journal row of ${input.ref} is missing`);
        const row = await this.give(
          tx,
          "reversal",
          {
            ref: rollbackRef,
            userId: debit.userId,
            unit: debit.unit,
            amount: -debit.amount,
            source: debit.source,
            objectRef: debit.objectRef,
            counter: debit.counterAccount,
            reason: input.reason ?? null,
            meta: { reverses: debit.id },
            correlationId: input.correlationId ?? null,
          },
          txId,
        );
        await this.moveSystem(
          tx,
          debit.counterAccount,
          debit.unit,
          -row.amount,
        );
        return {
          ref: input.ref,
          state: "reversed",
          reversal: toOperation(row, false),
          replayed: false,
        };
      }),
    );
  }

  /** Admin command: grant grumbles (operator, promo, compensation). */
  grant(actor: Actor, input: Posting): Promise<Operation> {
    return this.metrics.time("grant", () =>
      this.database.db.transaction(async (tx) => {
        const claimed = await this.claim(tx, "grant", input);
        if (claimed.replay) return claimed.replay;
        await this.lockWallets(tx, [input]);
        const row = await this.give(tx, "grant", input, claimed.txId);
        await this.moveSystem(
          tx,
          counterOf("grant", input),
          input.unit,
          -row.amount,
        );
        await this.audit(tx, actor, "wallet.grant", row);
        return toOperation(row, false);
      }),
    );
  }

  /** Admin command: take grumbles. Works on a restricted wallet too. */
  adjust(actor: Actor, input: Posting): Promise<Operation> {
    return this.metrics.time("adjust", () =>
      this.database.db.transaction(async (tx) => {
        const claimed = await this.claim(tx, "adjust", input);
        if (claimed.replay) return claimed.replay;
        const row = await this.take(tx, "adjust", input, claimed.txId, false);
        await this.audit(tx, actor, "wallet.adjust", row);
        return toOperation(row, false);
      }),
    );
  }

  /**
   * Admin command: set the balance. Under the wallet's lock the difference
   * is worked out and granted or taken as one operation (ref
   * `set:{commandId}`, `amount` is the target); the same balance is 422,
   * a difference over the cap 400.
   */
  setBalance(
    actor: Actor,
    input: Posting,
    maxAmount: bigint,
  ): Promise<Operation> {
    return this.metrics.time("set", () =>
      this.database.db.transaction(async (tx) => {
        const claimed = await this.claim(tx, "set", input);
        if (claimed.replay) return claimed.replay;
        await this.lockWallets(tx, [input]);
        const [wallet] = await tx
          .select({ balance: wallets.balance })
          .from(wallets)
          .where(
            and(eq(wallets.userId, input.userId), eq(wallets.unit, input.unit)),
          );
        const diff = input.amount - (wallet?.balance ?? 0n);
        if (diff === 0n)
          throw new AppError("UNPROCESSABLE", {
            fieldErrors: { balance: ["unchanged"] },
          });
        const amount = diff > 0n ? diff : -diff;
        if (amount > maxAmount)
          throw new AppError("VALIDATION_FAILED", {
            fieldErrors: { amount: ["too_large"] },
          });
        const posting = { ...input, amount };
        let row: TxRow;
        if (diff > 0n) {
          row = await this.give(tx, "grant", posting, claimed.txId, "set");
          await this.moveSystem(
            tx,
            counterOf("grant", posting),
            input.unit,
            -amount,
          );
        } else
          row = await this.take(
            tx,
            "adjust",
            posting,
            claimed.txId,
            false,
            "set",
          );
        await this.audit(tx, actor, "wallet.set", row);
        return toOperation(row, false);
      }),
    );
  }

  /**
   * Before → after of setting the balance, refused as the command would be:
   * the same balance is 422, a difference over the cap 400.
   */
  async previewSet(
    userId: string,
    unit: WalletUnit,
    target: bigint,
    maxAmount: bigint,
  ): Promise<CommandPreview> {
    const [wallet] = await this.database.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.unit, unit)));
    const before = wallet?.balance ?? 0n;
    if (before === target)
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { balance: ["unchanged"] },
      });
    const diff = target > before ? target - before : before - target;
    if (diff > maxAmount)
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { amount: ["too_large"] },
      });
    return {
      preview: true,
      balanceBefore: before.toString(),
      balanceAfter: target.toString(),
    };
  }

  /** Before → after of an admin command, without writing anything. */
  async preview(
    kind: "grant" | "adjust",
    userId: string,
    unit: WalletUnit,
    amount: bigint,
  ): Promise<CommandPreview> {
    const [wallet] = await this.database.db
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.unit, unit)));
    const before = wallet?.balance ?? 0n;
    const after = before + LEGS[kind].sign * amount;
    if (after < 0n) throw new AppError("INSUFFICIENT_FUNDS");
    return {
      preview: true,
      balanceBefore: before.toString(),
      balanceAfter: after.toString(),
    };
  }

  /**
   * Claims the ref for this request, or finds what holds it: the same
   * request (its journal row is the answer), another request (409) or a
   * rollback that came first (409 rolled_back).
   */
  private async claim(
    tx: WalletTx,
    operation: "grant" | "adjust" | "set" | "debit" | "credit",
    input: Posting,
  ): Promise<Claim> {
    const txId = randomUUID();
    const fingerprint = fingerprintOf(operation, [
      input.userId,
      input.unit,
      input.amount,
      input.source,
    ]);
    const claimed = await tx
      .insert(walletRefs)
      .values({
        ref: input.ref,
        operation,
        txId,
        fingerprint,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ ref: walletRefs.ref });
    if (claimed.length > 0) return { txId };
    const held = await this.refRow(tx, input.ref);
    if (held.operation === "tombstone") {
      this.metrics.operation(operation, "conflict");
      throw conflict("ref", "rolled_back");
    }
    if (held.operation !== operation || held.fingerprint !== fingerprint) {
      this.metrics.operation(operation, "conflict");
      throw conflict();
    }
    // A late retry of a debit that was rolled back since: the stake or the
    // purchase it paid for is gone, so it must not read as a success.
    if (operation === "debit") {
      const [reversed] = await tx
        .select({ ref: walletRefs.ref })
        .from(walletRefs)
        .where(eq(walletRefs.ref, `rollback:${input.ref}`));
      if (reversed) {
        this.metrics.operation(operation, "conflict");
        throw conflict("ref", "rolled_back");
      }
    }
    this.metrics.replay(operation);
    return { txId, replay: toOperation(await this.journalRow(tx, held), true) };
  }

  /**
   * Takes `amount` off the wallet: the WHERE makes the balance check and
   * the change one step, so concurrent debits cannot overdraw it. A debit
   * also needs the wallet active; an operator's adjustment does not.
   */
  private async take(
    tx: WalletTx,
    kind: "debit" | "adjust",
    input: Posting,
    txId: string,
    activeOnly: boolean,
    /** The metrics' kind: `set` when a balance is set. */
    measured: TxKind | "set" = kind,
  ): Promise<TxRow> {
    const now = this.clock.now();
    const [moved] = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} - ${input.amount.toString()}::bigint`,
        version: sql`${wallets.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(wallets.userId, input.userId),
          eq(wallets.unit, input.unit),
          gte(wallets.balance, input.amount),
          ...(activeOnly ? [eq(wallets.state, "active")] : []),
        ),
      )
      .returning({ balance: wallets.balance, version: wallets.version });
    if (!moved) {
      // Thrown inside the transaction: the ref claim goes too, so the same
      // ref may be tried again once the wallet allows it.
      if (activeOnly && (await this.restricted(tx, input))) {
        this.metrics.operation(measured, "restricted");
        throw new AppError("WALLET_RESTRICTED");
      }
      this.metrics.operation(measured, "insufficient_funds");
      throw new AppError("INSUFFICIENT_FUNDS");
    }
    const [row] = await tx
      .insert(walletTx)
      .values({
        id: txId,
        userId: input.userId,
        unit: input.unit,
        kind,
        source: input.source,
        objectRef: input.objectRef ?? null,
        ref: input.ref,
        amount: -input.amount,
        balanceBefore: moved.balance + input.amount,
        balanceAfter: moved.balance,
        walletVersion: moved.version,
        counterAccount: counterOf(kind, input),
        reason: input.reason ?? null,
        actorId: input.actorId ?? null,
        meta: input.meta ?? null,
        correlationId: input.correlationId ?? null,
        createdAt: now,
      })
      .returning();
    if (!row) throw new Error("journal insert returned nothing");
    await this.moveSystem(tx, counterOf(kind, input), input.unit, input.amount);
    this.metrics.operation(measured, "ok");
    return row;
  }

  /** Adds `amount` to a wallet locked by lockWallets (or a debit's wallet). */
  private async give(
    tx: WalletTx,
    kind: "grant" | "credit" | "reversal",
    input: Posting,
    txId: string,
    measured: TxKind | "set" = kind,
  ): Promise<TxRow> {
    const now = this.clock.now();
    const [moved] = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} + ${input.amount.toString()}::bigint`,
        version: sql`${wallets.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(eq(wallets.userId, input.userId), eq(wallets.unit, input.unit)),
      )
      .returning({ balance: wallets.balance, version: wallets.version });
    if (!moved) throw new Error(`wallet ${input.userId} was not created`);
    const [row] = await tx
      .insert(walletTx)
      .values({
        id: txId,
        userId: input.userId,
        unit: input.unit,
        kind,
        source: input.source,
        objectRef: input.objectRef ?? null,
        ref: input.ref,
        amount: input.amount,
        balanceBefore: moved.balance - input.amount,
        balanceAfter: moved.balance,
        walletVersion: moved.version,
        counterAccount: counterOf(kind, input),
        reason: input.reason ?? null,
        actorId: input.actorId ?? null,
        meta: input.meta ?? null,
        correlationId: input.correlationId ?? null,
        createdAt: now,
      })
      .returning();
    if (!row) throw new Error("journal insert returned nothing");
    this.metrics.operation(measured, "ok");
    return row;
  }

  /**
   * Creates missing wallets and locks them all in (user, unit) order. A new
   * wallet starts restricted if its account is: the account row is created
   * if needed and held FOR SHARE, so a status change from Identity waits
   * for this transaction and then sees the new wallet.
   */
  private async lockWallets(
    tx: WalletTx,
    postings: Pick<Posting, "userId" | "unit">[],
  ) {
    const keys = [
      ...new Map(
        postings.map((p) => [`${p.userId}|${p.unit}`, p] as const),
      ).values(),
    ].sort((a, b) =>
      a.userId === b.userId
        ? a.unit < b.unit
          ? -1
          : 1
        : a.userId < b.userId
          ? -1
          : 1,
    );
    if (keys.length === 0) return;
    const ids = [...new Set(keys.map((k) => k.userId))];
    const existing = await tx
      .select({ userId: wallets.userId, unit: wallets.unit })
      .from(wallets)
      .where(inArray(wallets.userId, ids));
    const have = new Set(existing.map((w) => `${w.userId}|${w.unit}`));
    const missing = keys.filter((k) => !have.has(`${k.userId}|${k.unit}`));
    if (missing.length > 0) {
      const now = this.clock.now();
      const missingIds = [...new Set(missing.map((k) => k.userId))];
      await tx
        .insert(users)
        .values(missingIds.map((userId) => ({ userId, updatedAt: now })))
        .onConflictDoNothing();
      const accounts = await tx
        .select({ userId: users.userId, status: users.status })
        .from(users)
        .where(inArray(users.userId, missingIds))
        .orderBy(users.userId)
        .for("share");
      const status = new Map(accounts.map((a) => [a.userId, a.status]));
      await tx
        .insert(wallets)
        .values(
          missing.map((k) => {
            const account = status.get(k.userId) ?? "active";
            return {
              userId: k.userId,
              unit: k.unit,
              state:
                account === "active"
                  ? ("active" as const)
                  : ("restricted" as const),
              restrictedReason:
                account === "active" ? null : ACCOUNT_REASON[account],
              createdAt: now,
              updatedAt: now,
            };
          }),
        )
        .onConflictDoNothing();
    }
    await tx
      .select({ userId: wallets.userId })
      .from(wallets)
      .where(inArray(wallets.userId, ids))
      .orderBy(wallets.userId, wallets.unit)
      .for("update");
  }

  private async moveSystem(
    tx: WalletTx,
    code: SystemAccountCode,
    unit: WalletUnit,
    amount: bigint,
  ) {
    if (amount === 0n) return;
    const moved = await tx
      .update(systemAccounts)
      .set({
        balance: sql`${systemAccounts.balance} + ${amount.toString()}::bigint`,
        updatedAt: this.clock.now(),
      })
      .where(and(eq(systemAccounts.code, code), eq(systemAccounts.unit, unit)))
      .returning({ code: systemAccounts.code });
    if (moved.length === 0)
      throw new Error(`system account ${code}/${unit} is missing`);
  }

  private async audit(
    tx: WalletTx,
    actor: Actor,
    action: "wallet.grant" | "wallet.adjust" | "wallet.set",
    row: TxRow,
  ) {
    await tx.insert(auditLog).values({
      actorId: actor.userId,
      action,
      userId: row.userId,
      unit: row.unit,
      amount: row.amount,
      reason: row.reason ?? "",
      ref: row.ref,
      requestId: actor.requestId,
      createdAt: row.createdAt,
    });
  }

  /** Whether a debit failed on the wallet's state rather than its balance. */
  private async restricted(tx: WalletTx, input: Posting) {
    const [wallet] = await tx
      .select({ state: wallets.state })
      .from(wallets)
      .where(
        and(eq(wallets.userId, input.userId), eq(wallets.unit, input.unit)),
      );
    if (wallet) return wallet.state === "restricted";
    const [account] = await tx
      .select({ status: users.status })
      .from(users)
      .where(eq(users.userId, input.userId));
    return account !== undefined && account.status !== "active";
  }

  private async refRow(tx: WalletTx, ref: string): Promise<RefRow> {
    const [row] = await tx
      .select()
      .from(walletRefs)
      .where(eq(walletRefs.ref, ref));
    if (!row) throw new Error(`ref ${ref} vanished`);
    return row;
  }

  private async journalRow(tx: WalletTx, ref: RefRow): Promise<TxRow> {
    if (!ref.txId) throw new Error(`ref ${ref.ref} has no operation`);
    const [row] = await tx
      .select()
      .from(walletTx)
      .where(eq(walletTx.id, ref.txId));
    if (!row) throw new Error(`journal row of ${ref.ref} is missing`);
    return row;
  }

  private async replayRollback(
    tx: WalletTx,
    ref: string,
  ): Promise<RollbackResponse> {
    const held = await this.refRow(tx, `rollback:${ref}`);
    this.metrics.replay("reversal");
    if (!held.txId)
      return { ref, state: "tombstoned", reversal: null, replayed: true };
    return {
      ref,
      state: "reversed",
      reversal: toOperation(await this.journalRow(tx, held), true),
      replayed: true,
    };
  }
}
