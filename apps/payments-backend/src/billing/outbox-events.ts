import {
  billingGrantChanged,
  billingPaymentConfirmed,
  billingSubscriptionChanged,
  createEvent,
} from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import type {
  Executor,
  GrantRow,
  PaymentRow,
  SubscriptionRow,
} from "../common/database.js";
import { moneyDto } from "../domain/money.js";

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
