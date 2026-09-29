import { Inject, Injectable } from "@nestjs/common";
import {
  CLOCK,
  type Clock,
  type Counter,
  DATABASE,
  type Gauge,
  Metrics,
} from "@outegro/nest-common";
import { and, count, eq, inArray, isNotNull, min } from "drizzle-orm";
import { checkoutAttempts, orders, providerEvents } from "../db/schema.js";
import { eventTypeLabel } from "../lava/webhook-events.js";
import type { GrantRow, PaymentsDatabase } from "./database.js";

/** What a webhook came to at the door; applying it is counted apart. */
export type WebhookOutcome =
  | "accepted"
  | "rejected_auth"
  | "rejected_schema"
  | "duplicate"
  | "error";

/** Stored provider events not applied yet (the provider inbox). */
const UNPROCESSED = ["received", "unmatched", "failed"] as const;
/** Attempts reconciliation still watches while their order is pending. */
const PENDING = ["requesting", "ready", "unknown"] as const;

const ageSeconds = (now: Date, since: Date | null | undefined) =>
  since ? Math.max(0, now.getTime() - since.getTime()) / 1000 : 0;

/**
 * Payments metrics (OPS-04). No money amounts: sums across currencies mean
 * nothing, and the ledger is the place for amounts.
 */
@Injectable()
export class PaymentsMetrics {
  private readonly webhooks: Counter<"type" | "outcome">;
  private readonly grants: Counter<"source">;
  private readonly reconciled: Gauge;

  constructor(
    metrics: Metrics,
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.webhooks = metrics.counter({
      name: "payments_webhooks_total",
      help: "Lava webhooks by event type (known types, else other) and outcome: accepted (stored), rejected_auth, rejected_schema, duplicate, error.",
      labelNames: ["type", "outcome"],
    });
    this.grants = metrics.counter({
      name: "payments_grants_activated_total",
      help: "Grants that became active, new or after their expiry, by source.",
      labelNames: ["source"],
    });
    this.reconciled = metrics.gauge({
      name: "payments_reconciliation_last_success_timestamp_seconds",
      help: "When the last reconciliation pass finished (Unix time); 0 before the first.",
    });
    this.readInbox(metrics);
    this.readCheckouts(metrics);
  }

  /** `payload` gives the event type label; it is never trusted beyond that. */
  webhook(payload: unknown, outcome: WebhookOutcome) {
    this.webhooks.inc({ type: eventTypeLabel(payload), outcome });
  }

  grantActivated(source: GrantRow["sourceType"]) {
    this.grants.inc({ source });
  }

  reconciliationFinished() {
    this.reconciled.set(this.clock.now().getTime() / 1000);
  }

  private readInbox(metrics: Metrics) {
    const waiting = metrics.gauge({
      name: "payments_provider_events_unprocessed",
      help: "Stored provider events not applied yet, by status (received, unmatched, failed).",
      labelNames: ["status"],
    });
    const oldest = metrics.gauge({
      name: "payments_provider_event_oldest_unprocessed_age_seconds",
      help: "Age of the oldest provider event not applied yet, by status; 0 when none.",
      labelNames: ["status"],
    });
    metrics.readOnScrape("provider_events", [waiting, oldest], async () => {
      const rows = await this.database.db
        .select({
          status: providerEvents.status,
          waiting: count(),
          oldest: min(providerEvents.receivedAt),
        })
        .from(providerEvents)
        .where(inArray(providerEvents.status, [...UNPROCESSED]))
        .groupBy(providerEvents.status);
      const now = this.clock.now();
      for (const status of UNPROCESSED) {
        const row = rows.find((r) => r.status === status);
        waiting.set({ status }, row?.waiting ?? 0);
        oldest.set({ status }, ageSeconds(now, row?.oldest));
      }
    });
  }

  private readCheckouts(metrics: Metrics) {
    const pending = metrics.gauge({
      name: "payments_checkouts_pending",
      help: "Checkouts whose order is still pending, by attempt state (requesting, ready, unknown).",
      labelNames: ["state"],
    });
    const oldest = metrics.gauge({
      name: "payments_checkout_oldest_pending_age_seconds",
      help: "Age of the oldest pending checkout by attempt state; 0 when none.",
      labelNames: ["state"],
    });
    metrics.readOnScrape("checkouts", [pending, oldest], async () => {
      const rows = await this.database.db
        .select({
          state: checkoutAttempts.state,
          pending: count(),
          oldest: min(checkoutAttempts.requestedAt),
        })
        .from(checkoutAttempts)
        .innerJoin(orders, eq(orders.id, checkoutAttempts.orderId))
        .where(
          and(
            isNotNull(checkoutAttempts.nextCheckAt),
            eq(orders.status, "pending"),
          ),
        )
        .groupBy(checkoutAttempts.state);
      const now = this.clock.now();
      for (const state of PENDING) {
        const row = rows.find((r) => r.state === state);
        pending.set({ state }, row?.pending ?? 0);
        oldest.set({ state }, ageSeconds(now, row?.oldest));
      }
    });
  }
}
