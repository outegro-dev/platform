import { randomUUID } from "node:crypto";
import type { AnyEvent } from "@outegro/contracts";
import { eventsExchange } from "@outegro/contracts";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Executor } from "./client.js";
import { currentCorrelation } from "./correlation.js";
import { outbox } from "./schema.js";

/**
 * Stores an event in the same transaction as the domain change (INV-13).
 * Call with the transaction handle, never with a separate connection.
 * Missing correlation and causation ids are taken from the request or
 * consumed event this runs for (`runWithCorrelation`).
 */
export async function enqueueEvent(tx: Executor, event: AnyEvent) {
  const correlation = currentCorrelation();
  const envelope: AnyEvent = correlation
    ? {
        ...event,
        correlationId: event.correlationId ?? correlation.correlationId,
        causationId: event.causationId ?? correlation.causationId,
      }
    : event;
  await tx.insert(outbox).values({
    eventId: envelope.eventId,
    type: envelope.type,
    exchange: eventsExchange(envelope.producer),
    envelope,
  });
}

export type ClaimedEvent = {
  eventId: string;
  type: string;
  exchange: string;
  envelope: AnyEvent;
  attempts: number;
  leaseToken: string;
};

/**
 * Claims up to `limit` due events with a fresh lease token in one short
 * statement. Concurrent relays skip each other's rows; an expired lease
 * (crashed relay) becomes claimable again.
 */
export async function claimOutboxBatch(
  db: Executor,
  options: { limit: number; leaseMs: number },
): Promise<ClaimedEvent[]> {
  const leaseToken = randomUUID();
  const result = await db.execute<{
    event_id: string;
    type: string;
    exchange: string;
    envelope: AnyEvent;
    attempts: number;
  }>(sql`
    update outbox
       set lease_token = ${leaseToken},
           lease_until = now() + make_interval(secs => ${options.leaseMs / 1000}),
           attempts = attempts + 1
     where event_id in (
       select event_id from outbox
        where status = 'pending'
          and available_at <= now()
          and (lease_until is null or lease_until < now())
        order by created_at
        limit ${options.limit}
        for update skip locked
     )
    returning event_id, type, exchange, envelope, attempts`);
  return result.rows.map((row) => ({
    eventId: row.event_id,
    type: row.type,
    exchange: row.exchange,
    envelope: row.envelope,
    attempts: row.attempts,
    leaseToken,
  }));
}

/** Marks an event published only if this relay still holds the lease. */
export async function markOutboxPublished(
  db: Executor,
  eventId: string,
  leaseToken: string,
) {
  const rows = await db
    .update(outbox)
    .set({
      status: "published",
      publishedAt: new Date(),
      leaseToken: null,
      leaseUntil: null,
    })
    .where(and(eq(outbox.eventId, eventId), eq(outbox.leaseToken, leaseToken)))
    .returning({ eventId: outbox.eventId });
  return rows.length === 1;
}

/** Returns a claimed event to the queue after a bounded delay. */
export async function releaseOutboxEvent(
  db: Executor,
  eventId: string,
  leaseToken: string,
  options: { delayMs: number; error: string },
) {
  const rows = await db
    .update(outbox)
    .set({
      leaseToken: null,
      leaseUntil: null,
      availableAt: new Date(Date.now() + options.delayMs),
      lastError: options.error.slice(0, 1000),
    })
    .where(and(eq(outbox.eventId, eventId), eq(outbox.leaseToken, leaseToken)))
    .returning({ eventId: outbox.eventId });
  return rows.length === 1;
}

/** Deletes published rows older than the retention window. */
export async function purgePublishedOutbox(db: Executor, olderThan: Date) {
  const rows = await db
    .delete(outbox)
    .where(
      and(eq(outbox.status, "published"), lt(outbox.publishedAt, olderThan)),
    )
    .returning({ eventId: outbox.eventId });
  return rows.length;
}

/**
 * Unpublished events and the age of the oldest in seconds (0 when none),
 * from the partial pending index: cheap enough for every metrics scrape.
 */
export async function outboxBacklog(db: Executor) {
  const result = await db.execute<{ pending: number; oldest: number }>(sql`
    select count(*)::int as pending,
           coalesce(extract(epoch from now() - min(created_at)), 0)::float8 as oldest
      from outbox
     where status = 'pending'`);
  const [row] = result.rows;
  return { pending: row?.pending ?? 0, oldestSeconds: row?.oldest ?? 0 };
}
