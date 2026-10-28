import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  type AdminCommand,
  type AdminOverview,
  type AdminTx,
  type AdminWallet,
  type ReconciliationRun,
  type SetBalanceCommand,
  type TxKind,
  txKinds,
  type WalletSource,
  type WalletState,
  type WalletUnit,
} from "@outegro/contracts/wallet";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { AccountService } from "../account/account.service.js";
import { after, decodeCursor, page } from "../common/cursor.js";
import type { TxRow, WalletDatabase, WalletRow } from "../common/database.js";
import { walletConfig } from "../config/config.js";
import {
  auditLog,
  reconciliationIssues,
  reconciliationRuns,
  systemAccounts,
  users,
  wallets,
  walletTx,
} from "../db/schema.js";
import { type Actor, WalletLedger } from "../ledger/ledger.js";

const DAY_MS = 86_400_000;
/** Resolved issues stay on the reconciliation page for a week. */
const RESOLVED_SHOWN_MS = 7 * DAY_MS;

const adminWallet = (row: WalletRow): AdminWallet => ({
  userId: row.userId,
  unit: row.unit,
  balance: row.balance.toString(),
  state: row.state,
  restrictedReason: row.restrictedReason,
  version: row.version,
  exists: true,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const adminTx = (row: TxRow): AdminTx => ({
  id: row.id,
  kind: row.kind,
  amount: row.amount.toString(),
  balanceBefore: row.balanceBefore.toString(),
  balanceAfter: row.balanceAfter.toString(),
  createdAt: row.createdAt.toISOString(),
  source: row.source,
  objectRef: row.objectRef,
  ref: row.ref,
  walletVersion: row.walletVersion,
  counterAccount: row.counterAccount,
  reason: row.reason,
  actorId: row.actorId,
  meta: row.meta ?? null,
  correlationId: row.correlationId,
});

const run = (
  row: typeof reconciliationRuns.$inferSelect,
): ReconciliationRun => ({
  id: row.id,
  mode: row.mode,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
  checkedWallets: row.checkedWallets,
  issuesFound: row.issuesFound,
  failed: row.failed,
});

/** What the admin console reads and the two commands it may run. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE) private readonly database: WalletDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(walletConfig.KEY)
    private readonly config: ConfigType<typeof walletConfig>,
    private readonly ledger: WalletLedger,
    private readonly account: AccountService,
  ) {}

  async overview(unit: WalletUnit): Promise<AdminOverview> {
    const db = this.database.db;
    const since = new Date(this.clock.now().getTime() - DAY_MS);
    const [totals] = await db
      .select({
        onHand: sum(wallets.balance),
        wallets: count(),
        restricted:
          sql<number>`count(*) filter (where ${wallets.state} = 'restricted')`.mapWith(
            Number,
          ),
      })
      .from(wallets)
      .where(eq(wallets.unit, unit));
    const kinds = await db
      .select({ kind: walletTx.kind, operations: count() })
      .from(walletTx)
      .where(and(eq(walletTx.unit, unit), gte(walletTx.createdAt, since)))
      .groupBy(walletTx.kind);
    const turnover = await db
      .select({
        source: walletTx.source,
        operations: count(),
        credited: sql<string>`coalesce(sum(${walletTx.amount}) filter (where ${walletTx.amount} > 0), 0)::text`,
        debited: sql<string>`coalesce(-sum(${walletTx.amount}) filter (where ${walletTx.amount} < 0), 0)::text`,
      })
      .from(walletTx)
      .where(and(eq(walletTx.unit, unit), gte(walletTx.createdAt, since)))
      .groupBy(walletTx.source)
      .orderBy(walletTx.source);
    const accounts = await db
      .select({ code: systemAccounts.code, balance: systemAccounts.balance })
      .from(systemAccounts)
      .where(eq(systemAccounts.unit, unit))
      .orderBy(systemAccounts.code);
    const [issues] = await db
      .select({ open: count() })
      .from(reconciliationIssues)
      .where(eq(reconciliationIssues.state, "open"));
    const [last] = await db
      .select()
      .from(reconciliationRuns)
      .where(
        and(
          isNotNull(reconciliationRuns.finishedAt),
          eq(reconciliationRuns.failed, false),
        ),
      )
      .orderBy(desc(reconciliationRuns.finishedAt))
      .limit(1);
    return {
      unit,
      onHand: totals?.onHand ?? "0",
      wallets: totals?.wallets ?? 0,
      restricted: totals?.restricted ?? 0,
      operations24h: Object.fromEntries(
        txKinds.map((kind) => [
          kind,
          kinds.find((k) => k.kind === kind)?.operations ?? 0,
        ]),
      ) as Record<TxKind, number>,
      systemAccounts: accounts.map((a) => ({
        code: a.code,
        balance: a.balance.toString(),
      })),
      turnover24h: turnover,
      openIssues: issues?.open ?? 0,
      lastReconciliation: last ? run(last) : null,
    };
  }

  async wallets(query: {
    unit: WalletUnit;
    state?: WalletState;
    userId?: string;
    cursor?: string;
    limit: number;
  }) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.database.db
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.unit, query.unit),
          query.state ? eq(wallets.state, query.state) : undefined,
          query.userId ? eq(wallets.userId, query.userId) : undefined,
          after(cursor, wallets.updatedAt, wallets.userId),
        ),
      )
      .orderBy(desc(wallets.updatedAt), desc(wallets.userId))
      .limit(query.limit + 1);
    const result = page(rows, query.limit, (row) => ({
      at: row.updatedAt,
      id: row.userId,
    }));
    return { ...result, items: result.items.map(adminWallet) };
  }

  async wallet(
    userId: string,
    query: {
      unit: WalletUnit;
      source?: WalletSource;
      cursor?: string;
      limit: number;
    },
  ) {
    const [row] = await this.database.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.unit, query.unit)));
    const view = await this.account.wallet(userId, query.unit);
    const wallet: AdminWallet = row
      ? adminWallet(row)
      : {
          userId,
          unit: query.unit,
          balance: "0",
          state: view.state,
          restrictedReason: null,
          version: 0,
          exists: false,
          createdAt: null,
          updatedAt: null,
        };
    if (!row && view.state === "restricted") {
      const [account] = await this.database.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.userId, userId));
      wallet.restrictedReason = account ? `account_${account.status}` : null;
    }
    const history = await this.account.journal(userId, query);
    return {
      wallet,
      history: { ...history, items: history.items.map(adminTx) },
    };
  }

  /** Grant or adjust; with `preview` only before → after, nothing written. */
  async command(
    kind: "grant" | "adjust",
    actor: Actor,
    userId: string,
    body: AdminCommand,
  ) {
    const amount = BigInt(body.amount);
    if (amount > this.config.adminMaxAmount)
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { amount: ["too_large"] },
      });
    if (body.preview)
      return this.ledger.preview(kind, userId, body.unit, amount);
    const posting = {
      ref: `${kind}:${body.commandId}`,
      userId,
      unit: body.unit,
      amount,
      source: "admin" as const,
      reason: body.reason,
      actorId: actor.userId,
    };
    return kind === "grant"
      ? this.ledger.grant(actor, posting)
      : this.ledger.adjust(actor, posting);
  }

  /** Set the balance: the wallet grants or takes the difference. */
  async setBalance(actor: Actor, userId: string, body: SetBalanceCommand) {
    const target = BigInt(body.balance);
    if (body.preview)
      return this.ledger.previewSet(
        userId,
        body.unit,
        target,
        this.config.adminMaxAmount,
      );
    return this.ledger.setBalance(
      actor,
      {
        ref: `set:${body.commandId}`,
        userId,
        unit: body.unit,
        amount: target,
        source: "admin",
        reason: body.reason,
        actorId: actor.userId,
      },
      this.config.adminMaxAmount,
    );
  }

  async reconciliation() {
    const db = this.database.db;
    const shownSince = new Date(this.clock.now().getTime() - RESOLVED_SHOWN_MS);
    const issues = await db
      .select()
      .from(reconciliationIssues)
      .where(
        or(
          eq(reconciliationIssues.state, "open"),
          gte(reconciliationIssues.resolvedAt, shownSince),
        ),
      )
      .orderBy(desc(reconciliationIssues.lastSeenAt))
      .limit(200);
    const runs = await db
      .select()
      .from(reconciliationRuns)
      .orderBy(desc(reconciliationRuns.startedAt))
      .limit(20);
    return {
      issues: issues.map((issue) => ({
        id: issue.id,
        kind: issue.kind,
        subject: issue.subject,
        state: issue.state,
        details: issue.details,
        firstSeenAt: issue.firstSeenAt.toISOString(),
        lastSeenAt: issue.lastSeenAt.toISOString(),
        resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      })),
      runs: runs.map(run),
    };
  }

  async audit(query: { cursor?: string; limit: number }) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.database.db
      .select()
      .from(auditLog)
      .where(after(cursor, auditLog.createdAt, auditLog.id))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.limit + 1);
    const result = page(rows, query.limit, (row) => ({
      at: row.createdAt,
      id: row.id,
    }));
    return {
      ...result,
      items: result.items.map((row) => ({
        id: row.id,
        action: row.action,
        actorId: row.actorId,
        userId: row.userId,
        unit: row.unit,
        amount: row.amount.toString(),
        reason: row.reason,
        ref: row.ref,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
