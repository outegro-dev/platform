import type { AtelierTaskType } from "@outegro/contracts/atelier";
import type { SetupChannel } from "./amqp.js";

/**
 * RabbitMQ topology of the pipeline, declared by this app (the platform
 * topology in @outegro/contracts covers event envelopes only):
 *
 * - `atelier.tasks`: direct exchange; the routing key is the task type, or
 *   `result` for results.
 * - `atelier.task.<type>`: one quorum queue per task type; workers compete.
 * - `atelier.results`: results of every task, read by the orchestrator.
 * - `atelier.retry.<n>` (15 s, 1 min, 5 min): a consumer that threw parks the
 *   message here through the fanout exchange of the same name; after the TTL
 *   it dead-letters back to `atelier.tasks` under its own routing key, so one
 *   set of tiers serves every queue.
 * - `atelier.task.dlq`: after the last tier (a worker also sends a `fail`
 *   result then, so the job never hangs).
 */
export const tasksExchange = "atelier.tasks";
export const resultsQueue = "atelier.results";
export const resultRoutingKey = "result";
export const deadLetterQueue = "atelier.task.dlq";
export const taskQueue = (type: AtelierTaskType) => `atelier.task.${type}`;
export const retryTier = (tier: number) => `atelier.retry.${tier}`;

/** Message-level retries of a consumer: 15 s, 1 min, 5 min. */
export const retryDelaysMs = [15_000, 60_000, 300_000] as const;

/** Header with the number of message-level attempts already made. */
export const ATTEMPT_HEADER = "x-attempt";

const quorum = { "x-queue-type": "quorum" } as const;

/** Declares the exchanges and queues; every process runs it on (re)connect. */
export async function assertTopology(
  channel: SetupChannel,
  types: readonly AtelierTaskType[],
) {
  await channel.assertExchange(tasksExchange, "direct", { durable: true });
  for (const type of types) {
    const queue = taskQueue(type);
    await channel.assertQueue(queue, { durable: true, arguments: quorum });
    await channel.bindQueue(queue, tasksExchange, type);
  }
  await channel.assertQueue(resultsQueue, { durable: true, arguments: quorum });
  await channel.bindQueue(resultsQueue, tasksExchange, resultRoutingKey);
  for (const [tier, delay] of retryDelaysMs.entries()) {
    const name = retryTier(tier);
    await channel.assertExchange(name, "fanout", { durable: true });
    await channel.assertQueue(name, {
      durable: true,
      arguments: {
        ...quorum,
        "x-message-ttl": delay,
        "x-dead-letter-exchange": tasksExchange,
      },
    });
    await channel.bindQueue(name, name, "");
  }
  await channel.assertQueue(deadLetterQueue, {
    durable: true,
    arguments: quorum,
  });
}
