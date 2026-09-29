import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { and, eq, max, sql } from "drizzle-orm";
import type {
  Executor,
  GrantRow,
  OrderRow,
  PaymentRow,
  SubscriptionRow,
} from "../common/database.js";
import {
  billingPeriods,
  checkoutAttempts,
  financialEntries,
  orders,
  payments,
  subscriptions,
} from "../db/schema.js";
import type { PaymentFact } from "../domain/facts.js";
import { accessUntil, subscriptionLifecycle } from "../domain/lifecycle.js";
import {
  type Currency,
  MoneyError,
  moneyDto,
  toMinor,
} from "../domain/money.js";
import { paidInterval, type RecurringPeriodicity } from "../domain/periods.js";
import { GrantLedger } from "./grants.js";
import { IssueRegistry } from "./issues.js";
import { BillingNotices } from "./notices.js";
import { paymentConfirmed, subscriptionChanged } from "./outbox-events.js";
import { notAfter, type Outcome } from "./outcome.js";
import { alreadyHeld, lockBuyer } from "./ownership.js";

const PROVIDER = "lava";

/**
 * Applies payment facts (webhook or reconciliation) to orders,
 * subscriptions, payments, the journal and grants. One transaction per
 * fact; the order or subscription row is locked, and unique provider
 * contract ids are the second barrier against double effects (INV-14).
 */
@Injectable()
export class SettlementService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly grants: GrantLedger,
    private readonly issues: IssueRegistry,
    private readonly notices: BillingNotices,
  ) {}

  apply(tx: Executor, fact: PaymentFact): Promise<Outcome> {
    return fact.recurring ? this.renewal(tx, fact) : this.initial(tx, fact);
  }

  /** First payment of a subscription, or a one-time purchase. */
  private async initial(tx: Executor, fact: PaymentFact): Promise<Outcome> {
    const now = this.clock.now();
    const [attempt] = await tx
      .select()
      .from(checkoutAttempts)
      .where(
        and(
          eq(checkoutAttempts.provider, PROVIDER),
          eq(checkoutAttempts.providerInvoiceId, fact.contractId),
        ),
      );
    // Early webhook, or a contract we never created: kept, never guessed.
    if (!attempt)
      return { status: "unmatched", note: "no checkout for this contract" };
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, attempt.orderId))
      .for("update");
    if (!order) throw new Error("checkout without order");
    const ids = { orderId: order.id };

    if (fact.outcome === "failed") {
      // A late failure never undoes a confirmed payment (TC-PAY-05-04).
      if (order.status !== "pending")
        return {
          status: "ignored",
          note: `order already ${order.status}`,
          ...ids,
        };
      await tx
        .update(orders)
        .set({
          status: "failed",
          updatedAt: now,
          version: sql`${orders.version} + 1`,
        })
        .where(eq(orders.id, order.id));
      await tx
        .update(checkoutAttempts)
        .set({ nextCheckAt: null, updatedAt: now })
        .where(eq(checkoutAttempts.id, attempt.id));
      return { status: "processed", note: "payment failed", ...ids };
    }

    const known = await this.paymentByContract(tx, fact.contractId);
    if (known)
      return {
        status: "ignored",
        note: "payment already confirmed",
        ...ids,
        paymentId: known.id,
      };
    const mismatch = this.mismatch(fact, order.currency, order.amountMinor);
    if (mismatch) {
      await this.issues.open(
        tx,
        {
          kind: "amount_mismatch",
          severity: "high",
          subjectKey: `contract:${fact.contractId}`,
          related: { orderId: order.id, attemptId: attempt.id },
          evidence: {
            expected: moneyDto(order.amountMinor, order.currency),
            received: { amount: fact.amount, currency: fact.currency },
          },
        },
        now,
      );
      return { status: "mismatch", note: mismatch, ...ids };
    }

    const paidAt = notAfter(new Date(fact.occurredAt), now);
    // A buyer's first payments settle one at a time, like their checkouts:
    // two at once cannot both miss the other and grant twice.
    await lockBuyer(tx, order.userId);
    // Something the buyer already has (another tab, a page opened earlier):
    // the money is recorded, nothing is granted twice (QA H1).
    const held = await alreadyHeld(
      tx,
      order.userId,
      {
        key: order.productKey,
        kind: order.kind,
        service: order.service,
        feature: order.feature,
      },
      order.id,
    );
    await tx
      .update(orders)
      .set({
        status: "paid",
        paidAt: now,
        updatedAt: now,
        version: sql`${orders.version} + 1`,
      })
      .where(eq(orders.id, order.id));
    await tx
      .update(checkoutAttempts)
      .set({ nextCheckAt: null, updatedAt: now })
      .where(eq(checkoutAttempts.id, attempt.id));

    let subscription: SubscriptionRow | null = null;
    let interval: { start: Date; end: Date } | null = null;
    if (order.kind === "subscription") {
      interval = paidInterval({
        paidUntil: null,
        paidAt,
        now,
        periodicity: order.periodicity as RecurringPeriodicity,
      });
      const [created] = await tx
        .insert(subscriptions)
        .values({
          userId: order.userId,
          orderId: order.id,
          productKey: order.productKey,
          service: order.service,
          feature: order.feature,
          periodicity: order.periodicity,
          graceDays: order.graceDays,
          currency: order.currency,
          amountMinor: order.amountMinor,
          provider: PROVIDER,
          providerParentContractId: fact.contractId,
          buyerEmail: attempt.buyerEmail,
          // A second subscription is stopped at once: the worker asks Lava
          // to cancel its renewal, as for a buyer's cancel.
          state: held ? "cancel_requested" : "active",
          providerStatus: fact.providerStatus,
          autoRenew: true,
          paidUntil: interval.end,
          cancelRequestedAt: held ? now : null,
          nextCancelAttemptAt: held ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new Error("subscription insert returned nothing");
      subscription = created;
    }

    const payment = await this.recordPayment(tx, {
      order,
      subscriptionId: subscription?.id ?? null,
      contractId: fact.contractId,
      kind: subscription ? "subscription_initial" : "purchase",
      paidAt,
      now,
    });

    if (subscription && interval) {
      await tx.insert(billingPeriods).values({
        subscriptionId: subscription.id,
        paymentId: payment.id,
        periodStart: interval.start,
        periodEnd: interval.end,
        createdAt: now,
      });
      await subscriptionChanged(tx, subscription, now, order.correlationId);
    }
    const source = {
      userId: order.userId,
      service: order.service,
      feature: order.feature,
      ...(subscription
        ? { sourceType: "subscription" as const, sourceId: subscription.id }
        : { sourceType: "purchase" as const, sourceId: order.id }),
    };
    const window =
      subscription && interval
        ? {
            validFrom: interval.start,
            validUntil: accessUntil(
              subscription.paidUntil,
              subscription.graceDays,
            ),
          }
        : { validFrom: paidAt, validUntil: null };
    let grantActivated: Outcome["grantActivated"];
    if (held) {
      await this.grants.withhold(
        tx,
        source,
        window,
        now,
        "duplicate purchase",
        order.correlationId,
      );
      // The operator refunds this payment in the Lava cabinet.
      await this.issues.open(
        tx,
        {
          kind: "duplicate_purchase",
          severity: "high",
          subjectKey: `payment:${payment.id}`,
          related: {
            orderId: order.id,
            paymentId: payment.id,
            subscriptionId: subscription?.id ?? null,
            heldOrderId: held.orderId,
            heldSubscriptionId: held.subscriptionId,
          },
          evidence: {
            held: held.reason,
            productKey: order.productKey,
            paid: moneyDto(payment.amountMinor, payment.currency),
          },
        },
        now,
      );
      // No receipt: it could only say access is on its way, and this payment
      // opens nothing. The buyer hears about it with the refund.
      await paymentConfirmed(tx, payment, now, order.correlationId);
    } else {
      const { grant, activated } = await this.grants.activate(
        tx,
        source,
        window,
        now,
        order.correlationId,
      );
      await this.announce(
        tx,
        payment,
        grant,
        subscription,
        order.correlationId,
        now,
      );
      if (activated) grantActivated = source.sourceType;
    }
    return {
      status: "processed",
      note: held
        ? "duplicate purchase: payment recorded, nothing granted"
        : "payment confirmed",
      ...ids,
      subscriptionId: subscription?.id ?? null,
      paymentId: payment.id,
      grantActivated,
    };
  }

  /** Second and later payments of a subscription. */
  private async renewal(tx: Executor, fact: PaymentFact): Promise<Outcome> {
    const now = this.clock.now();
    const parent = fact.parentContractId ?? "";
    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, PROVIDER),
          eq(subscriptions.providerParentContractId, parent),
        ),
      )
      .for("update");
    // Never invent a subscription for an unknown parent (TC-PAY-07-03).
    if (!subscription) {
      await this.issues.open(
        tx,
        {
          kind: "renewal_without_parent",
          severity: "high",
          subjectKey: `contract:${fact.contractId}`,
          evidence: {
            contractId: fact.contractId,
            parentContractId: parent,
            outcome: fact.outcome,
          },
        },
        now,
      );
      return { status: "unmatched", note: "unknown parent contract" };
    }
    const ids = {
      orderId: subscription.orderId,
      subscriptionId: subscription.id,
    };
    const known = await this.paymentByContract(tx, fact.contractId);

    if (fact.outcome === "failed") {
      if (known)
        return {
          status: "ignored",
          note: "failure of a confirmed payment",
          ...ids,
        };
      // A failure older than the latest confirmed payment is stale (TC-PAY-07-02).
      const [latest] = await tx
        .select({ paidAt: max(payments.paidAt) })
        .from(payments)
        .where(eq(payments.subscriptionId, subscription.id));
      if (latest?.paidAt && new Date(fact.occurredAt) <= latest.paidAt)
        return { status: "ignored", note: "stale renewal failure", ...ids };
      const next = subscriptionLifecycle.renewalFailed(subscription.state);
      if (!next)
        return {
          status: "ignored",
          note: `no effect in state ${subscription.state}`,
          ...ids,
        };
      const [updated] = await tx
        .update(subscriptions)
        .set({
          state: next,
          providerStatus: fact.providerStatus,
          updatedAt: now,
          version: sql`${subscriptions.version} + 1`,
        })
        .where(eq(subscriptions.id, subscription.id))
        .returning();
      if (updated) {
        const eventId = await subscriptionChanged(tx, updated, now);
        await this.notices.renewalFailed(tx, updated, eventId, now);
      }
      return { status: "processed", note: "renewal failed", ...ids };
    }

    // The same recurrent contract twice never pays for two periods (TC-PAY-07-01).
    if (known)
      return {
        status: "ignored",
        note: "renewal already confirmed",
        ...ids,
        paymentId: known.id,
      };
    const mismatch = this.mismatch(
      fact,
      subscription.currency,
      subscription.amountMinor,
    );
    if (mismatch) {
      await this.issues.open(
        tx,
        {
          kind: "amount_mismatch",
          severity: "high",
          subjectKey: `contract:${fact.contractId}`,
          related: { subscriptionId: subscription.id },
          evidence: {
            expected: moneyDto(subscription.amountMinor, subscription.currency),
            received: { amount: fact.amount, currency: fact.currency },
          },
        },
        now,
      );
      return { status: "mismatch", note: mismatch, ...ids };
    }

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, subscription.orderId));
    if (!order) throw new Error("subscription without order");
    const paidAt = notAfter(new Date(fact.occurredAt), now);
    const interval = paidInterval({
      paidUntil: subscription.paidUntil,
      paidAt,
      now,
      periodicity: subscription.periodicity as RecurringPeriodicity,
    });
    const payment = await this.recordPayment(tx, {
      order,
      subscriptionId: subscription.id,
      contractId: fact.contractId,
      kind: "subscription_renewal",
      paidAt,
      now,
    });
    await tx.insert(billingPeriods).values({
      subscriptionId: subscription.id,
      paymentId: payment.id,
      periodStart: interval.start,
      periodEnd: interval.end,
      createdAt: now,
    });
    const state = subscriptionLifecycle.renewed(subscription.state);
    const [updated] = await tx
      .update(subscriptions)
      .set({
        state,
        paidUntil: interval.end,
        providerStatus: fact.providerStatus,
        expiredAt: state === "active" ? null : subscription.expiredAt,
        updatedAt: now,
        version: sql`${subscriptions.version} + 1`,
      })
      .where(eq(subscriptions.id, subscription.id))
      .returning();
    if (!updated) throw new Error("subscription disappeared");
    await subscriptionChanged(tx, updated, now, order.correlationId);
    // A revoked grant stays revoked: the receipt then promises no access.
    const { grant, activated } = await this.grants.activate(
      tx,
      {
        userId: subscription.userId,
        service: subscription.service,
        feature: subscription.feature,
        sourceType: "subscription",
        sourceId: subscription.id,
      },
      {
        validFrom: interval.start,
        validUntil: accessUntil(updated.paidUntil, updated.graceDays),
      },
      now,
      order.correlationId,
    );
    // Revoked access stays revoked (above); Lava charged a period it should
    // not have, so the operator refunds it.
    if (grant.state === "revoked") {
      await this.issues.open(
        tx,
        {
          kind: "renewal_after_revoke",
          severity: "high",
          subjectKey: `payment:${payment.id}`,
          related: {
            subscriptionId: subscription.id,
            paymentId: payment.id,
            grantId: grant.id,
          },
          evidence: {
            contractId: fact.contractId,
            paid: moneyDto(payment.amountMinor, payment.currency),
          },
        },
        now,
      );
    }
    await this.announce(tx, payment, grant, updated, order.correlationId, now);
    return {
      status: "processed",
      note: "renewal confirmed",
      ...ids,
      paymentId: payment.id,
      grantActivated: activated ? "subscription" : undefined,
    };
  }

  private async paymentByContract(tx: Executor, contractId: string) {
    const [row] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.provider, PROVIDER),
          eq(payments.providerContractId, contractId),
        ),
      );
    return row ?? null;
  }

  /** The provider must report exactly the snapshot amount and currency (TC-PAY-05-02). */
  private mismatch(fact: PaymentFact, currency: Currency, amountMinor: bigint) {
    if (fact.currency !== currency)
      return `currency ${fact.currency} instead of ${currency}`;
    try {
      const received = toMinor(fact.amount, currency);
      return received === amountMinor ? null : "amount differs from the order";
    } catch (error) {
      return error instanceof MoneyError ? error.message : "unreadable amount";
    }
  }

  private async recordPayment(
    tx: Executor,
    input: {
      order: OrderRow;
      subscriptionId: string | null;
      contractId: string;
      kind: PaymentRow["kind"];
      paidAt: Date;
      now: Date;
    },
  ) {
    const { order, now } = input;
    const [payment] = await tx
      .insert(payments)
      .values({
        orderId: order.id,
        subscriptionId: input.subscriptionId,
        userId: order.userId,
        provider: PROVIDER,
        providerContractId: input.contractId,
        kind: input.kind,
        currency: order.currency,
        amountMinor: order.amountMinor,
        paidAt: input.paidAt,
        confirmedAt: now,
        updatedAt: now,
      })
      .returning();
    if (!payment) throw new Error("payment insert returned nothing");
    await tx.insert(financialEntries).values({
      type: "payment",
      sourceRef: `payment:${payment.id}`,
      paymentId: payment.id,
      userId: payment.userId,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      occurredAt: payment.paidAt,
      createdAt: now,
    });
    return payment;
  }

  /** billing.payment.confirmed plus the buyer's receipt, with the grant as it now stands. */
  private async announce(
    tx: Executor,
    payment: PaymentRow,
    grant: GrantRow,
    subscription: SubscriptionRow | null,
    correlationId: string,
    now: Date,
  ) {
    const eventId = await paymentConfirmed(tx, payment, now, correlationId);
    await this.notices.paymentConfirmed(
      tx,
      { payment, grant, subscription, sourceEventId: eventId },
      now,
      correlationId,
    );
  }
}
