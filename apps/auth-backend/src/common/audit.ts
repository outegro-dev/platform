import { auditLog } from "../db/schema.js";
import type { AuthTx } from "./database.js";

export async function audit(
  tx: AuthTx,
  entry: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    reason?: string | null;
    data?: Record<string, unknown>;
    requestId?: string | null;
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
    requestId: entry.requestId ?? null,
    createdAt: entry.at,
  });
}
