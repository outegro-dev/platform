import type { Access, Order, Subscription } from "./model";

/*
 * How payment facts read to a person. Pure functions: the server decides the
 * state, these only choose the wording key and tone. Wording lives in
 * messages/{en,ru}.json under the returned keys.
 */

export type Tone = "neutral" | "pending" | "success" | "warning" | "danger";

/** One word for an order in lists and headings. */
export type OrderPhase =
  | "processing"
  | "activating"
  | "paid"
  | "failed"
  | "refunded"
  | "unknown";

export function orderPhase(
  order: Pick<Order, "status" | "access">,
): OrderPhase {
  switch (order.status) {
    case "pending":
      return "processing";
    // Money is confirmed; the access grant may still be on its way.
    case "paid":
      return order.access ? "paid" : "activating";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    default:
      return "unknown";
  }
}

export const orderTone: Record<OrderPhase, Tone> = {
  processing: "pending",
  activating: "pending",
  paid: "success",
  failed: "danger",
  refunded: "neutral",
  unknown: "neutral",
};

/**
 * A watched order stops being polled once nothing more can happen without
 * the user: paid with access, failed or refunded.
 */
export function isSettled(order: Pick<Order, "status" | "access">): boolean {
  const phase = orderPhase(order);
  return phase === "paid" || phase === "failed" || phase === "refunded";
}

/** Finer wording for a pending order, from the state of its provider call. */
export type PendingDetail = "preparing" | "awaiting" | "verifying";

export function pendingDetail(order: Pick<Order, "checkout">): PendingDetail {
  switch (order.checkout?.state) {
    case "requesting":
      return "preparing";
    case "unknown":
      return "verifying";
    default:
      return "awaiting";
  }
}

export type StepState = "done" | "current" | "failed" | "upcoming";
export type TimelineStep = {
  key: "created" | "payment" | "access" | "refund";
  /** messages: timeline.<key>.<variant> */
  variant: string;
  state: StepState;
  at: string | null;
};

/** The order's story so far: created → payment → access (→ refund). */
export function orderTimeline(order: Order): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: "created", variant: "done", state: "done", at: order.createdAt },
  ];
  const phase = orderPhase(order);
  switch (phase) {
    case "processing":
      steps.push({
        key: "payment",
        variant: pendingDetail(order),
        state: "current",
        at: null,
      });
      steps.push({
        key: "access",
        variant: "upcoming",
        state: "upcoming",
        at: null,
      });
      break;
    case "failed":
      steps.push({
        key: "payment",
        variant: "failed",
        state: "failed",
        at: null,
      });
      steps.push({
        key: "access",
        variant: "none",
        state: "upcoming",
        at: null,
      });
      break;
    case "unknown":
      steps.push({
        key: "payment",
        variant: "unknown",
        state: "current",
        at: null,
      });
      steps.push({
        key: "access",
        variant: "upcoming",
        state: "upcoming",
        at: null,
      });
      break;
    default:
      steps.push({
        key: "payment",
        variant: "done",
        state: "done",
        at: order.paidAt,
      });
      steps.push(
        order.access
          ? {
              key: "access",
              variant: "done",
              state: "done",
              at: order.access.validFrom,
            }
          : {
              key: "access",
              variant: "activating",
              state: "current",
              at: null,
            },
      );
      if (phase === "refunded")
        steps.push({ key: "refund", variant: "done", state: "done", at: null });
  }
  return steps;
}

/** What the access of an order looks like right now. */
export type AccessPhase =
  | "active-forever"
  | "active-until"
  | "activating"
  | "after-payment"
  | "none"
  | "expired"
  | "revoked"
  | "unknown";

export function accessPhase(
  order: Pick<Order, "status" | "access">,
): AccessPhase {
  const access: Access | null = order.access;
  if (!access) {
    if (order.status === "paid") return "activating";
    if (order.status === "pending") return "after-payment";
    return "none";
  }
  switch (access.state) {
    case "active":
      return access.validUntil ? "active-until" : "active-forever";
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
    default:
      return "unknown";
  }
}

export const subscriptionTone: Record<Subscription["state"], Tone> = {
  pending: "pending",
  active: "success",
  past_due: "warning",
  cancel_requested: "pending",
  cancelling: "neutral",
  expired: "neutral",
  suspended: "danger",
  unknown: "neutral",
};

/**
 * Renewal can be turned off while the provider may still charge: active or
 * past due, with auto-renew on. Everything else (already cancelling,
 * ended, pending) has no cancel button; the server would ignore it anyway.
 */
export function canCancel(sub: Pick<Subscription, "state" | "autoRenew">) {
  return (sub.state === "active" || sub.state === "past_due") && sub.autoRenew;
}

/** Wording key for the explanation under a subscription. */
export function subscriptionNote(
  sub: Pick<Subscription, "state" | "autoRenew">,
): string {
  if (sub.state === "active") return sub.autoRenew ? "renews" : "ends";
  return sub.state;
}

/** Current (anything not ended) first, then past; newest first inside each. */
export function groupSubscriptions<T extends Pick<Subscription, "state">>(
  items: readonly T[],
) {
  return {
    current: items.filter((sub) => sub.state !== "expired"),
    past: items.filter((sub) => sub.state === "expired"),
  };
}

/** Whole grace days between paid end and access end, 0 when none. */
export function graceDays(
  sub: Pick<Subscription, "paidUntil" | "accessUntil">,
) {
  const diff = Date.parse(sub.accessUntil) - Date.parse(sub.paidUntil);
  return diff > 0 ? Math.round(diff / 86_400_000) : 0;
}
