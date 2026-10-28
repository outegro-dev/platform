import { createRequire } from "node:module";

/**
 * The part of amqp-connection-manager (and amqplib underneath) this service
 * uses: reconnects, re-runs topology setup and consumers, confirms.
 *
 * TODO(deps): add `amqp-connection-manager` and `amqplib` to this app's
 * dependencies and import them directly. Until then they are loaded from
 * @outegro/nest-common's install (the same versions the platform runs); the
 * platform Messaging cannot carry tasks, it only takes event envelopes of the
 * known producers.
 */
export type AmqpMessage = {
  content: Buffer;
  fields: { redelivered: boolean; routingKey: string; exchange: string };
  properties: {
    messageId?: string;
    correlationId?: string;
    headers?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

export type PublishOptions = {
  persistent?: boolean;
  contentType?: string;
  messageId?: string;
  correlationId?: string;
  type?: string;
  timestamp?: number;
  headers?: Record<string, unknown>;
  expiration?: string | number;
};

/** The raw amqplib confirm channel passed to setup functions. */
export type SetupChannel = {
  assertExchange(
    name: string,
    type: string,
    options?: { durable?: boolean },
  ): Promise<unknown>;
  assertQueue(
    name: string,
    options?: { durable?: boolean; arguments?: Record<string, unknown> },
  ): Promise<unknown>;
  bindQueue(queue: string, exchange: string, pattern: string): Promise<unknown>;
  prefetch(count: number, global?: boolean): Promise<unknown>;
};

export type ChannelWrapper = {
  on(event: "error", listener: (error: Error) => void): unknown;
  waitForConnect(): Promise<void>;
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: PublishOptions,
  ): Promise<boolean>;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: PublishOptions,
  ): Promise<boolean>;
  consume(
    queue: string,
    onMessage: (message: AmqpMessage) => void,
    options?: { prefetch?: number },
  ): Promise<{ consumerTag: string }>;
  checkQueue(
    queue: string,
  ): Promise<{ queue: string; messageCount: number; consumerCount: number }>;
  ack(message: AmqpMessage): void;
  nack(message: AmqpMessage, allUpTo?: boolean, requeue?: boolean): void;
  cancelAll(): Promise<void>;
  close(): Promise<void>;
};

export type AmqpConnection = {
  on(
    event: "disconnect",
    listener: (info: { err?: Error }) => void,
  ): AmqpConnection;
  isConnected(): boolean;
  createChannel(options: {
    confirm?: boolean;
    setup?: (channel: SetupChannel) => Promise<unknown>;
  }): ChannelWrapper;
  close(): Promise<void>;
};

type AmqpConnectionManagerModule = {
  connect(
    urls: string[],
    options?: {
      heartbeatIntervalInSeconds?: number;
      reconnectTimeInSeconds?: number;
      connectionOptions?: Record<string, unknown>;
    },
  ): AmqpConnection;
};

let loaded: AmqpConnectionManagerModule | undefined;

function load(): AmqpConnectionManagerModule {
  if (loaded) return loaded;
  const local = createRequire(import.meta.url);
  try {
    loaded = local("amqp-connection-manager") as AmqpConnectionManagerModule;
  } catch {
    const common = createRequire(local.resolve("@outegro/nest-common"));
    loaded = common("amqp-connection-manager") as AmqpConnectionManagerModule;
  }
  return loaded;
}

export function connectAmqp(url: string, name: string): AmqpConnection {
  return load().connect([url], {
    heartbeatIntervalInSeconds: 15,
    reconnectTimeInSeconds: 2,
    connectionOptions: { clientProperties: { connection_name: name } },
  });
}
