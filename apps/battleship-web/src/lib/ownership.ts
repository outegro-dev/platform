import { battleshipFeatures } from "@outegro/contracts/battleship";
import type { Catalog } from "./catalog";

/*
 * What the player owns, as the shop and the profile say it. The game server
 * knows whether Premium is on (the grant); payments knows the subscription
 * behind it: renewal, cancellation, the paid period. Both are combined here.
 */

export const subscriptionStates = [
  "pending",
  "active",
  "past_due",
  "cancel_requested",
  "cancelling",
  "expired",
  "suspended",
] as const;
export type SubscriptionState = (typeof subscriptionStates)[number] | "unknown";

/** A subscription from payments, reduced to what the game shows. */
export type SubscriptionSummary = {
  productKey: string;
  state: SubscriptionState;
  autoRenew: boolean;
  /** The next charge, when renewal is on. */
  paidUntil: string;
  /** paidUntil plus the product's grace days: when access ends. */
  accessUntil: string;
};

/** Premium's product key when the catalog cannot say (payments' catalog). */
const PREMIUM_PRODUCT_KEY = "battleship-premium";

/** Subscriptions that give (or keep giving) access right now. */
const current = new Set<SubscriptionState>([
  "active",
  "past_due",
  "cancel_requested",
  "cancelling",
]);

/** The key of the product that grants Premium, from the catalog if it knows. */
export function premiumProductKey(catalog: Catalog | null): string {
  return (
    catalog?.products.find(
      (product) => product.feature === battleshipFeatures.premium,
    )?.key ?? PREMIUM_PRODUCT_KEY
  );
}

/**
 * The Premium subscription that matters now: the newest one still giving
 * access (payments lists newest first), or null.
 */
export function currentPremium(
  subscriptions: readonly SubscriptionSummary[] | null,
  productKey: string,
): SubscriptionSummary | null {
  return (
    subscriptions?.find(
      (subscription) =>
        subscription.productKey === productKey &&
        current.has(subscription.state),
    ) ?? null
  );
}

export type PremiumStatus =
  /** Renewal is on: the next charge. */
  | { kind: "renews"; date: string }
  /** Renewal is off: access until the end of the paid period. */
  | { kind: "ends"; date: string }
  /** Cancelling was sent, the provider has not confirmed it yet. */
  | { kind: "cancel-pending"; date: string }
  /** The last renewal is not confirmed; access continues meanwhile. */
  | { kind: "overdue"; date: string }
  /** Premium is on, payments did not say more (unreachable, manual grant). */
  | { kind: "active-until"; date: string }
  | { kind: "active" }
  | { kind: "none" };

/**
 * Premium as the player should read it. `owned` comes from the game (the
 * grant is what unlocks things); the subscription only adds its details.
 */
export function premiumStatus({
  owned,
  premiumUntil,
  subscription,
}: {
  owned: boolean;
  premiumUntil: string | null | undefined;
  subscription: SubscriptionSummary | null;
}): PremiumStatus {
  if (!owned) return { kind: "none" };
  switch (subscription?.state) {
    case "active":
      return subscription.autoRenew
        ? { kind: "renews", date: subscription.paidUntil }
        : { kind: "ends", date: subscription.accessUntil };
    case "cancel_requested":
      return { kind: "cancel-pending", date: subscription.accessUntil };
    case "past_due":
      return { kind: "overdue", date: subscription.accessUntil };
    case "cancelling":
      return { kind: "ends", date: subscription.accessUntil };
  }
  return premiumUntil
    ? { kind: "active-until", date: premiumUntil }
    : { kind: "active" };
}
