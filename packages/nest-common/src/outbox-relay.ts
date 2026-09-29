import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  claimOutboxBatch,
  markOutboxPublished,
  purgePublishedOutbox,
  releaseOutboxEvent,
  runDetached,
} from "@outegro/db";
import { DATABASE, type DatabaseHandle } from "./database.js";
import { Messaging } from "./messaging.js";

export type OutboxRelayOptions = {
  /** Poll interval when idle (default 1 s); `kick()` publishes sooner. */
  intervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
  /** How long published rows are kept (default 7 days). */
  retentionMs?: number;
};

const RELAY_OPTIONS = Symbol("RELAY_OPTIONS");

/**
 * Publishes committed outbox events to RabbitMQ (recipe BE-05):
 * claim a batch with a lease → publish with confirm → mark published only
 * while still holding the lease. Failures return the event with backoff;
 * a crash before marking republishes the same eventId (consumers dedupe).
 */
@Injectable()
export class OutboxRelay
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("OutboxRelay");
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private lastPurge = 0;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly retentionMs: number;

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    private readonly messaging: Messaging,
    @Inject(RELAY_OPTIONS) options: OutboxRelayOptions,
  ) {
    this.intervalMs = options.intervalMs ?? 1000;
    this.batchSize = options.batchSize ?? 50;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.retentionMs = options.retentionMs ?? 7 * 24 * 3600 * 1000;
  }

  onApplicationBootstrap() {
    this.schedule(0);
  }

  onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Call after committing a transaction that enqueued events. */
  kick() {
    if (!this.running) this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    // Kicked from a request: later passes must not run as part of it.
    this.timer = runDetached(() => setTimeout(() => void this.tick(), delay));
  }

  /** One relay pass; returns the number of events published. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let published = 0;
    let full = false;
    try {
      const batch = await claimOutboxBatch(this.database.db, {
        limit: this.batchSize,
        leaseMs: this.leaseMs,
      });
      full = batch.length === this.batchSize;
      for (const event of batch) {
        try {
          await this.messaging.publish(event.exchange, event.envelope);
          if (
            await markOutboxPublished(
              this.database.db,
              event.eventId,
              event.leaseToken,
            )
          ) {
            published++;
          }
        } catch (error) {
          const delayMs = Math.min(
            60_000,
            1000 * 2 ** Math.min(event.attempts, 6),
          );
          this.logger.warn(
            {
              eventId: event.eventId,
              attempts: event.attempts,
              err: (error as Error).message,
            },
            "Publish failed, will retry",
          );
          await releaseOutboxEvent(
            this.database.db,
            event.eventId,
            event.leaseToken,
            {
              delayMs,
              error: (error as Error).message,
            },
          ).catch(() => undefined);
        }
      }
      if (Date.now() - this.lastPurge > 3600_000) {
        this.lastPurge = Date.now();
        await purgePublishedOutbox(
          this.database.db,
          new Date(Date.now() - this.retentionMs),
        );
      }
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        "Outbox relay pass failed",
      );
    } finally {
      this.running = false;
      this.schedule(full ? 0 : this.intervalMs);
    }
    return published;
  }
}

/** Requires DatabaseModule and MessagingModule. */
@Module({})
export class OutboxModule {
  static forRoot(options: OutboxRelayOptions = {}): DynamicModule {
    return {
      module: OutboxModule,
      global: true,
      providers: [{ provide: RELAY_OPTIONS, useValue: options }, OutboxRelay],
      exports: [OutboxRelay],
    };
  }
}
