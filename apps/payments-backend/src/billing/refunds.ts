import { Inject, Injectable } from "@nestjs/common";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
} from "@outegro/nest-common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type Actor, audit } from "../common/audit.js";
import type {
  Executor,
  PaymentRow,
  PaymentsDatabase,
  RefundRow,
} from "../common/database.js";
import {
  billingPeriods,
  checkoutAttempts,
  financialEntries,
  orders,
  payments,
  providerEvents,
  refunds,
  subscriptions,
} from "../db/schema.js";
import type { ChargebackFact, RefundFact } from "../domain/facts.js";
import { toMinor } from "../domain/money.js";
import { GrantLedger } from "./grants.js";
import { IssueRegistry } from "./issues.js";
import { subscriptionChanged } from "./outbox-events.js";
import type { Outcome } from "./outcome.js";

const PROVIDER = "lava";

type Candidate = { payment: PaymentRow; caseId: string | null };

/**
 * Refunds and chargebacks (chapter 6.9). Lava's refund payload names no
 * purchase, so nothing is guessed from email and amount (INV-19). A refund
 * takes effect only on a verified link: an exact contract id, exactly one
 * operator "refund requested" case for the same offer, buyer and amount, or
 * a manual match with a reason. Refund is never a cancel, and vice versa.
 */
@Injectable()
export class RefundService {
  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly grants: GrantLedger,
    private readonly issues: IssueRegistry,
    private readonly relay: OutboxRelay,
  ) {}

  async applyRefund(
    tx: Executor,
    fact: RefundFact,
    eventId: string,
  ): Promise<Outcome> {
    const now = this.clock.now();
    const [known] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.provider, PROVIDER),
          eq(refunds.kind, "refund"),
          eq(refunds.providerRef, fact.refundId),
        ),
      );
    if (known)
      return {
        status: "ignored",
        note: "refund already recorded",
        refundId: known.id,
      };
    const amountMinor = toMinor(fact.amount, fact.currency);
    const recorded = {
      providerRef: fact.refundId,
      currency: fact.currency,
      amountMinor,
      refundType: fact.refundType,
      providerEventId: eventId,
      updatedAt: now,
    };

    const match = await this.verifiedPayment(tx, fact, amountMinor);
    if (!match) {
      const candidates = await this.lookalikes(tx, fact);
      const [row] = await tx
        .insert(refunds)
        .values({
          kind: "refund",
          provider: PROVIDER,
          ...recorded,
          state: "unmatched",
          evidence: {
            offerId: fact.offerId,
            candidatePaymentIds: candidates,
            subscriptionCancelled: fact.subscriptionCancelled,
          },
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error("refund insert returned nothing");
      await this.issues.open(
        tx,
        {
          kind: "refund_unmatched",
          severity: "high",
          subjectKey: `refund:${row.id}`,
          related: { refundId: row.id },
          evidence: { candidatePaymentIds: candidates },
        },
        now,
      );
      return {
        status: "unmatched",
        note:
          candidates.length > 1
            ? "several purchases look alike; none chosen"
            : "no verified purchase",
        refundId: row.id,
      };
    }

    let caseRow: RefundRow | undefined;
    if (match.caseId) {
      [caseRow] = await tx
        .update(refunds)
        .set({ ...recorded, version: sql`${refunds.version} + 1` })
        .where(eq(refunds.id, match.caseId))
        .returning();
    } else {
      [caseRow] = await tx
        .insert(refunds)
        .values({
          kind: "refund",
          provider: PROVIDER,
          ...recorded,
          paymentId: match.payment.id,
          userId: match.payment.userId,
          state: "recorded",
          evidence: { offerId: fact.offerId, matchedBy: "contract" },
          createdAt: now,
        })
        .returning();
    }
    if (!caseRow) throw new Error("refund case missing");
    return this.applyToPayment(tx, caseRow, match.payment, {
      subscriptionCancelled: fact.subscriptionCancelled,
      now,
    });
  }

  async applyChargeback(
    tx: Executor,
    fact: ChargebackFact,
    eventId: string,
  ): Promise<Outcome> {
    const now = this.clock.now();
    const [known] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.provider, PROVIDER),
          eq(refunds.kind, "chargeback"),
          eq(refunds.providerRef, fact.chargebackId),
        ),
      );
    if (known)
      return {
        status: "ignored",
        note: "chargeback already recorded",
        refundId: known.id,
      };
    const payment = fact.contractId
      ? await this.lockPaymentByContract(tx, fact.contractId)
      : null;
    const [row] = await tx
      .insert(refunds)
      .values({
        kind: "chargeback",
        provider: PROVIDER,
        providerRef: fact.chargebackId,
        paymentId: payment?.id ?? null,
        userId: payment?.userId ?? null,
        currency: fact.currency,
        amountMinor: toMinor(fact.amount, fact.currency),
        state: "open",
        reason: fact.reasonCategory,
        evidence: {
          offerId: fact.offerId,
          candidatePaymentIds: payment ? [] : await this.lookalikes(tx, fact),
        },
        providerEventId: eventId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("chargeback insert returned nothing");
    // A dispute is a risk state, not an outcome: grants stay as they are.
    if (payment?.state === "confirmed") {
      await tx
        .update(payments)
        .set({ state: "disputed", updatedAt: now })
        .where(eq(payments.id, payment.id));
    }
    await this.issues.open(
      tx,
      {
        kind: "chargeback_opened",
        severity: "high",
        subjectKey: `chargeback:${row.id}`,
        related: { refundId: row.id, paymentId: payment?.id ?? null },
        evidence: { reasonCategory: fact.reasonCategory },
      },
      now,
    );
    return {
      status: payment ? "processed" : "unmatched",
      note: payment
        ? "chargeback opened"
        : "chargeback without verified purchase",
      refundId: row.id,
      paymentId: payment?.id ?? null,
    };
  }

  /** Operator marks that a refund was started in the Lava cabinet (no refund API). */
  async request(actor: Actor, paymentId: string, reason: string) {
    const now = this.clock.now();
    return this.database.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for("update");
      if (!payment) throw new AppError("NOT_FOUND");
      if (payment.state !== "confirmed")
        throw new AppError("UNPROCESSABLE", {
          fieldErrors: { paymentId: [`payment is ${payment.state}`] },
        });
      const [open] = await tx
        .select()
        .from(refunds)
        .where(
          and(
            eq(refunds.paymentId, payment.id),
            eq(refunds.kind, "refund"),
            eq(refunds.state, "requested"),
          ),
        );
      if (open) return open;
      const [row] = await tx
        .insert(refunds)
        .values({
          kind: "refund",
          provider: PROVIDER,
          paymentId: payment.id,
          userId: payment.userId,
          currency: payment.currency,
          amountMinor: payment.amountMinor,
          refundType: "full",
          state: "requested",
          reason,
          requestedBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("refund insert returned nothing");
      await audit(tx, {
        actor,
        action: "refund.requested",
        targetType: "payment",
        targetId: payment.id,
        reason,
        data: { refundId: row.id },
        at: now,
      });
      return row;
    });
  }

  /** Operator links an unmatched provider refund to the purchase it belongs to. */
  async match(
    actor: Actor,
    refundId: string,
    paymentId: string,
    reason: string,
  ) {
    const now = this.clock.now();
    const result = await this.database.db.transaction(async (tx) => {
      const [caseRow] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.id, refundId))
        .for("update");
      if (caseRow?.kind !== "refund") throw new AppError("NOT_FOUND");
      if (caseRow.state !== "unmatched")
        throw new AppError("UNPROCESSABLE", {
          fieldErrors: { refundId: [`refund is ${caseRow.state}`] },
        });
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for("update");
      if (!payment) throw new AppError("NOT_FOUND");
      if (payment.currency !== caseRow.currency)
        throw new AppError("UNPROCESSABLE", {
          fieldErrors: { paymentId: ["currency differs from the refund"] },
        });
      await audit(tx, {
        actor,
        action: "refund.matched",
        targetType: "refund",
        targetId: caseRow.id,
        reason,
        data: { paymentId },
        at: now,
      });
      const [linked] = await tx
        .update(refunds)
        .set({
          paymentId: payment.id,
          userId: payment.userId,
          updatedAt: now,
          version: sql`${refunds.version} + 1`,
        })
        .where(eq(refunds.id, caseRow.id))
        .returning();
      if (!linked) throw new Error("refund disappeared");
      const evidence = caseRow.evidence as { subscriptionCancelled?: boolean };
      const outcome = await this.applyToPayment(tx, linked, payment, {
        subscriptionCancelled: evidence.subscriptionCancelled ?? false,
        now,
      });
      await this.issues.resolve(
        tx,
        `refund:${caseRow.id}`,
        { actorId: actor.userId, resolution: reason },
        now,
      );
      if (caseRow.providerEventId) {
        await tx
          .update(providerEvents)
          .set({
            status: "processed",
            note: `matched by operator: ${outcome.note ?? "applied"}`,
            paymentId: payment.id,
            orderId: payment.orderId,
            processedAt: now,
          })
          .where(eq(providerEvents.id, caseRow.providerEventId));
      }
      const [final] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.id, caseRow.id));
      return { refund: final ?? linked, outcome };
    });
    this.relay.kick();
    return result;
  }

  /**
   * Full refund of a verified payment: journal entry, payment and order
   * refunded, only this purchase's grant revoked. A refunded period does
   * not erase other periods. Partial refunds wait for an operator.
   */
  private async applyToPayment(
    tx: Executor,
    caseRow: RefundRow,
    payment: PaymentRow,
    input: { subscriptionCancelled: boolean; now: Date },
  ): Promise<Outcome> {
    const { now } = input;
    const ids = {
      refundId: caseRow.id,
      paymentId: payment.id,
      orderId: payment.orderId,
    };
    const amount = caseRow.amountMinor ?? 0n;
    const review = async (why: string) => {
      await tx
        .update(refunds)
        .set({ state: "review_required", updatedAt: now })
        .where(eq(refunds.id, caseRow.id));
      await this.issues.open(
        tx,
        {
          kind: "refund_review",
          severity: "medium",
          subjectKey: `refund:${caseRow.id}`,
          related: ids,
          evidence: { why },
        },
        now,
      );
      return { status: "processed" as const, note: why, ...ids };
    };
    if (payment.state === "refunded") return review("payment already refunded");
    if (caseRow.currency !== payment.currency)
      return review("currency differs");
    if (caseRow.refundType === "partial" || amount < payment.amountMinor)
      return review("partial refund needs an item decision");
    if (amount > payment.amountMinor)
      return review("refund exceeds the payment");

    await tx
      .update(payments)
      .set({ state: "refunded", updatedAt: now })
      .where(eq(payments.id, payment.id));
    await tx
      .update(refunds)
      .set({ state: "recorded", updatedAt: now })
      .where(eq(refunds.id, caseRow.id));
    await tx.insert(financialEntries).values({
      type: "refund",
      sourceRef: `refund:${caseRow.id}`,
      paymentId: payment.id,
      refundId: caseRow.id,
      userId: payment.userId,
      currency: payment.currency,
      amountMinor: -amount,
      occurredAt: now,
      createdAt: now,
    });

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, payment.orderId))
      .for("update");
    if (!order) throw new Error("payment without order");
    if (payment.kind === "purchase") {
      await tx
        .update(orders)
        .set({
          status: "refunded",
          updatedAt: now,
          version: sql`${orders.version} + 1`,
        })
        .where(eq(orders.id, order.id));
      const grant = await this.grants.lockSource(tx, {
        sourceType: "purchase",
        sourceId: order.id,
        service: order.service,
        feature: order.feature,
      });
      if (grant)
        await this.grants.revoke(
          tx,
          grant,
          { actorId: null, reason: "refund" },
          now,
          order.correlationId,
        );
      return { status: "processed", note: "purchase refunded", ...ids };
    }

    // Subscription payment: only its period is taken back.
    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, payment.subscriptionId ?? ""))
      .for("update");
    if (!subscription)
      throw new Error("subscription payment without subscription");
    await tx
      .update(billingPeriods)
      .set({ state: "refunded" })
      .where(eq(billingPeriods.paymentId, payment.id));
    const periods = await tx
      .select()
      .from(billingPeriods)
      .where(eq(billingPeriods.subscriptionId, subscription.id))
      .orderBy(desc(billingPeriods.periodEnd));
    const refunded = periods.find((p) => p.paymentId === payment.id);
    const paid = periods.filter((p) => p.state === "paid");
    const newPaidUntil =
      paid[0]?.periodEnd ?? refunded?.periodStart ?? subscription.paidUntil;
    const paidUntil =
      newPaidUntil < subscription.paidUntil
        ? newPaidUntil
        : subscription.paidUntil;
    const lapsed = paidUntil <= now;
    const autoRenew = input.subscriptionCancelled
      ? false
      : subscription.autoRenew;
    const state = lapsed
      ? "expired"
      : !autoRenew && subscription.state === "active"
        ? "cancelling"
        : subscription.state;
    const [updated] = await tx
      .update(subscriptions)
      .set({
        paidUntil,
        autoRenew,
        state,
        expiredAt: lapsed ? now : subscription.expiredAt,
        updatedAt: now,
        version: sql`${subscriptions.version} + 1`,
      })
      .where(eq(subscriptions.id, subscription.id))
      .returning();
    if (updated)
      await subscriptionChanged(tx, updated, now, order.correlationId);
    const grant = await this.grants.lockSource(tx, {
      sourceType: "subscription",
      sourceId: subscription.id,
      service: subscription.service,
      feature: subscription.feature,
    });
    // Refunded time carries no grace.
    if (grant && paidUntil < subscription.paidUntil)
      await this.grants.reshape(
        tx,
        grant,
        { validUntil: paidUntil, state: lapsed ? "expired" : "active" },
        now,
        order.correlationId,
      );
    return {
      status: "processed",
      note: "subscription period refunded",
      ...ids,
      subscriptionId: subscription.id,
    };
  }

  /** Exact contract id, else exactly one open operator request that fits. */
  private async verifiedPayment(
    tx: Executor,
    fact: RefundFact,
    amountMinor: bigint,
  ): Promise<Candidate | null> {
    if (fact.contractId) {
      const payment = await this.lockPaymentByContract(tx, fact.contractId);
      if (payment) return { payment, caseId: null };
    }
    if (!fact.offerId || !fact.customerEmail) return null;
    const rows = await tx
      .select({ caseId: refunds.id, payment: payments })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(checkoutAttempts, eq(checkoutAttempts.orderId, orders.id))
      .where(
        and(
          eq(refunds.kind, "refund"),
          eq(refunds.state, "requested"),
          eq(payments.state, "confirmed"),
          eq(payments.currency, fact.currency),
          eq(orders.providerOfferId, fact.offerId),
          sql`lower(${checkoutAttempts.buyerEmail}) = lower(${fact.customerEmail})`,
          sql`${payments.amountMinor} >= ${amountMinor.toString()}::bigint`,
        ),
      );
    if (rows.length !== 1 || !rows[0]) return null;
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, rows[0].payment.id))
      .for("update");
    return payment ? { payment, caseId: rows[0].caseId } : null;
  }

  /** Purchases that look like the refunded one: evidence for the operator only. */
  private async lookalikes(
    tx: Executor,
    fact: {
      offerId: string | null;
      customerEmail: string | null;
      currency: string;
    },
  ) {
    if (!fact.offerId || !fact.customerEmail) return [];
    const rows = await tx
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(checkoutAttempts, eq(checkoutAttempts.orderId, orders.id))
      .where(
        and(
          eq(orders.providerOfferId, fact.offerId),
          eq(payments.currency, fact.currency as PaymentRow["currency"]),
          inArray(payments.state, ["confirmed", "disputed"]),
          sql`lower(${checkoutAttempts.buyerEmail}) = lower(${fact.customerEmail})`,
        ),
      )
      .limit(20);
    return rows.map((row) => row.id);
  }

  private async lockPaymentByContract(tx: Executor, contractId: string) {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.provider, PROVIDER),
          eq(payments.providerContractId, contractId),
        ),
      )
      .for("update");
    return payment ?? null;
  }
}
