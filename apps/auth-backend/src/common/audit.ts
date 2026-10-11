import { auditLog } from "../db/schema.js";
import type { AuthTx } from "./database.js";

/**
 * Writes an audit row; call inside the transaction of the change it explains.
 * `requestId` is the id of the HTTP request behind the change, the one its
 * log lines carry (AuditEvent, chapter 7.8). It is required, so no call site
 * forgets it; null only outside a request (the owner CLI).
 */
export async function audit(
  tx: AuthTx,
  entry: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    reason?: string | null;
    data?: Record<string, unknown>;
    requestId: string | null;
    at: Date;
  },
) {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason ?? null,
    data: entry.data ?? {},
    requestId: entry.requestId,
    createdAt: entry.at,
  });
}
