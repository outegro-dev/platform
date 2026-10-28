import { Inject, Injectable } from "@nestjs/common";
import {
  type ReconciliationIssueKind,
  walletUnits,
} from "@outegro/contracts/wallet";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { WalletDatabase } from "../common/database.js";
import {
  reconciliationIssues,
  reconciliationRuns,
  wallets,
} from "../db/schema.js";

export type PassMode = "sample" | "full";
type Found = {
  kind: ReconciliationIssueKind;
  subject: string;
  details: Record<string, unknown>;
};

/** Longer than any wallet transaction plus clock skew between pods. */
const LATE_COMMIT_MARGIN_MS = 120_000;

const walletSubject = (userId: string, unit: string) =>
  `wallet:${userId}:${unit}`;

/**
 * Compares the caches with the journal and records what disagrees
 * (docs/02-contracts/wallet.md). It repairs nothing: an issue stays open
 * until a pass finds its subject clean. Each check is one SQL statement,
 * so it sees one snapshot: an operation commits its wallet, journal row
 * and system account together, and a concurrent operation can never look
 * like a drift.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(DATABASE) private readonly database: WalletDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** One pass: a sample of wallets (or all), every system account, every unit. */
  async pass(
    mode: PassMode,
    options: { since?: Date | null; sampleSize?: number } = {},
  ) {
    const db = this.database.db;
    const startedAt = this.clock.now();
    const [started] = await db
      .insert(reconciliationRuns)
      .values({ mode, startedAt })
      .returning({ id: reconciliationRuns.id });
    const runId = started?.id ?? "";
    try {
      const userIds =
        mode === "full"
          ? null
          : await this.sample(options.since ?? null, options.sampleSize ?? 100);
      const found: Found[] = [];
      const checked = await this.checkWallets(userIds, found);
      await this.checkSystemAccounts(found);
      await this.checkZeroSum(found);
      await this.record(found, mode, checked.subjects);
      await db
        .update(reconciliationRuns)
        .set({
          finishedAt: this.clock.now(),
          checkedWallets: checked.count,
          issuesFound: found.length,
        })
        .where(eq(reconciliationRuns.id, runId));
      return { checkedWallets: checked.count, issues: found };
    } catch (error) {
      // Recorded, so the console says "failed", not "running" for ever.
      await db
        .update(reconciliationRuns)
        .set({ finishedAt: this.clock.now(), failed: true })
        .where(eq(reconciliationRuns.id, runId));
      throw error;
    }
  }

  /** Wallets changed since the last pass, plus random ones. */
  private async sample(since: Date | null, size: number): Promise<string[]> {
    const db = this.database.db;
    // updated_at is when the statement ran, not when it committed: the
    // margin catches an operation that committed after the last pass began.
    const changed = since
      ? await db
          .selectDistinct({ userId: wallets.userId })
          .from(wallets)
          .where(
            gte(
              wallets.updatedAt,
              new Date(since.getTime() - LATE_COMMIT_MARGIN_MS),
            ),
          )
      : [];
    // Not DISTINCT: PostgreSQL refuses ORDER BY random() with it; the Set
    // below drops a player's other units.
    const random =
      size > 0
        ? await db
            .select({ userId: wallets.userId })
            .from(wallets)
            .orderBy(sql`random()`)
            .limit(size)
        : [];
    return [...new Set([...changed, ...random].map((row) => row.userId))];
  }

  /**
   * Per wallet: the cached balance equals the sum of its journal, the
   * versions run 1, 2, 3… without a gap, and each operation starts where
   * the previous one ended.
   */
  private async checkWallets(userIds: string[] | null, found: Found[]) {
    if (userIds !== null && userIds.length === 0)
      return { count: 0, subjects: new Set<string>() };
    const only =
      userIds === null
        ? sql`true`
        : sql`user_id = any(${`{${userIds.join(",")}}`}::uuid[])`;
    const result = await this.database.db.execute<{
      user_id: string;
      unit: string;
      balance: string | null;
      version: number | null;
      total: string;
      operations: string;
      breaks: string;
    }>(sql`
      with j as (
        select user_id, unit, wallet_version, balance_before, amount,
          lag(balance_after) over w as prev_after,
          lag(wallet_version) over w as prev_version
        from wallet_tx
        where ${only}
        window w as (partition by user_id, unit order by wallet_version)
      ), s as (
        select user_id, unit, sum(amount) as total, count(*) as operations,
          count(*) filter (where
            (prev_version is null and (wallet_version <> 1 or balance_before <> 0))
            or (prev_version is not null
              and (wallet_version <> prev_version + 1 or balance_before <> prev_after))
          ) as breaks
        from j group by user_id, unit
      ), w as (
        select user_id, unit, balance, version from wallets where ${only}
      )
      select coalesce(w.user_id, s.user_id) as user_id,
        coalesce(w.unit, s.unit) as unit,
        w.balance::text as balance, w.version,
        coalesce(s.total, 0)::text as total,
        coalesce(s.operations, 0)::text as operations,
        coalesce(s.breaks, 0)::text as breaks
      from w full join s on s.user_id = w.user_id and s.unit = w.unit
    `);
    const subjects = new Set<string>();
    for (const row of result.rows) {
      const subject = walletSubject(row.user_id, row.unit);
      subjects.add(subject);
      const cached = BigInt(row.balance ?? 0);
      const journal = BigInt(row.total);
      if (row.balance === null || cached !== journal)
        found.push({
          kind: "balance_drift",
          subject,
          details: { cached: row.balance, journal: row.total },
        });
      const operations = Number(row.operations);
      if (Number(row.breaks) > 0 || (row.version ?? 0) !== operations)
        found.push({
          kind: "chain_break",
          subject,
          details: {
            breaks: Number(row.breaks),
            version: row.version,
            operations,
          },
        });
    }
    return { count: result.rows.length, subjects };
  }

  /** A system account equals minus the sum of the legs it took. */
  private async checkSystemAccounts(found: Found[]) {
    const result = await this.database.db.execute<{
      code: string;
      unit: string;
      balance: string;
      journal: string;
    }>(sql`
      select a.code, a.unit, a.balance::text as balance,
        coalesce(-sum(t.amount), 0)::text as journal
      from system_accounts a
      left join wallet_tx t on t.counter_account = a.code and t.unit = a.unit
      group by a.code, a.unit, a.balance
    `);
    for (const row of result.rows)
      if (BigInt(row.balance) !== BigInt(row.journal))
        found.push({
          kind: "system_drift",
          subject: `system:${row.code}:${row.unit}`,
          details: { cached: row.balance, journal: row.journal },
        });
  }

  /** All wallets and all system accounts of a unit sum to zero. */
  private async checkZeroSum(found: Found[]) {
    const result = await this.database.db.execute<{
      unit: string;
      total: string;
    }>(sql`
      select u.unit,
        (coalesce((select sum(balance) from wallets where unit = u.unit), 0)
          + coalesce((select sum(balance) from system_accounts where unit = u.unit), 0))::text as total
      from unnest(${`{${walletUnits.join(",")}}`}::text[]) as u(unit)
    `);
    for (const row of result.rows)
      if (BigInt(row.total) !== 0n)
        found.push({
          kind: "zero_sum",
          subject: `unit:${row.unit}`,
          details: { total: row.total },
        });
  }

  /**
   * Opens or refreshes an issue for every finding and resolves the open
   * ones whose subject this pass checked and found clean.
   */
  private async record(found: Found[], mode: PassMode, checked: Set<string>) {
    const db = this.database.db;
    const now = this.clock.now();
    for (const issue of found)
      await db
        .insert(reconciliationIssues)
        .values({ ...issue, firstSeenAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [reconciliationIssues.kind, reconciliationIssues.subject],
          targetWhere: sql`${reconciliationIssues.state} = 'open'`,
          set: { details: issue.details, lastSeenAt: now },
        });
    const open = await db
      .select({
        id: reconciliationIssues.id,
        kind: reconciliationIssues.kind,
        subject: reconciliationIssues.subject,
      })
      .from(reconciliationIssues)
      .where(eq(reconciliationIssues.state, "open"));
    const still = new Set(found.map((f) => `${f.kind}|${f.subject}`));
    const clean = open.filter(
      (issue) =>
        !still.has(`${issue.kind}|${issue.subject}`) &&
        (mode === "full" ||
          !issue.subject.startsWith("wallet:") ||
          checked.has(issue.subject)),
    );
    if (clean.length > 0)
      await db
        .update(reconciliationIssues)
        .set({ state: "resolved", resolvedAt: now })
        .where(
          and(
            eq(reconciliationIssues.state, "open"),
            inArray(
              reconciliationIssues.id,
              clean.map((issue) => issue.id),
            ),
          ),
        );
  }
}
