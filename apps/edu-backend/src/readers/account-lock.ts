import type { userStatusSchema } from "@outegro/contracts";
import { eq, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { EduTx } from "../common/database.js";
import { users } from "../db/schema.js";

export type AccountStatus = z.infer<typeof userStatusSchema>;

/*
 * A reader's writes against Identity's changes to the account. The status a
 * request was checked with at its start (ViewerService) can be stale by the
 * time it writes: an assistant answer streams for up to 90 seconds. So a
 * write of the reader's own data reads the status again in its transaction,
 * under the reader's lock taken shared, and writes nothing unless the
 * account is active; the Identity consumer takes the same lock exclusively
 * while it changes the status and purges a deleted account. A write that
 * holds the lock first commits before the purge starts and is purged with
 * the rest; a write that comes later finds the account deleted.
 */

const lockKey = (userId: string): SQL =>
  sql`hashtext('edu.reader.' || ${userId}::text)`;

/**
 * The account's status in the Identity projection (active when Identity
 * never changed it), fixed until the transaction ends: a change of it waits
 * for this transaction.
 */
export async function lockedAccountStatus(
  tx: EduTx,
  userId: string,
): Promise<AccountStatus> {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(${lockKey(userId)})`,
  );
  const [account] = await tx
    .select({ status: users.status })
    .from(users)
    .where(eq(users.userId, userId));
  return account?.status ?? "active";
}

/** Whether the reader may write now: an active account, fixed until the transaction ends. */
export async function mayWrite(tx: EduTx, userId: string): Promise<boolean> {
  return (await lockedAccountStatus(tx, userId)) === "active";
}

/**
 * For a change to the account (Identity's events): waits for the reader's
 * writes in flight, and holds new ones off until the transaction ends.
 */
export async function lockAccountForChange(
  tx: EduTx,
  userId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(userId)})`);
}
