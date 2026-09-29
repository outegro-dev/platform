import { randomUUID } from "node:crypto";
import type { AnyEvent } from "@outegro/contracts";
import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";
import {
  currentCorrelation,
  runDetached,
  runWithCorrelation,
} from "./correlation.js";
import { processOnce, type Transaction } from "./inbox.js";
import {
  claimOutboxBatch,
  enqueueEvent,
  markOutboxPublished,
  releaseOutboxEvent,
} from "./outbox.js";
import { inbox, outbox } from "./schema.js";
import { startPostgres } from "./testing.js";

const counters = pgTable("counters", {
  id: text("id").primaryKey(),
  value: integer("value").notNull(),
});

const event = (): AnyEvent => ({
  eventId: randomUUID(),
  type: "identity.user.created.v1",
  schemaVersion: 1,
  occurredAt: new Date().toISOString(),
  aggregateId: randomUUID(),
  aggregateVersion: 1,
  producer: "identity",
  payload: { userId: randomUUID(), locale: "en", status: "active" },
});

let pg: Awaited<ReturnType<typeof startPostgres>>;
let database: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  pg = await startPostgres({ outbox, inbox, counters });
  database = createDatabase({ url: pg.url, max: 6 });
});
afterAll(async () => {
  await database?.close();
  await pg?.stop();
});
beforeEach(async () => {
  await database.db.execute(sql`truncate outbox, inbox, counters`);
});

describe("outbox", () => {
  it("keeps no event when the domain transaction rolls back", async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await enqueueEvent(tx, event());
        throw new Error("domain failure");
      }),
    ).rejects.toThrow("domain failure");
    expect(
      await claimOutboxBatch(database.db, { limit: 10, leaseMs: 30_000 }),
    ).toEqual([]);
  });

  it("routes events to the producer exchange and keeps the envelope", async () => {
    const e = event();
    await database.db.transaction((tx) => enqueueEvent(tx, e));
    const [claimed] = await claimOutboxBatch(database.db, {
      limit: 10,
      leaseMs: 30_000,
    });
    expect(claimed?.exchange).toBe("identity.events");
    expect(claimed?.envelope).toEqual(e);
    expect(claimed?.attempts).toBe(1);
  });

  it("never hands the same event to two concurrent relays", async () => {
    for (let i = 0; i < 40; i++)
      await database.db.transaction((tx) => enqueueEvent(tx, event()));
    const batches = await Promise.all(
      Array.from({ length: 4 }, () =>
        claimOutboxBatch(database.db, { limit: 15, leaseMs: 30_000 }),
      ),
    );
    const ids = batches.flat().map((e) => e.eventId);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  });

  it("lets a stale relay neither publish nor release after its lease expired", async () => {
    await database.db.transaction((tx) => enqueueEvent(tx, event()));
    const [stale] = await claimOutboxBatch(database.db, {
      limit: 1,
      leaseMs: 1,
    });
    await new Promise((r) => setTimeout(r, 20));
    const [fresh] = await claimOutboxBatch(database.db, {
      limit: 1,
      leaseMs: 30_000,
    });
    expect(fresh?.eventId).toBe(stale?.eventId);
    expect(fresh?.attempts).toBe(2);
    if (!stale || !fresh) throw new Error("claim failed");
    expect(
      await markOutboxPublished(database.db, stale.eventId, stale.leaseToken),
    ).toBe(false);
    expect(
      await releaseOutboxEvent(database.db, stale.eventId, stale.leaseToken, {
        delayMs: 0,
        error: "late",
      }),
    ).toBe(false);
    expect(
      await markOutboxPublished(database.db, fresh.eventId, fresh.leaseToken),
    ).toBe(true);
    expect(
      await claimOutboxBatch(database.db, { limit: 10, leaseMs: 30_000 }),
    ).toEqual([]);
  });

  it("does not reclaim a released event before its retry delay", async () => {
    await database.db.transaction((tx) => enqueueEvent(tx, event()));
    const [claimed] = await claimOutboxBatch(database.db, {
      limit: 1,
      leaseMs: 30_000,
    });
    if (!claimed) throw new Error("claim failed");
    await releaseOutboxEvent(database.db, claimed.eventId, claimed.leaseToken, {
      delayMs: 60_000,
      error: "broker nack",
    });
    expect(
      await claimOutboxBatch(database.db, { limit: 1, leaseMs: 30_000 }),
    ).toEqual([]);
  });

  it("stamps the correlation of the request it runs for, keeping explicit ids", async () => {
    const plain = event();
    const explicit = {
      ...event(),
      correlationId: "order-chain-1",
      causationId: "cmd-1",
    };
    await runWithCorrelation(
      { correlationId: "req-00000001", causationId: "req-00000001" },
      () =>
        database.db.transaction(async (tx) => {
          await enqueueEvent(tx, plain);
          await enqueueEvent(tx, explicit);
        }),
    );
    const envelopes = new Map(
      (await claimOutboxBatch(database.db, { limit: 10, leaseMs: 30_000 })).map(
        (claimed) => [claimed.eventId, claimed.envelope],
      ),
    );
    expect(envelopes.get(plain.eventId)).toEqual({
      ...plain,
      correlationId: "req-00000001",
      causationId: "req-00000001",
    });
    expect(envelopes.get(explicit.eventId)).toEqual(explicit);
  });

  it("keeps detached work out of the surrounding correlation", async () => {
    const seen = await runWithCorrelation(
      { correlationId: "req-00000002", causationId: "req-00000002" },
      () =>
        new Promise<[unknown, unknown]>((resolve) => {
          const inside = currentCorrelation();
          runDetached(() =>
            setTimeout(() => resolve([inside, currentCorrelation()]), 1),
          );
        }),
    );
    expect(seen).toEqual([
      { correlationId: "req-00000002", causationId: "req-00000002" },
      undefined,
    ]);
  });
});

describe("inbox", () => {
  const increment = async (tx: Transaction) => {
    await tx
      .insert(counters)
      .values({ id: "a", value: 1 })
      .onConflictDoUpdate({
        target: counters.id,
        set: { value: sql`${counters.value} + 1` },
      });
  };

  it("applies a redelivered event only once", async () => {
    const message = {
      consumer: "notifications",
      eventId: randomUUID(),
      type: "x.y.v1",
    };
    expect(await processOnce(database.db, message, increment)).toBe(
      "processed",
    );
    expect(await processOnce(database.db, message, increment)).toBe(
      "duplicate",
    );
    const [row] = await database.db.select().from(counters);
    expect(row?.value).toBe(1);
  });

  it("keeps separate consumers independent", async () => {
    const eventId = randomUUID();
    await processOnce(
      database.db,
      { consumer: "a", eventId, type: "x.y.v1" },
      increment,
    );
    expect(
      await processOnce(
        database.db,
        { consumer: "b", eventId, type: "x.y.v1" },
        increment,
      ),
    ).toBe("processed");
  });

  it("rolls back the marker when the effect fails, so redelivery retries", async () => {
    const message = {
      consumer: "notifications",
      eventId: randomUUID(),
      type: "x.y.v1",
    };
    await expect(
      processOnce(database.db, message, async () => {
        throw new Error("transient");
      }),
    ).rejects.toThrow("transient");
    expect(await processOnce(database.db, message, increment)).toBe(
      "processed",
    );
  });
});
