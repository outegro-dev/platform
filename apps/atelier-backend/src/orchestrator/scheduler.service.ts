import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { runDetached } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  heldBySafeMode,
  VALKEY,
} from "@outegro/nest-common";
import { and, eq, gte } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { AtelierDatabase } from "../common/database.js";
import { type PipelineConfig, pipelineConfig } from "../config/config.js";
import { jobs } from "../db/schema.js";
import { OrchestratorService } from "./orchestrator.service.js";

/**
 * The orchestrator's timers (api role): steps past their deadline, paused
 * steps whose time came, and tick.daily once a day after TICK_DAILY_HOUR
 * (UTC). A Valkey lock keeps a second replica from running the same pass.
 */
@Injectable()
export class SchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("Scheduler");
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    @Inject(DATABASE) private readonly database: AtelierDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(pipelineConfig.KEY) private readonly config: PipelineConfig,
    private readonly orchestrator: OrchestratorService,
  ) {}

  onApplicationBootstrap() {
    if (heldBySafeMode("atelier-scheduler") || !this.config.schedulerIntervalMs)
      return;
    this.schedule(this.config.schedulerIntervalMs);
  }

  onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = runDetached(() =>
      setTimeout(() => {
        void this.pass().finally(() =>
          this.schedule(this.config.schedulerIntervalMs),
        );
      }, delay),
    );
  }

  /** One pass; exposed for tests and the internal API. */
  async pass() {
    const lock = await this.valkey
      .set(
        "scheduler",
        "1",
        "PX",
        Math.max(5000, this.config.schedulerIntervalMs),
        "NX",
      )
      .catch(() => "OK");
    if (!lock) return;
    try {
      await this.orchestrator.sweep();
      await this.tickDaily();
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        "Scheduler pass failed",
      );
    } finally {
      await this.valkey.del("scheduler").catch(() => undefined);
    }
  }

  /** Starts tick.daily once per UTC day, after the configured hour. */
  async tickDaily(): Promise<string | null> {
    const now = this.clock.now();
    if (now.getUTCHours() < this.config.tickDailyHour) return null;
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [ran] = await this.database.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.kind, "tick.daily"), gte(jobs.createdAt, today)))
      .limit(1);
    if (ran) return null;
    return this.orchestrator.start({ kind: "tick.daily" });
  }
}
