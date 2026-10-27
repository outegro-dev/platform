import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  type RoundView,
  rouletteServerMessageSchema,
} from "@outegro/contracts/roulette";
import { VALKEY } from "@outegro/nest-common";
import { colorOf } from "@outegro/roulette-engine";
import type { Redis } from "ioredis";
import { RouletteMetrics } from "../common/metrics.js";
import { RoundRepository, type RoundRow } from "./round.repository.js";
import { RoundStore } from "./round.store.js";

/** The pub/sub channel of round frames (Valkey of roulette). */
export const ROUND_CHANNEL = "roulette:events";

/** A cached frame older than this is rebuilt from the record on demand. */
const STALE_MS = 1500;

/** Builds the full round state from the record and the live totals. */
@Injectable()
export class SnapshotService {
  constructor(
    private readonly repo: RoundRepository,
    private readonly store: RoundStore,
  ) {}

  async latest(): Promise<RoundView | null> {
    const row = await this.repo.latest();
    return row ? this.view(row) : null;
  }

  async view(row: RoundRow): Promise<RoundView> {
    let phase = row.status;
    // Valkey stops the bets before the record does: show the close at once.
    if (phase === "betting" && (await this.store.phase(row.id)) === "locked")
      phase = "locked";
    return {
      round: row.id,
      phase,
      bettingEndsAt: row.bettingEndsAt.toISOString(),
      rollingAt: row.rollingAt?.toISOString() ?? null,
      settleAt: row.settleAt?.toISOString() ?? null,
      nextRoundAt: row.nextRoundAt?.toISOString() ?? null,
      result:
        row.number !== null && row.seed !== null
          ? { number: row.number, color: colorOf(row.number), seed: row.seed }
          : null,
      totals: await this.store.totals(row.id),
    };
  }
}

/** Called with every frame: the serialized message, its round and the previous view of that round. */
export type RoundListener = (
  frame: string,
  view: RoundView,
  previous: RoundView | null,
) => void;

/**
 * Every instance's view of the current round: the frames the leader
 * publishes 4 times a second, kept and handed to the sockets as they are.
 * Losing a frame is harmless, the next one is complete.
 */
@Injectable()
export class RoundFeed implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("RoundFeed");
  private subscriber: Redis | undefined;
  private last: { view: RoundView; frame: string; at: number } | undefined;
  private readonly listeners: RoundListener[] = [];

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly snapshots: SnapshotService,
    private readonly metrics: RouletteMetrics,
  ) {}

  async onApplicationBootstrap() {
    this.subscriber = this.valkey.duplicate();
    this.subscriber.on("message", (_channel: string, frame: string) =>
      this.receive(frame),
    );
    await this.subscriber.subscribe(ROUND_CHANNEL);
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => this.subscriber?.disconnect());
  }

  listen(listener: RoundListener) {
    this.listeners.push(listener);
  }

  /** The current round, from the last frame or rebuilt when frames stopped. */
  async current(): Promise<RoundView | null> {
    if (this.last && Date.now() - this.last.at < STALE_MS)
      return this.last.view;
    return this.snapshots.latest();
  }

  /** The last frame's round without a round trip (the bet path). */
  cached(): RoundView | null {
    return this.last?.view ?? null;
  }

  /** The leader publishes; every instance, the leader included, receives. */
  async publish(view: RoundView): Promise<void> {
    const message = rouletteServerMessageSchema.parse({
      type: "round.state",
      payload: { round: view },
    });
    await this.valkey.publish(ROUND_CHANNEL, JSON.stringify(message));
  }

  private receive(frame: string) {
    let view: RoundView;
    try {
      view = (JSON.parse(frame) as { payload: { round: RoundView } }).payload
        .round;
    } catch {
      this.logger.warn("Unreadable round frame dropped");
      return;
    }
    const previous = this.last?.view ?? null;
    // Frames may cross on a leader change: never step back to an older round.
    if (previous && view.round < previous.round) return;
    this.last = { view, frame, at: Date.now() };
    this.metrics.phaseIs(view.phase);
    for (const listener of this.listeners) {
      try {
        listener(frame, view, previous?.round === view.round ? previous : null);
      } catch (error) {
        this.logger.error(
          { err: (error as Error).message },
          "Round listener failed",
        );
      }
    }
  }
}
