import { auditLog } from "../db/schema.js";
import type { Executor } from "./database.js";

export type Actor = { userId: string; requestId?: string | null };

/** Writes an audit row; call inside the transaction of the change it explains. */
export async function audit(
  tx: Executor,
  entry: {
    actor: Actor;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    data?: Record<string, unknown>;
    at: Date;
  },
) {
  await tx.insert(auditLog).values({
    actorId: entry.actor.userId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason,
    data: entry.data ?? {},
    requestId: entry.actor.requestId ?? null,
    createdAt: entry.at,
  });
}
