import type { OrderDetail } from "./adapters/payments";
import { type Tone, toneOf } from "./tones";

/**
 * The story of one order, oldest first: checkout, provider events, payments,
 * subscription, access and operator actions. Where a fact has two times
 * (when it happened at the provider, when we recorded it) both are kept.
 */
export type TimelineKind =
  | "order"
  | "attempt"
  | "attemptResolved"
  | "event"
  | "payment"
  | "subscription"
  | "subscriptionCancelRequested"
  | "subscriptionCancelled"
  | "subscriptionExpired"
  | "grant"
  | "refund"
  | "audit";

export type TimelineItem = {
  key: string;
  at: string;
  kind: TimelineKind;
  tone: Tone;
  /** Values for the kind's title (state, action, type…). */
  values: Record<string, string>;
  /** Extra line: a failure reason, a note, an operator's reason. */
  detail: string | null;
  /** The second time of the same fact. */
  also: { label: "recorded" | "processed"; at: string } | null;
};

export function orderTimeline(detail: OrderDetail): TimelineItem[] {
  const items: TimelineItem[] = [];
  const add = (
    item: Omit<TimelineItem, "detail" | "also"> &
      Partial<Pick<TimelineItem, "detail" | "also">>,
  ) => items.push({ detail: null, also: null, ...item });

  add({
    key: `order-${detail.order.id}`,
    at: detail.order.createdAt,
    kind: "order",
    tone: "info",
    values: { status: detail.order.status },
  });
  if (detail.attempt) {
    add({
      key: `attempt-${detail.attempt.id}`,
      at: detail.attempt.requestedAt,
      kind: "attempt",
      tone: "info",
      values: { invoice: detail.attempt.providerInvoiceId ?? "" },
    });
    if (detail.attempt.resolvedAt)
      add({
        key: `attempt-resolved-${detail.attempt.id}`,
        at: detail.attempt.resolvedAt,
        kind: "attemptResolved",
        tone: toneOf("attempt", detail.attempt.state),
        values: { state: detail.attempt.state, result: detail.attempt.state },
        detail: detail.attempt.failureReason,
      });
  }
  for (const event of detail.events) {
    add({
      key: `event-${event.id}`,
      at: event.receivedAt,
      kind: "event",
      tone: toneOf("event", event.status),
      values: { type: event.type, status: event.status, source: event.source },
      detail: event.lastError ?? event.note,
      also: event.processedAt
        ? { label: "processed", at: event.processedAt }
        : null,
    });
  }
  for (const payment of detail.payments) {
    add({
      key: `payment-${payment.id}`,
      at: payment.paidAt,
      kind: "payment",
      tone: toneOf("payment", payment.state),
      values: { kind: payment.kind, state: payment.state },
      also: { label: "recorded", at: payment.confirmedAt },
    });
  }
  const subscription = detail.subscription;
  if (subscription) {
    add({
      key: `subscription-${subscription.id}`,
      at: subscription.createdAt,
      kind: "subscription",
      tone: "info",
      values: { state: subscription.state },
    });
    if (subscription.cancelRequestedAt)
      add({
        key: `subscription-cancel-${subscription.id}`,
        at: subscription.cancelRequestedAt,
        kind: "subscriptionCancelRequested",
        tone: "warn",
        values: {},
      });
    if (subscription.cancelledAt)
      add({
        key: `subscription-cancelled-${subscription.id}`,
        at: subscription.cancelledAt,
        kind: "subscriptionCancelled",
        tone: "neutral",
        values: {},
      });
    if (subscription.expiredAt)
      add({
        key: `subscription-expired-${subscription.id}`,
        at: subscription.expiredAt,
        kind: "subscriptionExpired",
        tone: "neutral",
        values: {},
      });
  }
  for (const grant of detail.grants) {
    add({
      key: `grant-${grant.id}`,
      at: grant.validFrom,
      kind: "grant",
      tone: toneOf("grant", grant.state),
      values: {
        feature: `${grant.service}/${grant.feature}`,
        state: grant.state,
      },
    });
  }
  for (const refund of detail.refunds) {
    add({
      key: `refund-${refund.id}`,
      at: refund.createdAt,
      kind: "refund",
      tone: toneOf("refund", refund.state),
      values: { kind: refund.kind, state: refund.state },
      detail: refund.reason,
    });
  }
  for (const entry of detail.audit) {
    add({
      key: `audit-${entry.id}`,
      at: entry.createdAt,
      kind: "audit",
      tone: "info",
      values: { action: entry.action },
      detail: entry.reason,
    });
  }
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
