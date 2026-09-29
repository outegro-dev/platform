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
  /**
   * Players of the pass in flight: true while they still want a match. The
   * claim takes them out of the queue before their locks are held, so a
   * leave in between is recorded here (see `left`) and honoured by startPair.
   */
  private readonly pairing = new Map<string, boolean>();

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

  /** The player left the queue or went offline (under the player's lock). */
  left(userId: string) {
    if (this.pairing.has(userId)) this.pairing.set(userId, false);
  }

  /** The player joined the queue again (under the player's lock). */
  joined(userId: string) {
    if (this.pairing.has(userId)) this.pairing.set(userId, true);
  }

  private async pass() {
    const entries = await this.queue.entries();
    const pairs = this.planner.plan(entries, this.clock.now().getTime());
    // Marked before the claim, so no leave can slip between the two.
    for (const [a, b] of pairs) {
      this.pairing.set(a.userId, true);
      this.pairing.set(b.userId, true);
    }
    try {
      const claimed = await this.queue.claim(pairs);
      let fellThrough = false;
      for (const [a, b] of claimed)
        if (await this.startPair(a, b)) fellThrough = true;
      if (fellThrough || entries.length > claimed.length * 2)
        this.scheduleNext();
    } finally {
      for (const [a, b] of pairs) {
        this.pairing.delete(a.userId);
        this.pairing.delete(b.userId);
      }
    }
  }

  private scheduleNext() {
    if (this.timer) return;
    this.timer = this.scheduler.after(PASS_EVERY_MS, () => {
      this.timer = null;
      return this.tick();
    });
  }

  /** Starts the match; true when it fell through and someone may wait on. */
  private startPair(a: QueueEntry, b: QueueEntry): Promise<boolean> {
    return this.locks.run([a.userId, b.userId], async () => {
      const still = await this.stillWaiting([a, b]);
      if (still.length < 2) {
        await this.queue.requeue(still);
        return true;
      }
      try {
        await this.game.start({ mode: "quick", a: a.userId, b: b.userId });
        return false;
      } catch (error) {
        this.logger.error(
          { err: (error as Error).message },
          "Could not start a quick match",
        );
        await this.queue.requeue(await this.stillWaiting([a, b]));
        return true;
      }
    });
  }

  /**
   * Claimed players who still wait for this pairing. Since the claim a player
   * may have left the queue, gone offline, started a bot match or joined the
   * queue again (that newer entry stands instead: never both).
   */
  private async stillWaiting(entries: QueueEntry[]): Promise<QueueEntry[]> {
    const still: QueueEntry[] = [];
    for (const entry of entries)
      if (
        this.pairing.get(entry.userId) === true &&
        !this.game.active(entry.userId) &&
        this.registry.isOnline(entry.userId) &&
        (await this.queue.since(entry.userId)) === null
      )
        still.push(entry);
    return still;
  }
}
