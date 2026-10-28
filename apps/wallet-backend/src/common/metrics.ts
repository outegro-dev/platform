import { Inject, Injectable } from "@nestjs/common";
import {
  reconciliationIssueKinds,
  type TxKind,
  walletUnits,
} from "@outegro/contracts/wallet";
import {
  CLOCK,
  type Clock,
  type Counter,
  DATABASE,
  type Gauge,
  type Histogram,
  Metrics,
} from "@outegro/nest-common";
import { count, eq, sum } from "drizzle-orm";
import { reconciliationIssues, wallets } from "../db/schema.js";
import type { WalletDatabase } from "./database.js";

/** What a metric is about: the kind of an operation, or setting a balance. */
type Measured = TxKind | "set";

/** How an operation ended; replays are counted apart as well. */
export type OperationResult =
  | "ok"
  | "replay"
  | "tombstoned"
  | "insufficient_funds"
  | "restricted"
  | "conflict"
  | "error";

/**
 * Wallet metrics (ADR-011). Balances are summed per unit only: amounts per
 * player belong in the journal, not in label values.
 */
@Injectable()
export class WalletMetrics {
  private readonly operations: Counter<"kind" | "result">;
  private readonly duration: Histogram<"kind">;
  private readonly replays: Counter<"kind">;
  private readonly reconciled: Gauge;

  constructor(
    metrics: Metrics,
    @Inject(DATABASE) private readonly database: WalletDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.operations = metrics.counter({
      name: "wallet_operations_total",
      help: "Wallet operations by kind (grant, adjust, set, debit, credit, reversal) and result: ok, replay, tombstoned, insufficient_funds, restricted, conflict, error.",
      labelNames: ["kind", "result"],
    });
    this.duration = metrics.histogram({
      name: "wallet_operation_duration_seconds",
      help: "Time of one wallet transaction by kind, a whole credit batch counted once.",
      labelNames: ["kind"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    });
    this.replays = metrics.counter({
      name: "wallet_idempotent_replays_total",
      help: "Requests answered from a stored operation (same ref, same data), by kind.",
      labelNames: ["kind"],
    });
    this.reconciled = metrics.gauge({
      name: "wallet_reconciliation_last_success_timestamp_seconds",
      help: "When the last reconciliation pass finished (Unix time); 0 before the first.",
    });
    this.readBalances(metrics);
    this.readIssues(metrics);
  }

  /** Runs one transaction and records its time; an unexpected failure counts as error. */
  async time<T>(kind: Measured, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      // Refusals were counted with their own result where they happened.
      if (typeof code !== "string" || !/^[A-Z_]+$/.test(code))
        this.operation(kind, "error");
      throw error;
    } finally {
      this.duration.observe({ kind }, (performance.now() - started) / 1000);
    }
  }

  operation(kind: Measured, result: OperationResult) {
    this.operations.inc({ kind, result });
  }

  replay(kind: Measured) {
    this.replays.inc({ kind });
    this.operations.inc({ kind, result: "replay" });
  }

  reconciliationFinished(at: Date = this.clock.now()) {
    this.reconciled.set(at.getTime() / 1000);
  }

  private readBalances(metrics: Metrics) {
    const balance = metrics.gauge({
      name: "wallet_balance_total",
      help: "Grumbles on players' wallets by unit.",
      labelNames: ["unit"],
    });
    metrics.readOnScrape(
      "wallet_balances",
      [balance],
      this.database.db,
      async (tx) => {
        const rows = await tx
          .select({ unit: wallets.unit, total: sum(wallets.balance) })
          .from(wallets)
          .groupBy(wallets.unit);
        for (const unit of walletUnits) {
          const row = rows.find((r) => r.unit === unit);
          balance.set({ unit }, Number(row?.total ?? 0));
        }
      },
    );
  }

  private readIssues(metrics: Metrics) {
    const issues = metrics.gauge({
      name: "wallet_reconciliation_issues",
      help: "Open reconciliation issues by type: balance_drift, chain_break, system_drift, zero_sum.",
      labelNames: ["type"],
    });
    metrics.readOnScrape(
      "wallet_issues",
      [issues],
      this.database.db,
      async (tx) => {
        const rows = await tx
          .select({ kind: reconciliationIssues.kind, open: count() })
          .from(reconciliationIssues)
          .where(eq(reconciliationIssues.state, "open"))
          .groupBy(reconciliationIssues.kind);
        for (const type of reconciliationIssueKinds) {
          const row = rows.find((r) => r.kind === type);
          issues.set({ type }, row?.open ?? 0);
        }
      },
    );
  }
}
