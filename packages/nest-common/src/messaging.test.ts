import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { type AnyEvent, defineQueue } from "@outegro/contracts";
import {
  type Correlation,
  createDatabase,
  currentCorrelation,
  enqueueEvent,
  inbox,
  outbox,
  processOnce,
  runWithCorrelation,
} from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import { connect } from "amqp-connection-manager";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

  it("handles every event as part of its correlation and logs its ids", async () => {
    const logged = vi.spyOn(Logger.prototype, "log");
    const seen = new Map<string, Correlation | undefined>();
    await consumer.subscribe(
      defineQueue("notifications", "t5", [
        { producer: "identity", types: ["identity.user.contact.changed.v1"] },
      ]),
      async (e) => {
        seen.set(e.eventId, currentCorrelation());
      },
    );
    const chained = {
      ...event("identity.user.contact.changed.v1"),
      correlationId: "req-chain-0001",
    };
    const first = event("identity.user.contact.changed.v1");
    await publisher.publish("identity.events", chained);
    await publisher.publish("identity.events", first);
    await waitFor(() => seen.size === 2);
    // A chain continues with its id; an event without one starts a chain.
    expect(seen.get(chained.eventId)).toEqual({
      correlationId: "req-chain-0001",
      causationId: chained.eventId,
    });
    expect(seen.get(first.eventId)).toEqual({
      correlationId: first.eventId,
      causationId: first.eventId,
    });
    await waitFor(() => logged.mock.calls.length >= 2);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: "notifications.t5",
        eventId: chained.eventId,
        type: "identity.user.contact.changed.v1",
        correlationId: "req-chain-0001",
      }),
      "Event handled",
    );
    logged.mockRestore();
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

  it("carries a request's correlation through a consumer into the next event", async () => {
    const caused = event("identity.chain.caused.v1");
    await consumer.subscribe(
      defineQueue("notifications", "t6", [
        { producer: "identity", types: ["identity.chain.started.v1"] },
      ]),
      () => database.db.transaction((tx) => enqueueEvent(tx, caused)),
    );
    const relay = new OutboxRelay(database, publisher, { intervalMs: 50 });
    const started = event("identity.chain.started.v1");
    await runWithCorrelation(
      { correlationId: "req-chain-0002", causationId: "req-chain-0002" },
      () => database.db.transaction((tx) => enqueueEvent(tx, started)),
    );
    expect(await relay.tick()).toBe(1);
    const envelopes = async () =>
      new Map(
        (await database.db.select().from(outbox)).map((row) => [
          row.eventId,
          row.envelope as AnyEvent,
        ]),
      );
    await expect
      .poll(async () => (await envelopes()).has(caused.eventId))
      .toBe(true);
    const stored = await envelopes();
    expect(stored.get(started.eventId)).toMatchObject({
      correlationId: "req-chain-0002",
      causationId: "req-chain-0002",
    });
    expect(stored.get(caused.eventId)).toMatchObject({
      correlationId: "req-chain-0002",
      causationId: started.eventId,
    });
    relay.onApplicationShutdown();
  });
});
