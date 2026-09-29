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

type Sample = { name: string; labels: Record<string, string>; value: number };

/** `name{label="value",...} value` lines of a Prometheus text scrape. */
function samplesOf(scrape: string): Sample[] {
  return scrape.split("\n").flatMap((line) => {
    const match = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})? (\S+)$/.exec(line);
    if (!match?.[1] || !match[3]) return [];
    const labels = Object.fromEntries(
      [...(match[2] ?? "").matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)].map(
        ([, key, value]) => [key, value],
      ),
    );
    return [{ name: match[1], labels, value: Number(match[3]) }];
  });
}

/** Sum of the samples of `name` whose labels include `labels`; 0 if none. */
export function metricValue(
  scrape: string,
  name: string,
  labels: Record<string, string> = {},
) {
  return samplesOf(scrape)
    .filter(
      (sample) =>
        sample.name === name &&
        Object.entries(labels).every(
          ([key, value]) => sample.labels[key] === value,
        ),
    )
    .reduce((sum, sample) => sum + sample.value, 0);
}

const ID_LIKE = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /@/,
  /[0-9a-f]{16,}/i,
  /[\w-]{32,}/,
];

/** Label values that look like ids, emails or tokens; there must be none (9.4). */
export function idLikeLabelValues(scrape: string) {
  const values = new Set(
    samplesOf(scrape).flatMap((sample) => Object.values(sample.labels)),
  );
  return [...values].filter((value) =>
    ID_LIKE.some((pattern) => pattern.test(value)),
  );
}
