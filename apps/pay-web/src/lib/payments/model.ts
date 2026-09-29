/*
 * What pay-web knows about payments, independent of the wire format.
 * `client.ts` is the only file that maps payments-backend responses onto
 * these types; pages, stores and components use nothing else.
 *
 * Unknown enum values from the server become "unknown": the UI says the
 * status is being checked instead of guessing (chapter 6.2).
 */

/** Exact money: integer minor units as a string, the currency and its scale. */
export type Money = { minor: string; currency: string; scale: number };

export type Localized = { en: string; ru: string };

export const orderStatuses = ["pending", "paid", "failed", "refunded"] as const;
export type OrderStatus = (typeof orderStatuses)[number] | "unknown";

export const checkoutStates = [
  "requesting",
  "ready",
  "failed",
  "unknown",
] as const;
export type CheckoutState = (typeof checkoutStates)[number];

export const productKinds = ["subscription", "one_time"] as const;
export type ProductKind = (typeof productKinds)[number] | "unknown";

export const periodicities = [
  "ONE_TIME",
  "MONTHLY",
  "PERIOD_90_DAYS",
  "PERIOD_180_DAYS",
  "PERIOD_YEAR",
] as const;
export type Periodicity = (typeof periodicities)[number] | "unknown";

export const grantStates = ["active", "revoked", "expired"] as const;
export type GrantState = (typeof grantStates)[number] | "unknown";

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

/** The access a purchase opened: service, feature and its interval. */
export type Access = {
  service: string;
  feature: string;
  state: GrantState;
  validFrom: string;
  /** null: perpetual (one-time purchases). */
  validUntil: string | null;
};

export type Order = {
  id: string;
  productKey: string;
  title: Localized;
  kind: ProductKind;
  status: OrderStatus;
  money: Money;
  createdAt: string;
  paidAt: string | null;
  /** The provider call of this order; paymentUrl only while payable. */
  checkout: { state: CheckoutState; paymentUrl: string | null } | null;
  subscriptionId: string | null;
  access: Access | null;
};

export type Subscription = {
  id: string;
  orderId: string;
  productKey: string;
  title: Localized | null;
  state: SubscriptionState;
  autoRenew: boolean;
  paidUntil: string;
  /** paidUntil plus the product's grace days. */
  accessUntil: string;
  money: Money;
  periodicity: Periodicity;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  createdAt: string;
};

export type Price = { priceId: string; money: Money };

export type Product = {
  key: string;
  service: string;
  feature: string;
  kind: ProductKind;
  periodicity: Periodicity;
  graceDays: number;
  title: Localized;
  description: Localized;
  prices: Price[];
};

export type Catalog = { checkoutEnabled: boolean; products: Product[] };

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Why a read did not produce data. Never shown as "empty". */
export type Failure =
  /** No or expired session: sign in again. */
  | "unauthorized"
  /** Missing, or someone else's (the API does not tell them apart). */
  | "not-found"
  /** A link with an outdated cursor or id. */
  | "invalid"
  /** Timeout, 5xx, rate limit or an answer outside the contract. */
  | "unavailable";

export type Result<T> = { ok: true; data: T } | { ok: false; error: Failure };

export type CheckoutInput = {
  productKey: string;
  currency: string;
  /** Same key + same input returns the same order (8–128 of A-Za-z0-9._:-). */
  idempotencyKey: string;
};

/** What starting (or repeating) a checkout led to. */
export type CheckoutOutcome =
  /** An https payment page on an allowed origin. */
  | { kind: "redirect"; orderId: string; url: string }
  /** The invoice is being created or its fate is unknown: repeat with the same key. */
  | { kind: "preparing"; orderId: string }
  /** The same key already led to a paid order. */
  | { kind: "paid"; orderId: string }
  /** The provider refused; a new attempt needs a new key. */
  | { kind: "failed"; orderId: string }
  /** The payment page is not on an allowed https origin: not followed. */
  | { kind: "blocked"; orderId: string }
  /** Already owned (one-time) or already subscribed. */
  | { kind: "owned" }
  /** Sales are closed right now. */
  | { kind: "closed" }
  /** The product or currency is no longer offered. */
  | { kind: "gone" }
  /** The key was used with another input. */
  | { kind: "conflict" }
  | { kind: "unauthorized" }
  | { kind: "unavailable" };

/** Result of turning renewal off: the server's state is what we show. */
export type CancelOutcome =
  | { kind: "ok"; subscription: Subscription }
  | { kind: "unauthorized" }
  | { kind: "not-found" }
  /** Timeout or outage: the result is unknown, repeating is safe. */
  | { kind: "unavailable" };

export const isKnown = <T extends string>(
  values: readonly T[],
  value: string,
): value is T => (values as readonly string[]).includes(value);
