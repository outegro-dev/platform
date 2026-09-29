import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
} from "@outegro/nest-common";
import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  describeError,
  type Executor,
  type PaymentsDatabase,
} from "../common/database.js";
import { PaymentsMetrics } from "../common/metrics.js";
import { providerEvents } from "../db/schema.js";
import { type Fact, factSchema, type PaymentFact } from "../domain/facts.js";
import { normalizeLavaEvent, payloadHash } from "../lava/webhook-events.js";
import { CancellationService } from "./cancellation.js";
import { IssueRegistry } from "./issues.js";
import type { Outcome } from "./outcome.js";
import { RefundService } from "./refunds.js";
import { SettlementService } from "./settlement.js";

const PROVIDER = "lava";
const RETRYABLE = ["received", "unmatched", "failed"] as const;
/** Re-matching an unmatched event: 1 min, 5 min, 15 min, 1 h, 6 h, 24 h. */
const UNMATCHED_DELAYS_MS = [
  60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000,
];
/** After a processing error: 30 s, 2 min, 10 min, 1 h, 6 h. */
const FAILED_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
/** An operator hears about an unmatched event after this many tries. */
const ISSUE_AFTER_ATTEMPTS = 3;

/**
 * Provider event inbox (PAY-04): authenticated payloads are stored first
 * (unique semantic key), then applied in their own transaction. A failure
 * after the durable write leaves the event for the worker; the caller
 * still got its 2xx because nothing was lost (INV-18).
 */
@Injectable()
export class ProviderEvents {
  private readonly logger = new Logger("ProviderEvents");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settlement: SettlementService,
    private readonly cancellation: CancellationService,
    private readonly refunds: RefundService,
    private readonly issues: IssueRegistry,
    private readonly relay: OutboxRelay,
    private readonly metrics: PaymentsMetrics,
  ) {}

  /** Webhook entry point: durable write, then processing. */
  async receiveWebhook(payload: unknown) {
    const now = this.clock.now();
    const event = normalizeLavaEvent(payload);
    const received = event.status === "received";
    const row = await this.database.db
      .insert(providerEvents)
      .values({
        provider: PROVIDER,
        source: "webhook",
        eventKey: event.key,
        type: event.type,
        rawType: event.rawType,
        status: event.status,
        note: received ? null : event.note,
        payload: (payload ?? {}) as object,
        payloadHash: event.hash,
        fact: received ? event.fact : null,
        contractId: event.contractId,
        parentContractId: received ? event.parentContractId : null,
        nextAttemptAt: received ? now : null,
        receivedAt: now,
      })
      .onConflictDoNothing({
        target: [providerEvents.provider, providerEvents.eventKey],
      })
      .returning({ id: providerEvents.id, status: providerEvents.status })
      .then(
        (rows) => rows[0],
        (error: unknown) => {
          // The failed query carries the raw payload (buyer email): the log
          // gets the driver error only, Lava a retryable 5xx (INV-18).
          this.logger.error(
            { type: event.rawType, err: describeError(error) },
            "Provider event could not be stored",
          );
          this.metrics.webhook(payload, "error");
          throw new AppError("DEPENDENCY_UNAVAILABLE");
        },
      );
    if (!row) {
      this.metrics.webhook(payload, "duplicate");
      return { status: "duplicate" as const };
    }
    // Unknown types are stored for review: accepted, as Lava sees it.
    this.metrics.webhook(
      payload,
      event.status === "invalid" ? "rejected_schema" : "accepted",
    );
    if (!received) {
      this.logger.warn(
        {
          eventId: row.id,
          type: event.rawType,
          status: event.status,
          note: event.note,
        },
        "Provider event stored without effect",
      );
      return { status: row.status };
    }
    return { status: await this.process(row.id) };
  }

  /**
   * A fact found by reconciliation, stored like a webhook so it is visible
   * in the order timeline. Returns null when the same fact is already known.
   */
  async recordFact(fact: PaymentFact, key: string, payload: object) {
    const now = this.clock.now();
    const [row] = await this.database.db
      .insert(providerEvents)
      .values({
        provider: PROVIDER,
        source: "reconciliation",
        eventKey: key,
        type: fact.outcome === "success" ? "payment.success" : "payment.failed",
        rawType: null,
        status: "received",
        payload,
        payloadHash: payloadHash(payload),
        fact,
        contractId: fact.contractId,
        parentContractId: fact.parentContractId,
        nextAttemptAt: now,
        receivedAt: now,
      })
      .onConflictDoNothing({
        target: [providerEvents.provider, providerEvents.eventKey],
      })
      .returning({ id: providerEvents.id });
    return row?.id ?? null;
  }

  /** Applies one stored event; safe to call concurrently and repeatedly. */
  async process(eventId: string): Promise<string> {
    try {
      const status = await this.database.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(providerEvents)
          .where(eq(providerEvents.id, eventId))
          .for("update");
        if (!row) return "missing";
        if (!(RETRYABLE as readonly string[]).includes(row.status))
          return row.status;
        const now = this.clock.now();
        const fact = factSchema.parse(row.fact);
        const outcome = await this.route(tx, fact, row.id);
        const attempts = row.attempts + 1;
        const unmatched = outcome.status === "unmatched";
        // A missing checkout or subscription mapping may still appear; an
        // unmatched refund or chargeback waits in its case for an operator.
        const retry =
          unmatched &&
          (fact.kind === "payment" || fact.kind === "cancellation");
        const delay = retry ? UNMATCHED_DELAYS_MS[attempts - 1] : undefined;
        await tx
          .update(providerEvents)
          .set({
            status: outcome.status,
            note: outcome.note ?? null,
            orderId: outcome.orderId ?? row.orderId,
            subscriptionId: outcome.subscriptionId ?? row.subscriptionId,
            paymentId: outcome.paymentId ?? row.paymentId,
            refundId: outcome.refundId ?? row.refundId,
            attempts,
            lastError: null,
            nextAttemptAt:
              delay === undefined ? null : new Date(now.getTime() + delay),
            processedAt: unmatched ? null : now,
          })
          .where(eq(providerEvents.id, row.id));
        if (retry && attempts === ISSUE_AFTER_ATTEMPTS) {
          await this.issues.open(
            tx,
            {
              kind: "unmatched_event",
              severity: "medium",
              subjectKey: `event:${row.id}`,
              related: { eventId: row.id },
              evidence: {
                type: row.type,
                contractId: row.contractId,
                note: outcome.note,
              },
            },
            now,
          );
        }
        if (!unmatched && row.attempts > 0) {
          // It matched on a retry: the operator no longer needs to act.
          await this.issues.resolve(
            tx,
            `event:${row.id}`,
            { actorId: null, resolution: "matched on retry" },
            now,
          );
          if (fact.kind === "payment" && fact.recurring)
            await this.issues.resolve(
              tx,
              `contract:${fact.contractId}`,
              { actorId: null, resolution: "parent subscription appeared" },
              now,
              "renewal_without_parent",
            );
        }
        return outcome.status;
      });
      this.relay.kick();
      return status;
    } catch (error) {
      await this.failed(eventId, error);
      return "failed";
    }
  }

  /** After a checkout (or recovery) stored its invoice id: early webhooks apply now. */
  async rematch(contractId: string) {
    const rows = await this.database.db
      .select({ id: providerEvents.id })
      .from(providerEvents)
      .where(
        and(
          eq(providerEvents.provider, PROVIDER),
          eq(providerEvents.contractId, contractId),
          eq(providerEvents.status, "unmatched"),
        ),
      )
      .orderBy(asc(providerEvents.receivedAt));
    for (const row of rows) await this.process(row.id);
    return rows.length;
  }

  /** Worker: events whose processing is due again. */
  async retryDue(limit = 50) {
    const now = this.clock.now();
    const rows = await this.database.db
      .select({ id: providerEvents.id })
      .from(providerEvents)
      .where(
        and(
          inArray(providerEvents.status, [...RETRYABLE]),
          isNotNull(providerEvents.nextAttemptAt),
          lte(providerEvents.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(providerEvents.nextAttemptAt))
      .limit(limit);
    for (const row of rows) await this.process(row.id);
    return rows.length;
  }

  private route(tx: Executor, fact: Fact, eventId: string): Promise<Outcome> {
    switch (fact.kind) {
      case "payment":
        return this.settlement.apply(tx, fact);
      case "cancellation":
        return this.cancellation.applyProviderCancellation(tx, fact);
      case "refund":
        return this.refunds.applyRefund(tx, fact, eventId);
      case "chargeback":
        return this.refunds.applyChargeback(tx, fact, eventId);
    }
  }

  private async failed(eventId: string, cause: unknown) {
    const now = this.clock.now();
    // Never the query text: its parameters can hold the buyer email.
    const reason = describeError(cause);
    this.logger.error(
      { eventId, err: reason },
      "Provider event processing failed",
    );
    try {
      await this.database.db.transaction(async (tx) => {
        const [row] = await tx
          .update(providerEvents)
          .set({
            status: "failed",
            attempts: sql`${providerEvents.attempts} + 1`,
            lastError: reason.slice(0, 500),
          })
          .where(
            and(
              eq(providerEvents.id, eventId),
              inArray(providerEvents.status, [...RETRYABLE]),
            ),
          )
          .returning({
            attempts: providerEvents.attempts,
            type: providerEvents.type,
          });
        if (!row) return;
        const delay = FAILED_DELAYS_MS[row.attempts - 1];
        await tx
          .update(providerEvents)
          .set({
            nextAttemptAt:
              delay === undefined ? null : new Date(now.getTime() + delay),
          })
          .where(eq(providerEvents.id, eventId));
        if (delay === undefined) {
          await this.issues.open(
            tx,
            {
              kind: "event_failed",
              severity: "high",
              subjectKey: `event:${eventId}`,
              related: { eventId },
              evidence: { type: row.type, error: reason.slice(0, 200) },
            },
            now,
          );
        }
      });
    } catch (secondary) {
      // The database itself is down; the row stays retryable as it was.
      this.logger.error(
        { eventId, err: describeError(secondary) },
        "Could not record the processing failure",
      );
    }
  }
}
