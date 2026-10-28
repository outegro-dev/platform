import {
  billingGrantChanged,
  billingGrumblesPurchased,
  billingGrumblesReversed,
  billingPaymentConfirmed,
  billingSubscriptionChanged,
  createEvent,
} from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import type {
  Executor,
  GrantRow,
  OrderRow,
  PaymentRow,
  SubscriptionRow,
} from "../common/database.js";
import { type Currency, moneyDto } from "../domain/money.js";

/**
 * Domain events go to the outbox in the transaction of the change they
 * describe (INV-13); the relay publishes them to `payments.events`.
 */

export async function grantChanged(
  tx: Executor,
  grant: GrantRow,
  at: Date,
  correlationId?: string,
) {
  await enqueueEvent(
    tx,
    createEvent(billingGrantChanged, {
      aggregateId: grant.id,
      aggregateVersion: grant.version,
      occurredAt: at,
      correlationId,
      payload: {
        grantId: grant.id,
        userId: grant.userId,
        service: grant.service,
        feature: grant.feature,
        sourceType: grant.sourceType,
        sourceId: grant.sourceId,
        state: grant.state,
        validFrom: grant.validFrom.toISOString(),
        validUntil: grant.validUntil?.toISOString() ?? null,
      },
    }),
  );
}

/** Returns the event id, the source of a follow-up notification. */
export async function subscriptionChanged(
  tx: Executor,
  subscription: SubscriptionRow,
  at: Date,
  correlationId?: string,
) {
  const event = createEvent(billingSubscriptionChanged, {
    aggregateId: subscription.id,
    aggregateVersion: subscription.version,
    occurredAt: at,
    correlationId,
    payload: {
      subscriptionId: subscription.id,
      userId: subscription.userId,
      state: subscription.state,
      paidUntil: subscription.paidUntil.toISOString(),
      autoRenew: subscription.autoRenew,
    },
  });
  await enqueueEvent(tx, event);
  return event.eventId;
}

/** Returns the event id, the source of the follow-up notification. */
export async function paymentConfirmed(
  tx: Executor,
  payment: PaymentRow,
  at: Date,
  correlationId?: string,
) {
  const event = createEvent(billingPaymentConfirmed, {
    aggregateId: payment.id,
    aggregateVersion: 1,
    occurredAt: at,
    correlationId,
    payload: {
      paymentId: payment.id,
      orderId: payment.orderId,
      userId: payment.userId,
      money: moneyDto(payment.amountMinor, payment.currency),
      confirmedAt: payment.confirmedAt.toISOString(),
    },
  });
  await enqueueEvent(tx, event);
  return event.eventId;
}

/** A paid pack of grumbles (phase 2): the wallet credits it once. */
export async function grumblesPurchased(
  tx: Executor,
  order: OrderRow,
  payment: PaymentRow,
  at: Date,
) {
  if (order.grumbles === null) throw new Error("pack order without grumbles");
  await enqueueEvent(
    tx,
    createEvent(billingGrumblesPurchased, {
      aggregateId: payment.id,
      aggregateVersion: 1,
      occurredAt: at,
      correlationId: order.correlationId,
      payload: {
        paymentId: payment.id,
        orderId: order.id,
        userId: payment.userId,
        productKey: order.productKey,
        grumbles: order.grumbles.toString(),
        money: moneyDto(payment.amountMinor, payment.currency),
        paidAt: payment.confirmedAt.toISOString(),
      },
    }),
  );
}

/** Money of a pack given back: the wallet takes `grumbles` back once per case. */
export async function grumblesReversed(
  tx: Executor,
  input: {
    caseId: string;
    payment: PaymentRow;
    kind: "refund" | "chargeback";
    grumbles: bigint;
    amountMinor: bigint;
    currency: Currency;
  },
  at: Date,
  correlationId?: string,
) {
  await enqueueEvent(
    tx,
    createEvent(billingGrumblesReversed, {
      aggregateId: input.caseId,
      aggregateVersion: 1,
      occurredAt: at,
      correlationId,
      payload: {
        caseId: input.caseId,
        paymentId: input.payment.id,
        userId: input.payment.userId,
        kind: input.kind,
        grumbles: input.grumbles.toString(),
        money: moneyDto(input.amountMinor, input.currency),
        occurredAt: at.toISOString(),
      },
    }),
  );
}
