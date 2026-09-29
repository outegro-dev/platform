import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { CLOCK, type Clock, DATABASE, OutboxRelay } from "@outegro/nest-common";
import { and, eq, isNotNull, lte, ne, sql } from "drizzle-orm";
import { GrantLedger } from "../billing/grants.js";
import { subscriptionChanged } from "../billing/outbox-events.js";
import type { PaymentsDatabase } from "../common/database.js";
import { workersConfig } from "../config/config.js";
import { grants, subscriptions } from "../db/schema.js";
import { accessUntil, subscriptionLifecycle } from "../domain/lifecycle.js";
import { PeriodicWorker } from "./periodic-worker.js";

const BATCH = 100;

/**
 * Time-based transitions. Access checks never depend on this worker
 * (validUntil is part of every grant, INV-12); it moves states and tells
 * consumers: active → past_due at paidUntil without renewal, anything →
 * expired at paidUntil + grace, and ends grants past their validUntil.
 */
@Injectable()
export class ExpiryWorker extends PeriodicWorker {
  protected readonly logger = new Logger("Expiry");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly grants: GrantLedger,
    private readonly relay: OutboxRelay,
    @Inject(workersConfig.KEY) config: ConfigType<typeof workersConfig>,
  ) {
    super(config.autoStart, config.expiryIntervalMs);
  }

  protected async runOnce() {
    const now = this.clock.now();
    const at = now.toISOString();
    let handled = 0;
    const lapsed = await this.database.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.state, "active"),
          eq(subscriptions.autoRenew, true),
          lte(subscriptions.paidUntil, now),
        ),
      )
      .limit(BATCH);
    for (const { id } of lapsed) handled += await this.periodEnded(id, now);
    const ended = await this.database.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          ne(subscriptions.state, "expired"),
          sql`${subscriptions.paidUntil} + make_interval(days => ${subscriptions.graceDays}) <= ${at}::timestamptz`,
        ),
      )
      .limit(BATCH);
    for (const { id } of ended) handled += await this.accessEnded(id, now);
    const due = await this.database.db
      .select({ id: grants.id })
      .from(grants)
      .where(
        and(
          eq(grants.state, "active"),
          isNotNull(grants.validUntil),
          lte(grants.validUntil, now),
        ),
      )
      .limit(BATCH);
    for (const { id } of due) handled += await this.grantEnded(id, now);
    if (handled) this.relay.kick();
    return handled;
  }

  private periodEnded(subscriptionId: string, now: Date) {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId))
        .for("update");
      if (!row || row.paidUntil > now) return 0;
      const next = subscriptionLifecycle.periodEnded(row.state, row.autoRenew);
      if (!next) return 0;
      const [updated] = await tx
        .update(subscriptions)
        .set({
          state: next,
          updatedAt: now,
          version: sql`${subscriptions.version} + 1`,
        })
        .where(eq(subscriptions.id, row.id))
        .returning();
      if (updated) await subscriptionChanged(tx, updated, now);
      return 1;
    });
  }

  private accessEnded(subscriptionId: string, now: Date) {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId))
        .for("update");
      if (!row || accessUntil(row.paidUntil, row.graceDays) > now) return 0;
      const next = subscriptionLifecycle.accessEnded(row.state);
      if (!next) return 0;
      const [updated] = await tx
        .update(subscriptions)
        .set({
          // A pending cancel call stays scheduled: Lava may still renew.
          state: next,
          expiredAt: now,
          updatedAt: now,
          version: sql`${subscriptions.version} + 1`,
        })
        .where(eq(subscriptions.id, row.id))
        .returning();
      if (updated) await subscriptionChanged(tx, updated, now);
      const grant = await this.grants.lockSource(tx, {
        sourceType: "subscription",
        sourceId: row.id,
        service: row.service,
        feature: row.feature,
      });
      if (grant) await this.grants.expire(tx, grant, now);
      return 1;
    });
  }

  private grantEnded(grantId: string, now: Date) {
    return this.database.db.transaction(async (tx) => {
      const grant = await this.grants.lockById(tx, grantId);
      if (
        grant?.state !== "active" ||
        !grant.validUntil ||
        grant.validUntil > now
      )
        return 0;
      await this.grants.expire(tx, grant, now);
      return 1;
    });
  }
}
