import { randomUUID } from "node:crypto";
import { type AnyEvent, defineQueue } from "@outegro/contracts";
import {
  createDatabase,
  enqueueEvent,
  inbox,
  outbox,
  processOnce,
} from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import { connect } from "amqp-connection-manager";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthRegistry } from "./health.js";
import { Messaging, PermanentError } from "./messaging.js";
import { OutboxRelay } from "./outbox-relay.js";
import { startRabbit, type TestService } from "./testing.js";

const event = (type = "identity.user.created.v1"): AnyEvent => ({
  eventId: randomUUID(),
  type,
  schemaVersion: 1,
  occurredAt: new Date().toISOString(),
  aggregateId: randomUUID(),
  aggregateVersion: 1,
  producer: "identity",
  payload: { userId: randomUUID(), locale: "en", status: "active" },
});

const waitFor = async (predicate: () => boolean, ms = 10_000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

let rabbit: TestService;
let publisher: Messaging;
let consumer: Messaging;

beforeAll(async () => {
  rabbit = await startRabbit();
  publisher = new Messaging(
    { url: rabbit.url, service: "identity" },
    new HealthRegistry(),
  );
  consumer = new Messaging(
    { url: rabbit.url, service: "notifications" },
    new HealthRegistry(),
  );
});
afterAll(async () => {
  await consumer?.onApplicationShutdown();
  await publisher?.onApplicationShutdown();
  await rabbit?.stop();
});

async function peekQueue(queue: string) {
  const connection = connect([rabbit.url]);
  const channel = connection.createChannel();
  await channel.waitForConnect();
  const messages: { body: string; headers: Record<string, unknown> }[] = [];
  for (;;) {
    const message = await channel.get(queue, { noAck: true });
    if (!message) break;
    messages.push({
      body: message.content.toString(),
      headers: message.properties.headers ?? {},
    });
  }
  await connection.close();
  return messages;
}

describe("Messaging", () => {
  it("delivers a confirmed event to every bound consumer queue", async () => {
    const received: AnyEvent[] = [];
    await consumer.subscribe(
      defineQueue("notifications", "t1", [
        { producer: "identity", types: ["identity.user.created.v1"] },
      ]),
      async (e) => {
        received.push(e);
      },
    );
    const e = event();
    await publisher.publish("identity.events", e);
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual(e);
  });

  it("retries through TTL tiers with an attempt counter, then succeeds", async () => {
    const attempts: number[] = [];
    await consumer.subscribe(
      defineQueue(
        "notifications",
        "t2",
        [{ producer: "identity", types: ["identity.user.locale.changed.v1"] }],
        { retryDelaysMs: [100, 100, 100] },
      ),
      async (_e, { attempt }) => {
        attempts.push(attempt);
        if (attempt < 2) throw new Error("transient");
      },
    );
    await publisher.publish(
      "identity.events",
      event("identity.user.locale.changed.v1"),
    );
    await waitFor(() => attempts.length === 3);
    expect(attempts).toEqual([0, 1, 2]);
  });

  it("parks exhausted, permanent and malformed messages in the DLQ", async () => {
    const spec = defineQueue(
      "notifications",
      "t3",
      [
        {
          producer: "identity",
          types: [
            "identity.user.status.changed.v1",
            "identity.session.revoked.v1",
          ],
        },
      ],
      { retryDelaysMs: [50] },
    );
    let calls = 0;
    await consumer.subscribe(spec, async (e) => {
      calls++;
      if (e.type === "identity.session.revoked.v1")
        throw new PermanentError("unknown session");
      throw new Error("always failing");
    });
    await publisher.publish(
      "identity.events",
      event("identity.user.status.changed.v1"),
    );
    await publisher.publish(
      "identity.events",
      event("identity.session.revoked.v1"),
    );
    // Malformed: valid routing key but not an event envelope.
    const raw = connect([rabbit.url]).createChannel();
    await raw.waitForConnect();
    await raw.publish(
      "identity.events",
      "identity.user.status.changed.v1",
      Buffer.from("{nope"),
    );
    await waitFor(() => calls >= 3);
    await new Promise((r) => setTimeout(r, 500));
    const parked = await peekQueue("notifications.t3.dlq");
    expect(parked).toHaveLength(3);
    const reasons = parked.map((m) => m.headers["x-last-error"]);
    expect(reasons).toEqual(
      expect.arrayContaining(["always failing", "unknown session", "invalid"]),
    );
    await raw.close();
  });
});

describe("OutboxRelay", () => {
  let pg: TestPostgres;
  let database: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    pg = await startPostgres({ outbox, inbox });
    database = createDatabase({ url: pg.url });
  });
  afterAll(async () => {
    await database?.close();
    await pg?.stop();
  });

  it("publishes committed events once and consumers apply them once", async () => {
    const effects: string[] = [];
    await consumer.subscribe(
      defineQueue("notifications", "t4", [
        { producer: "identity", types: ["identity.role.binding.changed.v1"] },
      ]),
      async (e) => {
        await processOnce(
          database.db,
          { consumer: "notifications", eventId: e.eventId, type: e.type },
          async () => {
            effects.push(e.eventId);
          },
        );
      },
    );
    const relay = new OutboxRelay(database, publisher, { intervalMs: 50 });
    const events = [
      event("identity.role.binding.changed.v1"),
      event("identity.role.binding.changed.v1"),
    ];
    await database.db.transaction(async (tx) => {
      for (const e of events) await enqueueEvent(tx, e);
    });
    expect(await relay.tick()).toBe(2);
    await waitFor(() => effects.length === 2);
    // A crash after publish but before marking republishes the same eventId.
    const [first] = events;
    if (!first) throw new Error("no event");
    await publisher.publish("identity.events", first);
    await new Promise((r) => setTimeout(r, 500));
    expect(effects.sort()).toEqual(events.map((e) => e.eventId).sort());
    expect(await relay.tick()).toBe(0);
    relay.onApplicationShutdown();
  });
});
