import type { Producer } from "./envelope.js";

/**
 * RabbitMQ topology shared by every service.
 *
 * - One durable topic exchange per producer: `<producer>.events`.
 *   The routing key is the event type (`identity.user.created.v1`).
 * - Every consumer owns its queues: `<consumer>.<name>` (quorum). Several
 *   consumers of one event each get their own copy; workers of one queue compete.
 * - Failed messages go to `<queue>.retry.<n>` (TTL, dead-letters back to the
 *   queue) and after the last tier to `<queue>.dlq` for inspection and replay.
 */
export const eventsExchange = (producer: Producer) => `${producer}.events`;

/** Default retry delays (notifications contract): 15 s, 1 min, 5 min, 15 min. */
export const defaultRetryDelaysMs = [15_000, 60_000, 300_000, 900_000] as const;

export type QueueSpec = {
  /** Full queue name, `<consumer>.<name>`. */
  name: string;
  bindings: { exchange: string; routingKey: string }[];
  retryDelaysMs: readonly number[];
  prefetch: number;
};

export function defineQueue(
  consumer: Producer,
  name: string,
  bindings: { producer: Producer; types: string[] }[],
  options: { retryDelaysMs?: readonly number[]; prefetch?: number } = {},
): QueueSpec {
  return {
    name: `${consumer}.${name}`,
    bindings: bindings.flatMap(({ producer, types }) =>
      types.map((routingKey) => ({
        exchange: eventsExchange(producer),
        routingKey,
      })),
    ),
    retryDelaysMs: options.retryDelaysMs ?? defaultRetryDelaysMs,
    prefetch: options.prefetch ?? 16,
  };
}

export const retryQueueName = (queue: string, tier: number) =>
  `${queue}.retry.${tier}`;
export const deadLetterQueueName = (queue: string) => `${queue}.dlq`;

/** Header carrying the number of processing attempts already made. */
export const ATTEMPT_HEADER = "x-attempt";
