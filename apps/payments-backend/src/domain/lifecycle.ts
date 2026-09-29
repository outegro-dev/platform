import { addDays } from "./periods.js";

export const subscriptionStates = [
  "pending",
  "active",
  "past_due",
  "cancel_requested",
  "cancelling",
  "expired",
  "suspended",
] as const;
export type SubscriptionState = (typeof subscriptionStates)[number];

/** States in which the provider may still charge the next period. */
export const renewingStates: readonly SubscriptionState[] = [
  "active",
  "past_due",
  "cancel_requested",
];

/**
 * Subscription transitions (chapter 6.7). Each returns the next state, or
 * null when the fact does not change this subscription.
 */
export const subscriptionLifecycle = {
  /** A confirmed renewal; a cancellation in progress stays in progress. */
  renewed(state: SubscriptionState): SubscriptionState {
    return state === "cancel_requested" || state === "cancelling"
      ? state
      : "active";
  },
  /** A failed renewal only affects a subscription that is still active. */
  renewalFailed(state: SubscriptionState): SubscriptionState | null {
    return state === "active" ? "past_due" : null;
  },
  /** The user asked to stop renewal; the provider has not confirmed yet. */
  cancelRequested(state: SubscriptionState): SubscriptionState | null {
    return state === "active" || state === "past_due"
      ? "cancel_requested"
      : null;
  },
  /** The provider confirmed that renewal is off; paid time is kept. */
  cancelled(state: SubscriptionState): SubscriptionState | null {
    return renewingStates.includes(state) ? "cancelling" : null;
  },
  /** The paid period ended and no renewal was confirmed. */
  periodEnded(
    state: SubscriptionState,
    autoRenew: boolean,
  ): SubscriptionState | null {
    return state === "active" && autoRenew ? "past_due" : null;
  },
  /** Paid time and grace are over. */
  accessEnded(state: SubscriptionState): SubscriptionState | null {
    return state === "expired" ? null : "expired";
  },
};

/** Access of a subscription lasts through its paid period plus grace. */
export const accessUntil = (paidUntil: Date, graceDays: number) =>
  addDays(paidUntil, graceDays);

/** Half-open [validFrom, validUntil): at validUntil access is already gone (INV-12). */
export function grantInForce(
  grant: { state: string; validFrom: Date; validUntil: Date | null },
  now: Date,
) {
  return (
    grant.state === "active" &&
    grant.validFrom <= now &&
    (grant.validUntil === null || grant.validUntil > now)
  );
}
