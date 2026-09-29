import type { Money } from "@outegro/contracts";

export const currencies = ["RUB", "USD", "EUR"] as const;
export type Currency = (typeof currencies)[number];

/** A game product as the shop shows it: localized, with a price per currency. */
export type CatalogProduct = {
  key: string;
  /** Feature granted by the purchase, e.g. "premium". */
  feature: string;
  kind: "subscription" | "one_time";
  periodicity: "MONTHLY" | "ONE_TIME";
  title: string;
  description: string;
  prices: { priceId: string; money: Money & { currency: Currency } }[];
};

/**
 * - `ok`: products and prices from payments;
 * - `unconfigured`: no PAYMENTS_API_URL yet ("coming soon");
 * - `unavailable`: payments did not answer.
 */
export type CatalogStatus = "ok" | "unconfigured" | "unavailable";

export type Catalog = {
  status: CatalogStatus;
  /** False: products are shown, purchases open later. */
  checkoutEnabled: boolean;
  products: CatalogProduct[];
};

export type CheckoutRequest = {
  productKey: string;
  currency: Currency;
  /** What the shop waits for after the provider sends the buyer back. */
  feature: string;
  /** Idempotency-Key: the same for every retry of one purchase. */
  reference: string;
};

export type CheckoutOutcome =
  | { kind: "redirect"; url: string }
  /** The order exists but the payment page is not ready: retry with the same reference. */
  | { kind: "preparing" }
  /** Accepted without a page to visit: wait for the grant. */
  | { kind: "pending" }
  /** Already owned or subscribed (422). */
  | { kind: "owned" }
  | {
      kind: "error";
      reason: "unavailable" | "blocked" | "unauthorized" | "rejected";
    };

/** Idempotency-Key format accepted by payments. */
export const checkoutReferencePattern = /^[A-Za-z0-9._:-]{8,128}$/;

/** RU visitors pay in roubles by default, everyone else in dollars. */
export function defaultCurrency(locale: string): Currency {
  return locale === "ru" ? "RUB" : "USD";
}

export function priceIn(product: CatalogProduct, currency: Currency) {
  return (
    product.prices.find((price) => price.money.currency === currency) ??
    product.prices[0] ??
    null
  );
}
