import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { inbox } from "./schema.js";

export type Transaction = Parameters<
  Parameters<NodePgDatabase<Record<string, unknown>>["transaction"]>[0]
>[0];

/**
 * Applies a consumer's local effect exactly once per (consumer, eventId):
 * the inbox marker and the effect commit together, so a redelivered event
 * after a crash is acknowledged without repeating the effect (INV-14).
 * External side effects (email, HTTP) must not run inside `effect`.
 */
export async function processOnce(
  db: NodePgDatabase<Record<string, unknown>>,
  message: { consumer: string; eventId: string; type: string },
  effect: (tx: Transaction) => Promise<void>,
): Promise<"processed" | "duplicate"> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(inbox)
      .values(message)
      .onConflictDoNothing()
      .returning({ eventId: inbox.eventId });
    if (inserted.length === 0) return "duplicate";
    await effect(tx);
    return "processed";
  });
}
