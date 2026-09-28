import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import {
  type AnyEvent,
  ATTEMPT_HEADER,
  anyEventSchema,
  deadLetterQueueName,
  eventsExchange,
  type Producer,
  type QueueSpec,
  retryQueueName,
} from "@outegro/contracts";
import {
  type AmqpConnectionManager,
  type ChannelWrapper,
  connect,
} from "amqp-connection-manager";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { HealthRegistry } from "./health.js";

export type MessagingOptions = {
  url: string;
  /** The service name; also its producer exchange. */
  service: Producer;
};

/** Throw from a handler when retrying cannot help (bad data, missing aggregate). */
export class PermanentError extends Error {}

export type EventHandler = (
  event: AnyEvent,
  context: { attempt: number; redelivered: boolean },
) => Promise<void>;

const MESSAGING_OPTIONS = Symbol("MESSAGING_OPTIONS");
const quorum = { "x-queue-type": "quorum" } as const;

async function assertExchanges(
  channel: ConfirmChannel,
  names: Iterable<string>,
) {
  for (const name of new Set(names)) {
    await channel.assertExchange(name, "topic", { durable: true });
  }
}

/**
 * RabbitMQ publisher and consumers on top of amqp-connection-manager:
 * reconnects automatically and re-runs topology setup and consumers.
 * Publishing resolves only after the broker confirms the message.
 */
@Injectable()
export class Messaging implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger("Messaging");
  private readonly connection: AmqpConnectionManager;
  private readonly publisher: ChannelWrapper;
  private readonly consumers: ChannelWrapper[] = [];

  constructor(
    @Inject(MESSAGING_OPTIONS) options: MessagingOptions,
    private readonly health: HealthRegistry,
  ) {
    this.connection = connect([options.url], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 2,
      connectionOptions: {
        clientProperties: { connection_name: options.service },
      },
    });
    this.connection.on("disconnect", ({ err }) =>
      this.logger.warn({ err: err?.message }, "RabbitMQ disconnected"),
    );
    this.publisher = this.connection.createChannel({
      confirm: true,
      setup: (channel: ConfirmChannel) =>
        assertExchanges(channel, [eventsExchange(options.service)]),
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

  /** Publishes an event envelope; resolves after the broker confirm. */
  async publish(exchange: string, event: AnyEvent) {
    await this.publisher.publish(
      exchange,
      event.type,
      Buffer.from(JSON.stringify(event)),
      {
        persistent: true,
        contentType: "application/json",
        messageId: event.eventId,
        type: event.type,
        timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
        correlationId: event.correlationId,
      },
    );
  }

  /**
   * Declares the queue with its retry tiers and dead-letter queue, then
   * consumes it. Failed messages move to `<queue>.retry.<n>` (TTL, then back),
   * poison or exhausted ones to `<queue>.dlq`. Ack happens only after the
   * handler finished or the message was safely moved.
   */
  async subscribe(spec: QueueSpec, handler: EventHandler) {
    const channel = this.connection.createChannel({
      confirm: true,
      setup: async (ch: ConfirmChannel) => {
        await assertExchanges(
          ch,
          spec.bindings.map((binding) => binding.exchange),
        );
        await ch.assertQueue(spec.name, { durable: true, arguments: quorum });
        for (const binding of spec.bindings) {
          await ch.bindQueue(spec.name, binding.exchange, binding.routingKey);
        }
        for (const [tier, delay] of spec.retryDelaysMs.entries()) {
          await ch.assertQueue(retryQueueName(spec.name, tier), {
            durable: true,
            arguments: {
              ...quorum,
              "x-message-ttl": delay,
              "x-dead-letter-exchange": "",
              "x-dead-letter-routing-key": spec.name,
            },
          });
        }
        await ch.assertQueue(deadLetterQueueName(spec.name), {
          durable: true,
          arguments: quorum,
        });
      },
    });
    this.consumers.push(channel);
    await channel.waitForConnect();
    await channel.consume(
      spec.name,
      (message) => void this.handle(channel, spec, message, handler),
      { prefetch: spec.prefetch },
    );
  }

  private async handle(
    channel: ChannelWrapper,
    spec: QueueSpec,
    message: ConsumeMessage,
    handler: EventHandler,
  ) {
    const attempt = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 0);
    let event: AnyEvent;
    try {
      event = anyEventSchema.parse(
        JSON.parse(message.content.toString("utf8")),
      );
    } catch (error) {
      this.logger.error(
        { queue: spec.name, err: (error as Error).message },
        "Invalid message",
      );
      return this.moveTo(
        channel,
        message,
        deadLetterQueueName(spec.name),
        attempt,
        "invalid",
      );
    }
    try {
      await handler(event, {
        attempt,
        redelivered: message.fields.redelivered,
      });
      channel.ack(message);
    } catch (error) {
      const reason = (error as Error).message ?? "error";
      const exhausted = attempt >= spec.retryDelaysMs.length;
      const target =
        error instanceof PermanentError || exhausted
          ? deadLetterQueueName(spec.name)
          : retryQueueName(spec.name, attempt);
      this.logger.warn(
        {
          queue: spec.name,
          eventId: event.eventId,
          type: event.type,
          attempt,
          target,
          err: reason,
        },
        "Event handling failed",
      );
      await this.moveTo(channel, message, target, attempt + 1, reason);
    }
  }

  /** Copies the message to another queue (confirmed), then acks the original. */
  private async moveTo(
    channel: ChannelWrapper,
    message: ConsumeMessage,
    queue: string,
    attempt: number,
    reason: string,
  ) {
    try {
      await channel.sendToQueue(queue, message.content, {
        ...message.properties,
        persistent: true,
        headers: {
          ...message.properties.headers,
          [ATTEMPT_HEADER]: attempt,
          "x-last-error": reason.slice(0, 500),
        },
      });
      channel.ack(message);
    } catch (error) {
      // Could not park it safely: leave it for redelivery rather than lose it.
      this.logger.error(
        { queue, err: (error as Error).message },
        "Could not move message",
      );
      channel.nack(message, false, true);
    }
  }
}

@Global()
@Module({})
export class MessagingModule {
  static forRootAsync(options: {
    inject?: (string | symbol | (abstract new (...args: never[]) => unknown))[];
    useFactory: (...args: never[]) => MessagingOptions;
  }): DynamicModule {
    return {
      module: MessagingModule,
      providers: [
        {
          provide: MESSAGING_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        Messaging,
      ],
      exports: [Messaging],
    };
  }
}
