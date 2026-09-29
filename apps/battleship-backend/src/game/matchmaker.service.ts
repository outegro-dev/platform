import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { SCHEDULER } from "../common/tokens.js";
import { PairingPlanner, type QueueEntry } from "../domain/matchmaking.js";
import type { Scheduler, TimerHandle } from "../domain/scheduler.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";
import { GameService } from "./game.service.js";
import { KeyedMutex } from "./keyed-mutex.js";
import { QueueStore } from "./queue.store.js";

const PASS_EVERY_MS = 1_000;

/**
 * Quick-match pairing: plans pairs from the queue (the window grows with the
 * wait) and claims them atomically in Valkey, then starts each match under
 * both players' locks. Runs on every join and every second while anyone waits.
 */
@Injectable()
export class MatchmakerService {
  private readonly logger = new Logger("Matchmaker");
  private readonly planner = new PairingPlanner();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: TimerHandle | null = null;

  constructor(
    private readonly queue: QueueStore,
    private readonly game: GameService,
    private readonly registry: ConnectionRegistry,
    private readonly locks: KeyedMutex,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** One pairing pass; a request during a pass runs one more right after. */
  tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })()
      .catch((error: unknown) =>
        this.logger.error(
          { err: (error as Error).message },
          "Pairing pass failed",
        ),
      )
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async pass() {
    const entries = await this.queue.entries();
    const pairs = this.planner.plan(entries, this.clock.now().getTime());
    const claimed = await this.queue.claim(pairs);
    for (const [a, b] of claimed) await this.startPair(a, b);
    if (entries.length > claimed.length * 2) this.scheduleNext();
  }

  private scheduleNext() {
    if (this.timer) return;
    this.timer = this.scheduler.after(PASS_EVERY_MS, () => {
      this.timer = null;
      return this.tick();
    });
  }

  private async startPair(a: QueueEntry, b: QueueEntry) {
    await this.locks.run([a.userId, b.userId], async () => {
      // Between the claim and here a player may have left or started a bot match.
      const available = (entry: QueueEntry) =>
        !this.game.active(entry.userId) && this.registry.isOnline(entry.userId);
      if (!available(a) || !available(b)) {
        await this.queue.requeue([a, b].filter(available));
        return;
      }
      try {
        await this.game.start({ mode: "quick", a: a.userId, b: b.userId });
      } catch (error) {
        this.logger.error(
          { err: (error as Error).message },
          "Could not start a quick match",
        );
        await this.queue.requeue([a, b].filter(available));
      }
    });
  }
}
