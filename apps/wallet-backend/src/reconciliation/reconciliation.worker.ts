import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { WalletDatabase } from "../common/database.js";
import { WalletMetrics } from "../common/metrics.js";
import { PeriodicWorker } from "../common/periodic-worker.js";
import { reconciliationConfig } from "../config/config.js";
import { reconciliationRuns } from "../db/schema.js";
import {
  type PassMode,
  ReconciliationService,
} from "./reconciliation.service.js";

/**
 * A sample pass every interval (wallets changed since the last pass plus
 * random ones); once a day, on the first pass after the configured UTC
 * hour, a full one.
 */
@Injectable()
export class ReconciliationWorker
  extends PeriodicWorker
  implements OnModuleInit
{
  protected readonly logger = new Logger(ReconciliationWorker.name);

  constructor(
    @Inject(reconciliationConfig.KEY)
    private readonly config: ConfigType<typeof reconciliationConfig>,
    @Inject(DATABASE) private readonly database: WalletDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly reconciliation: ReconciliationService,
    private readonly metrics: WalletMetrics,
  ) {
    super(config.autoStart, config.intervalMs);
  }

  /** After a restart the gauge says when the last pass finished, not 0. */
  async onModuleInit() {
    try {
      const last = await this.lastSuccess();
      if (last?.finishedAt)
        this.metrics.reconciliationFinished(last.finishedAt);
    } catch (error) {
      // The database may still be starting; the first pass sets the gauge.
      this.logger.warn({ err: (error as Error).message }, "No last pass yet");
    }
  }

  protected async runOnce(): Promise<number> {
    const last = await this.lastSuccess();
    const mode = await this.dueMode();
    const result = await this.reconciliation.pass(mode, {
      since: last?.startedAt ?? null,
      sampleSize: this.config.sampleSize,
    });
    this.metrics.reconciliationFinished();
    if (result.issues.length > 0)
      this.logger.warn(
        {
          mode,
          issues: result.issues.map((i) => `${i.kind} ${i.subject}`),
        },
        "Wallet reconciliation found issues",
      );
    return result.checkedWallets;
  }

  private async lastSuccess() {
    const [last] = await this.database.db
      .select({
        startedAt: reconciliationRuns.startedAt,
        finishedAt: reconciliationRuns.finishedAt,
      })
      .from(reconciliationRuns)
      .where(
        and(
          isNotNull(reconciliationRuns.finishedAt),
          eq(reconciliationRuns.failed, false),
        ),
      )
      .orderBy(desc(reconciliationRuns.startedAt))
      .limit(1);
    return last;
  }

  /** Full once a day after the hour; a sample otherwise. */
  private async dueMode(): Promise<PassMode> {
    const now = this.clock.now();
    if (now.getUTCHours() < this.config.fullHourUtc) return "sample";
    const today = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        this.config.fullHourUtc,
      ),
    );
    const [full] = await this.database.db
      .select({ id: reconciliationRuns.id })
      .from(reconciliationRuns)
      .where(
        and(
          eq(reconciliationRuns.mode, "full"),
          isNotNull(reconciliationRuns.finishedAt),
          eq(reconciliationRuns.failed, false),
          gte(reconciliationRuns.startedAt, today),
        ),
      )
      .limit(1);
    return full ? "sample" : "full";
  }
}
