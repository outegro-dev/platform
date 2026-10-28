import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type {
  AtelierTask,
  AtelierTaskResult,
  AtelierTaskType,
} from "@outegro/contracts/atelier";
import { type Counter, HealthRegistry, Metrics } from "@outegro/nest-common";
import { rabbitConfig } from "../config/config.js";
import {
  type AmqpConnection,
  type AmqpMessage,
  type ChannelWrapper,
  connectAmqp,
} from "./amqp.js";
import { remoteTaskTypes } from "./task-types.js";
import {
  ATTEMPT_HEADER,
  assertTopology,
  deadLetterQueue,
  resultRoutingKey,
  resultsQueue,
  retryDelaysMs,
  retryTier,
  taskQueue,
  tasksExchange,
} from "./topology.js";

export type MessageContext = {
  /** Message-level attempts already made (0 on the first delivery). */
  attempt: number;
  redelivered: boolean;
};

export type ConsumeOptions = {
  prefetch: number;
  /** Called once the last retry tier failed, before the message goes to the DLQ. */
  onExhausted?: (raw: unknown, error: Error) => Promise<void>;
};

/** Throw from a consumer when retrying cannot help: straight to the DLQ. */
export class PoisonMessageError extends Error {}

/**
 * Tasks and results over RabbitMQ (amqp-connection-manager: reconnects,
 * re-declares the topology and re-attaches consumers). Publishing resolves
 * after the broker confirm; a consumer acks only after its handler finished
 * or the message was moved to a retry tier or the DLQ.
 */
@Injectable()
export class TaskBus implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger("TaskBus");
  private readonly connection: AmqpConnection;
  private readonly publisher: ChannelWrapper;
  private readonly consumers: ChannelWrapper[] = [];
  private readonly consumed: Counter<"queue" | "outcome"> | undefined;

  constructor(
    @Inject(rabbitConfig.KEY) rabbit: ConfigType<typeof rabbitConfig>,
    private readonly health: HealthRegistry,
    @Optional() metrics?: Metrics,
  ) {
    this.connection = connectAmqp(rabbit.url, "atelier");
    this.connection.on("disconnect", ({ err }) =>
      this.logger.warn({ err: err?.message }, "RabbitMQ disconnected"),
    );
    this.publisher = this.connection.createChannel({
      confirm: true,
      setup: (channel) => assertTopology(channel, remoteTaskTypes),
    });
    this.watch(this.publisher, "publisher");
    this.consumed = metrics?.counter({
      name: "atelier_messages_consumed_total",
      help: "Task and result messages by queue and outcome: processed, retried or dead_lettered.",
      labelNames: ["queue", "outcome"],
    });
  }

  onModuleInit() {
    this.health.register("rabbitmq", async () => {
      if (!this.connection.isConnected()) throw new Error("not connected");
    });
  }

  async onApplicationShutdown() {
    await Promise.allSettled(this.consumers.map((channel) => channel.close()));
    await this.publisher.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }

  private watch(channel: ChannelWrapper, name: string) {
    channel.on("error", (err: Error) =>
      this.logger.warn(
        { err: err.message, channel: name },
        "RabbitMQ channel error",
      ),
    );
  }

  async ready() {
    await this.publisher.waitForConnect();
  }

  /** Publishes a task to its queue; resolves after the broker confirm. */
  async publishTask(task: AtelierTask) {
    await this.publisher.publish(
      tasksExchange,
      task.type,
      Buffer.from(JSON.stringify(task)),
      {
        persistent: true,
        contentType: "application/json",
        messageId: task.id,
        correlationId: task.jobId,
        type: `atelier.task.${task.type}`,
        timestamp: Math.floor(Date.now() / 1000),
      },
    );
  }

  async publishResult(result: AtelierTaskResult) {
    await this.publisher.publish(
      tasksExchange,
      resultRoutingKey,
      Buffer.from(JSON.stringify(result)),
      {
        persistent: true,
        contentType: "application/json",
        messageId: `${result.taskId}:${result.status}`,
        correlationId: result.jobId,
        type: "atelier.result",
        timestamp: Math.floor(Date.now() / 1000),
      },
    );
  }

  /** Messages waiting in a task queue (pipeline screen). */
  async depth(type: AtelierTaskType): Promise<number> {
    try {
      const queue = await this.publisher.checkQueue(taskQueue(type));
      return queue.messageCount;
    } catch {
      return 0;
    }
  }

  consumeTasks(
    type: AtelierTaskType,
    handler: (raw: unknown, context: MessageContext) => Promise<void>,
    options: ConsumeOptions,
  ) {
    return this.consume(taskQueue(type), handler, options);
  }

  consumeResults(
    handler: (raw: unknown, context: MessageContext) => Promise<void>,
    options: ConsumeOptions,
  ) {
    return this.consume(resultsQueue, handler, options);
  }

  private async consume(
    queue: string,
    handler: (raw: unknown, context: MessageContext) => Promise<void>,
    options: ConsumeOptions,
  ) {
    const channel = this.connection.createChannel({
      confirm: true,
      setup: (ch) => assertTopology(ch, remoteTaskTypes),
    });
    this.watch(channel, queue);
    this.consumers.push(channel);
    await channel.waitForConnect();
    await channel.consume(
      queue,
      (message) =>
        void this.handle(channel, queue, message, handler, options).catch(
          (error: Error) =>
            this.logger.error(
              { queue, err: error.message },
              "Consumer crashed",
            ),
        ),
      { prefetch: options.prefetch },
    );
  }

  private async handle(
    channel: ChannelWrapper,
    queue: string,
    message: AmqpMessage,
    handler: (raw: unknown, context: MessageContext) => Promise<void>,
    options: ConsumeOptions,
  ) {
    const attempt = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 0);
    let raw: unknown;
    try {
      raw = JSON.parse(message.content.toString("utf8"));
    } catch (error) {
      this.consumed?.inc({ queue, outcome: "dead_lettered" });
      return this.moveTo(channel, message, "", deadLetterQueue, attempt, error);
    }
    try {
      await handler(raw, { attempt, redelivered: message.fields.redelivered });
      channel.ack(message);
      this.consumed?.inc({ queue, outcome: "processed" });
    } catch (error) {
      const poison = error instanceof PoisonMessageError;
      const exhausted = attempt >= retryDelaysMs.length;
      this.logger.warn(
        {
          queue,
          messageId: message.properties.messageId,
          attempt,
          err: (error as Error).message,
        },
        "Message handling failed",
      );
      if (poison || exhausted) {
        await options
          .onExhausted?.(raw, error as Error)
          .catch((cause: Error) =>
            this.logger.error(
              { queue, err: cause.message },
              "Exhausted handler failed",
            ),
          );
        this.consumed?.inc({ queue, outcome: "dead_lettered" });
        return this.moveTo(
          channel,
          message,
          "",
          deadLetterQueue,
          attempt + 1,
          error,
        );
      }
      this.consumed?.inc({ queue, outcome: "retried" });
      return this.moveTo(
        channel,
        message,
        retryTier(attempt),
        message.fields.routingKey,
        attempt + 1,
        error,
      );
    }
  }

  /** Copies the message on (confirmed), then acks the original. */
  private async moveTo(
    channel: ChannelWrapper,
    message: AmqpMessage,
    exchange: string,
    routingKey: string,
    attempt: number,
    error: unknown,
  ) {
    try {
      await channel.publish(exchange, routingKey, message.content, {
        ...(message.properties as Record<string, unknown>),
        persistent: true,
        headers: {
          ...message.properties.headers,
          [ATTEMPT_HEADER]: attempt,
          "x-last-error": String((error as Error)?.message ?? error).slice(
            0,
            500,
          ),
        },
      });
      channel.ack(message);
    } catch (cause) {
      // Could not park it safely: leave it for redelivery rather than lose it.
      this.logger.error(
        { routingKey, err: (cause as Error).message },
        "Could not move message",
      );
      channel.nack(message, false, true);
    }
  }
}
