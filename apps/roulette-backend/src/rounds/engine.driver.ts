import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { RouletteMetrics } from "../common/metrics.js";
import { SCHEDULER } from "../common/tokens.js";
import type { Scheduler, TimerHandle } from "../domain/scheduler.js";
import { RoundEngine } from "./round.engine.js";
import { RoundStore } from "./round.store.js";

/** The lease lives 5 s and is renewed every second (ADR-012). */
export const LEASE_TTL_MS = 5000;
export const LEASE_RENEW_MS = 1000;
/** The leader publishes the full round 4 times a second. */
export const TICK_MS = 250;
/** After a failed step the engine tries again this much later. */
const RETRY_MS = 1000;

/**
 * Runs the engine on the one instance that holds the lease in Valkey. Every
 * replica competes for it each second; the holder steps the round machine
 * at its deadlines and publishes the round every 250 ms. A holder that
 * pauses past the lease loses it, and its late moves are fenced off by the
 * conditional updates of the record.
 */
@Injectable()
export class EngineDriver implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("EngineDriver");
  readonly instanceId = randomUUID();
  private leading = false;
  private stopped = false;
  private stepping = false;
  private leaseTimer: TimerHandle | undefined;
  private stepTimer: TimerHandle | undefined;
  private tickTimer: TimerHandle | undefined;

  constructor(
    private readonly engine: RoundEngine,
    private readonly store: RoundStore,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly metrics: RouletteMetrics,
  ) {}

  get isLeader(): boolean {
    return this.leading;
  }

  async onApplicationBootstrap() {
    await this.renewLease();
  }

  async onModuleDestroy() {
    this.stopped = true;
    for (const timer of [this.leaseTimer, this.stepTimer, this.tickTimer])
      timer?.cancel();
    if (this.leading) {
      this.leading = false;
      await this.store.resign(this.instanceId).catch(() => undefined);
    }
  }

  /** Takes or keeps the lease, then looks again in a second. */
  async renewLease(): Promise<void> {
    if (this.stopped) return;
    let held = false;
    try {
      held = await this.store.lease(this.instanceId, LEASE_TTL_MS);
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, "Lease check failed");
    }
    if (held !== this.leading) {
      this.leading = held;
      this.metrics.isLeader(held);
      this.logger.log(
        { instance: this.instanceId },
        held ? "Engine leader" : "Engine lease lost",
      );
      if (held) {
        this.scheduleStep(this.clock.now());
        this.scheduleTick();
      } else {
        this.stepTimer?.cancel();
        this.tickTimer?.cancel();
      }
    }
    this.leaseTimer = this.scheduler.after(LEASE_RENEW_MS, () =>
      this.renewLease(),
    );
  }

  /** One engine move; the next is scheduled at the deadline it returns. */
  async runStep(): Promise<void> {
    if (!this.leading || this.stopped || this.stepping) return;
    this.stepping = true;
    let next: Date;
    try {
      next = await this.engine.step();
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        "Engine step failed",
      );
      next = new Date(this.clock.now().getTime() + RETRY_MS);
    } finally {
      this.stepping = false;
    }
    if (this.leading && !this.stopped) this.scheduleStep(next);
  }

  private scheduleStep(at: Date) {
    this.stepTimer?.cancel();
    this.stepTimer = this.scheduler.at(at, () => this.runStep());
  }

  private scheduleTick() {
    this.tickTimer?.cancel();
    this.tickTimer = this.scheduler.after(TICK_MS, async () => {
      if (!this.leading || this.stopped) return;
      try {
        await this.engine.publish();
      } catch (error) {
        this.logger.warn({ err: (error as Error).message }, "Tick failed");
      }
      this.scheduleTick();
    });
  }
}
