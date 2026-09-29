import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import {
  currentPremium,
  premiumProductKey,
  premiumStatus,
  type SubscriptionSummary,
} from "./ownership";

const sub = (
  changes: Partial<SubscriptionSummary> = {},
): SubscriptionSummary => ({
  productKey: "battleship-premium",
  state: "active",
  autoRenew: true,
  paidUntil: "2026-10-29T12:00:00.000Z",
  accessUntil: "2026-11-01T12:00:00.000Z",
  ...changes,
});

describe("premiumProductKey", () => {
  it("asks the catalog which product grants Premium", () => {
    const catalog = {
      status: "ok",
      checkoutEnabled: true,
      products: [
        { key: "sea-pass", feature: "premium" },
        { key: "battleship-silver-fleet", feature: "cosmetics.silver-fleet" },
      ],
    } as unknown as Catalog;
    expect(premiumProductKey(catalog)).toBe("sea-pass");
    expect(premiumProductKey(null)).toBe("battleship-premium");
    expect(premiumProductKey({ ...catalog, products: [] })).toBe(
      "battleship-premium",
    );
  });
});

describe("currentPremium", () => {
  it("picks the newest Premium subscription that still gives access", () => {
    const ended = sub({ state: "expired" });
    const live = sub({ state: "cancel_requested" });
    const other = sub({ productKey: "assistant-pro" });
    expect(
      currentPremium([other, ended, live, sub()], "battleship-premium"),
    ).toBe(live);
    expect(currentPremium([ended, other], "battleship-premium")).toBeNull();
    expect(
      currentPremium([sub({ state: "pending" })], "battleship-premium"),
    ).toBeNull();
    expect(currentPremium(null, "battleship-premium")).toBeNull();
  });
});

describe("premiumStatus", () => {
  const owned = { owned: true, premiumUntil: "2026-11-01T12:00:00.000Z" };

  it("renews on the paid date while renewal is on", () => {
    expect(premiumStatus({ ...owned, subscription: sub() })).toEqual({
      kind: "renews",
      date: "2026-10-29T12:00:00.000Z",
    });
  });

  it("ends with the access period once renewal is off", () => {
    for (const subscription of [
      sub({ autoRenew: false }),
      sub({ state: "cancelling", autoRenew: false }),
    ])
      expect(premiumStatus({ ...owned, subscription })).toEqual({
        kind: "ends",
        date: "2026-11-01T12:00:00.000Z",
      });
  });

  it("says a cancellation or a renewal is still being confirmed", () => {
    expect(
      premiumStatus({
        ...owned,
        subscription: sub({ state: "cancel_requested" }),
      }),
    ).toEqual({ kind: "cancel-pending", date: "2026-11-01T12:00:00.000Z" });
    expect(
      premiumStatus({ ...owned, subscription: sub({ state: "past_due" }) }),
    ).toEqual({ kind: "overdue", date: "2026-11-01T12:00:00.000Z" });
  });

  it("falls back to the game's grant when payments says nothing more", () => {
    expect(premiumStatus({ ...owned, subscription: null })).toEqual({
      kind: "active-until",
      date: "2026-11-01T12:00:00.000Z",
    });
    expect(
      premiumStatus({
        owned: true,
        premiumUntil: null,
        subscription: sub({ state: "unknown" }),
      }),
    ).toEqual({ kind: "active" });
  });

  it("is off without the grant, whatever payments reports", () => {
    expect(
      premiumStatus({ owned: false, premiumUntil: null, subscription: sub() }),
    ).toEqual({ kind: "none" });
  });
});
