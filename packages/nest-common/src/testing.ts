import { RabbitMQContainer } from "@testcontainers/rabbitmq";
import { ValkeyContainer } from "@testcontainers/valkey";

export type TestService = { url: string; stop: () => Promise<unknown> };

/** RabbitMQ 4 for integration tests (production major). */
export async function startRabbit(): Promise<TestService> {
  const container = await new RabbitMQContainer("rabbitmq:4.3-alpine").start();
  return { url: container.getAmqpUrl(), stop: () => container.stop() };
}

/** Valkey 9 for integration tests (production major). */
export async function startValkey(): Promise<TestService> {
  const container = await new ValkeyContainer(
    "valkey/valkey:9.1-alpine",
  ).start();
  return { url: container.getConnectionUrl(), stop: () => container.stop() };
}
