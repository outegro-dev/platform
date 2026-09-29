import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { Executor, GrantRow } from "../common/database.js";
import { grants } from "../db/schema.js";
import { grantChanged } from "./outbox-events.js";

export type GrantSource = {
  userId: string;
  service: string;
  feature: string;
  sourceType: GrantRow["sourceType"];
  sourceId: string;
};

const sameInstant = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Commercial grants: one row per source and feature. Every change bumps
 * `version` and publishes billing.grant.changed with it, so consumers can
 * drop stale events (INV-11). Call inside the caller's transaction.
 */
@Injectable()
export class GrantLedger {
  /**
   * Makes the source's grant active until `validUntil` (null = perpetual).
   * Repeating the same values changes nothing and publishes nothing; a
   * revoked grant is never revived by a payment.
   */
  async activate(
    tx: Executor,
    source: GrantSource,
    window: { validFrom: Date; validUntil: Date | null },
    at: Date,
    correlationId?: string,
    extra: { reason?: string; grantedBy?: string } = {},
  ): Promise<GrantRow> {
    const [created] = await tx
      .insert(grants)
      .values({
        ...source,
        state: "active",
        validFrom: window.validFrom,
        validUntil: window.validUntil,
        reason: extra.reason ?? null,
        grantedBy: extra.grantedBy ?? null,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing({
        target: [
          grants.sourceType,
          grants.sourceId,
          grants.service,
          grants.feature,
        ],
      })
      .returning();
    if (created) {
      await grantChanged(tx, created, at, correlationId);
      return created;
    }
    const current = await this.lockSource(tx, source);
    if (!current) throw new Error("grant disappeared during upsert");
    if (current.state === "revoked") return current;
    if (
      current.state === "active" &&
      sameInstant(current.validUntil, window.validUntil)
    )
      return current;
    return this.change(
      tx,
      current,
      { state: "active", validUntil: window.validUntil },
      at,
      correlationId,
    );
  }

  /** Ends a grant for good (refund, operator). */
  async revoke(
    tx: Executor,
    grant: GrantRow,
    input: { actorId: string | null; reason: string },
    at: Date,
    correlationId?: string,
  ) {
    if (grant.state === "revoked") return grant;
    return this.change(
      tx,
      grant,
      {
        state: "revoked",
        revokedAt: at,
        revokedBy: input.actorId,
        revokeReason: input.reason,
      },
      at,
      correlationId,
    );
  }

  /** The paid interval is over; a later payment may activate it again. */
  async expire(
    tx: Executor,
    grant: GrantRow,
    at: Date,
    correlationId?: string,
  ) {
    if (grant.state !== "active") return grant;
    return this.change(tx, grant, { state: "expired" }, at, correlationId);
  }

  /** Moves the end of an active or expired grant (refund of a period). */
  async reshape(
    tx: Executor,
    grant: GrantRow,
    window: { validUntil: Date | null; state: "active" | "expired" },
    at: Date,
    correlationId?: string,
  ) {
    if (grant.state === "revoked") return grant;
    if (
      grant.state === window.state &&
      sameInstant(grant.validUntil, window.validUntil)
    )
      return grant;
    return this.change(tx, grant, window, at, correlationId);
  }

  lockSource(tx: Executor, source: Omit<GrantSource, "userId">) {
    return tx
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.sourceType, source.sourceType),
          eq(grants.sourceId, source.sourceId),
          eq(grants.service, source.service),
          eq(grants.feature, source.feature),
        ),
      )
      .for("update")
      .then((rows) => rows[0] ?? null);
  }

  lockById(tx: Executor, grantId: string) {
    return tx
      .select()
      .from(grants)
      .where(eq(grants.id, grantId))
      .for("update")
      .then((rows) => rows[0] ?? null);
  }

  private async change(
    tx: Executor,
    grant: GrantRow,
    set: Partial<
      Pick<
        GrantRow,
        "state" | "validUntil" | "revokedAt" | "revokedBy" | "revokeReason"
      >
    >,
    at: Date,
    correlationId?: string,
  ) {
    const [updated] = await tx
      .update(grants)
      .set({ ...set, version: sql`${grants.version} + 1`, updatedAt: at })
      .where(eq(grants.id, grant.id))
      .returning();
    if (!updated) throw new Error("grant disappeared during update");
    await grantChanged(tx, updated, at, correlationId);
    return updated;
  }
}
