import type {
  AttemptRow,
  GrantRow,
  OrderRow,
  PaymentRow,
  SubscriptionRow,
} from "../common/database.js";
import type { LocalizedText } from "../domain/catalog.js";
import { accessUntil } from "../domain/lifecycle.js";
import { moneyDto } from "../domain/money.js";

/** Response shapes shared by the user and admin APIs (UTC ISO, money as minor strings). */

const iso = (value: Date | null) => value?.toISOString() ?? null;

export const grantView = (grant: GrantRow) => ({
  id: grant.id,
  userId: grant.userId,
  service: grant.service,
  feature: grant.feature,
  sourceType: grant.sourceType,
  sourceId: grant.sourceId,
  state: grant.state,
  validFrom: grant.validFrom.toISOString(),
  validUntil: iso(grant.validUntil),
  version: grant.version,
});

export const orderView = (
  order: OrderRow,
  extra: {
    attempt?: AttemptRow | null;
    subscriptionId?: string | null;
    grant?: GrantRow | null;
  } = {},
) => ({
  id: order.id,
  productKey: order.productKey,
  title: order.title,
  kind: order.kind,
  status: order.status,
  money: moneyDto(order.amountMinor, order.currency),
  priceVersion: order.priceVersion,
  createdAt: order.createdAt.toISOString(),
  paidAt: iso(order.paidAt),
  checkout: extra.attempt
    ? {
        state: extra.attempt.state,
        paymentUrl:
          extra.attempt.state === "ready" && order.status === "pending"
            ? extra.attempt.paymentUrl
            : null,
      }
    : null,
  subscriptionId: extra.subscriptionId ?? null,
  access: extra.grant ? grantView(extra.grant) : null,
});

export const subscriptionView = (
  subscription: SubscriptionRow,
  title: LocalizedText | null = null,
) => ({
  id: subscription.id,
  orderId: subscription.orderId,
  productKey: subscription.productKey,
  title,
  state: subscription.state,
  autoRenew: subscription.autoRenew,
  paidUntil: subscription.paidUntil.toISOString(),
  accessUntil: accessUntil(
    subscription.paidUntil,
    subscription.graceDays,
  ).toISOString(),
  money: moneyDto(subscription.amountMinor, subscription.currency),
  periodicity: subscription.periodicity,
  cancelRequestedAt: iso(subscription.cancelRequestedAt),
  cancelledAt: iso(subscription.cancelledAt),
  expiredAt: iso(subscription.expiredAt),
  createdAt: subscription.createdAt.toISOString(),
});

export const paymentView = (payment: PaymentRow) => ({
  id: payment.id,
  orderId: payment.orderId,
  subscriptionId: payment.subscriptionId,
  userId: payment.userId,
  kind: payment.kind,
  state: payment.state,
  money: moneyDto(payment.amountMinor, payment.currency),
  providerContractId: payment.providerContractId,
  paidAt: payment.paidAt.toISOString(),
  confirmedAt: payment.confirmedAt.toISOString(),
});
