import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  type AtelierTask,
  atelierTaskSchema,
} from "@outegro/contracts/atelier";
import {
  claimOutboxBatch,
  markOutboxPublished,
  purgePublishedOutbox,
  releaseOutboxEvent,
  runDetached,
} from "@outegro/db";
import { DATABASE, heldBySafeMode } from "@outegro/nest-common";
import type { AtelierDatabase, Executor } from "../common/database.js";
import { outbox } from "../db/schema.js";
import { TaskBus } from "./task-bus.js";
import { tasksExchange } from "./topology.js";

/**
 * Stores a task in the same transaction as the step that dispatches it; the
 * relay publishes it once `availableAt` has come (a backoff or a quota pause
 * is a later `availableAt`). The task id is the outbox event id.
 */
export async function enqueueTask(
  tx: Executor,
  task: AtelierTask,
  availableAt?: Date,
) {
  await tx.insert(outbox).values({
    eventId: task.id,
    type: `atelier.task.${task.type}`,
    exchange: tasksExchange,
    envelope: task,
    ...(availableAt ? { availableAt } : {}),
  });
}

/**
 * Publishes committed tasks to RabbitMQ (recipe BE-05, as the platform
 * OutboxRelay): claim a batch with a lease → publish with confirm → mark
 * published while still holding the lease. A crash before marking publishes
 * the same task id again; the orchestrator and workers dedupe on it.
 */
@Injectable()
export class TaskRelay
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("TaskRelay");
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private lastPurge = 0;
  private readonly intervalMs = 1000;
  private readonly batchSize = 50;

  constructor(
    @Inject(DATABASE) private readonly database: AtelierDatabase,
    private readonly bus: TaskBus,
  ) {}

  onApplicationBootstrap() {
    if (heldBySafeMode("task-relay")) return;
    this.schedule(0);
  }

  onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Call after committing a transaction that enqueued tasks. */
  kick() {
    if (heldBySafeMode("task-relay")) return;
    if (!this.running) this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = runDetached(() => setTimeout(() => void this.tick(), delay));
  }

  /** One pass; returns the number of tasks published. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let published = 0;
    let full = false;
    try {
      const batch = await claimOutboxBatch(this.database.db, {
        limit: this.batchSize,
        leaseMs: 30_000,
      });
      full = batch.length === this.batchSize;
      for (const row of batch) {
        try {
          if (row.exchange !== tasksExchange)
            throw new Error(`no publisher for exchange ${row.exchange}`);
          const task = atelierTaskSchema.parse(row.envelope);
          await this.bus.publishTask(task);
          if (
            await markOutboxPublished(
              this.database.db,
              row.eventId,
              row.leaseToken,
            )
          )
            published++;
        } catch (error) {
          const delayMs = Math.min(
            60_000,
            1000 * 2 ** Math.min(row.attempts, 6),
          );
          this.logger.warn(
            {
              taskId: row.eventId,
              attempts: row.attempts,
              err: (error as Error).message,
            },
            "Task publish failed, will retry",
          );
          await releaseOutboxEvent(
            this.database.db,
            row.eventId,
            row.leaseToken,
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
          new Date(Date.now() - 7 * 24 * 3600_000),
        );
      }
    } catch (error) {
      this.logger.error(
        { err: (error as Error).message },
        "Task relay pass failed",
      );
    } finally {
      this.running = false;
      this.schedule(full ? 0 : this.intervalMs);
    }
    return published;
  }
}
