import { battleshipFeatures } from "@outegro/contracts/battleship";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Catalog,
  CatalogProduct,
  CheckoutOutcome,
  OrderStatus,
} from "@/lib/catalog";
import { profile, server } from "../testing/fakes";
import { SessionStore } from "./session-store";
import {
  type PendingPurchase,
  type PendingPurchases,
  type ShopApi,
  ShopStore,
} from "./shop-store";

const silver: CatalogProduct = {
  key: "battleship-silver-fleet",
  feature: battleshipFeatures.silverFleet,
  kind: "one_time",
  periodicity: "ONE_TIME",
  title: "Silver Fleet",
  description: "Silver ships",
  prices: [
    {
      priceId: "silver-rub",
      money: { minor: "5000", currency: "RUB", scale: 2 },
    },
    {
      priceId: "silver-usd",
      money: { minor: "59", currency: "USD", scale: 2 },
    },
  ],
};

const catalog = (overrides: Partial<Catalog> = {}): Catalog => ({
  status: "ok",
  checkoutEnabled: true,
  products: [silver],
  ...overrides,
});

/** In-memory stand-in for sessionStorage. */
function memoryPending(): PendingPurchases & { value: PendingPurchase | null } {
  return {
    value: null,
    save(purchase) {
      this.value = purchase;
    },
    take() {
      const value = this.value;
      this.value = null;
      return value;
    },
  };
}

function setup(api: Partial<ShopApi> = {}, initial: Partial<Catalog> = {}) {
  let features: string[] = [];
  const fetchProfile = vi.fn(async () => ({ ...profile, features }));
  const session = new SessionStore(
    { signedIn: true, profile },
    { fetchProfile },
  );
  const navigate = vi.fn();
  const pending = memoryPending();
  const startCheckout = vi.fn(
    async (): Promise<CheckoutOutcome> => ({
      kind: "redirect",
      url: "https://checkout.test/pay/1",
    }),
  );
  const orderStatus = vi.fn(
    async (): Promise<OrderStatus | null> => ({
      status: "pending",
      feature: null,
    }),
  );
  const shop = new ShopStore(
    {
      session,
      navigate,
      pending,
      newReference: () => "bs-reference-0001",
      api: {
        startCheckout,
        orderStatus,
        equip: vi.fn(async () => ({ ok: true as const, profile })),
        fetchProfile,
        ...api,
      },
    },
    { catalog: catalog(initial), currency: "RUB" },
  );
  return {
    shop,
    session,
    navigate,
    pending,
    fetchProfile,
    startCheckout,
    orderStatus,
    grant: (feature: string) => {
      features = [...features, feature];
    },
  };
}

const playerUpdated = () =>
  server("player.updated", {
    player: {
      nickname: "Sailor 4821",
      rating: 1016,
      premium: false,
      cosmetics: { ships: "classic", hitEffect: "flame", theme: "day" },
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ShopStore: checkout", () => {
  it("sends the buyer to the payment page and remembers what was bought", async () => {
    const { shop, navigate, startCheckout, pending } = setup();
    shop.setCurrency("USD");
    await shop.buy(silver);
    expect(startCheckout).toHaveBeenCalledWith({
      productKey: "battleship-silver-fleet",
      currency: "USD",
      reference: "bs-reference-0001",
    });
    expect(shop.phase).toBe("redirecting");
    expect(navigate).toHaveBeenCalledWith("https://checkout.test/pay/1");
    expect(pending.value).toEqual({
      productKey: "battleship-silver-fleet",
      feature: battleshipFeatures.silverFleet,
    });
  });

  it("keeps the same reference while the payment page is being prepared", async () => {
    const outcomes: CheckoutOutcome[] = [
      { kind: "preparing" },
      { kind: "preparing" },
      { kind: "redirect", url: "https://checkout.test/pay/2" },
    ];
    const startCheckout = vi.fn(
      async () => outcomes.shift() as CheckoutOutcome,
    );
    const { shop, navigate } = setup({ startCheckout });
    const buying = shop.buy(silver);
    await vi.advanceTimersByTimeAsync(0);
    expect(shop.phase).toBe("preparing");
    await vi.advanceTimersByTimeAsync(3000);
    await buying;
    expect(startCheckout).toHaveBeenCalledTimes(3);
    const references = startCheckout.mock.calls.map(
      (call) => (call as unknown as [{ reference: string }])[0].reference,
    );
    expect(new Set(references)).toEqual(new Set(["bs-reference-0001"]));
    expect(navigate).toHaveBeenCalledWith("https://checkout.test/pay/2");
  });

  it("gives up after a few preparing answers", async () => {
    const startCheckout = vi.fn(
      async (): Promise<CheckoutOutcome> => ({ kind: "preparing" }),
    );
    const { shop } = setup({ startCheckout });
    const buying = shop.buy(silver);
    await vi.advanceTimersByTimeAsync(20_000);
    await buying;
    expect(startCheckout).toHaveBeenCalledTimes(6);
    expect(shop.phase).toBe("idle");
    expect(shop.error).toBe("unavailable");
  });

  it("shows why a checkout could not start", async () => {
    const { shop, navigate } = setup({
      startCheckout: async () => ({ kind: "error", reason: "blocked" }),
    });
    await shop.buy(silver);
    expect(shop.phase).toBe("idle");
    expect(shop.error).toBe("blocked");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("an already owned product refreshes the profile instead of charging", async () => {
    const { shop, fetchProfile } = setup({
      startCheckout: async () => ({ kind: "owned" }),
    });
    await shop.buy(silver);
    expect(shop.error).toBe("owned");
    expect(fetchProfile).toHaveBeenCalled();
  });

  it("does not sell while purchases are closed", async () => {
    const { shop, startCheckout } = setup({}, { checkoutEnabled: false });
    expect(shop.canBuy).toBe(false);
    await shop.buy(silver);
    expect(startCheckout).not.toHaveBeenCalled();
  });
});

describe("ShopStore: back from the provider", () => {
  it("processes until player.updated brings the feature", async () => {
    const { shop, session, grant, pending } = setup();
    pending.save({ productKey: silver.key, feature: silver.feature });
    shop.returnFromCheckout("order-0001", "success");
    expect(shop.phase).toBe("processing");
    expect(shop.awaiting).toBe(silver.feature);
    grant(silver.feature);
    session.handle(playerUpdated());
    await vi.advanceTimersByTimeAsync(0);
    expect(shop.phase).toBe("success");
  });

  it("falls back to polling the profile every 3 s", async () => {
    const { shop, fetchProfile, grant, pending } = setup();
    pending.save({ productKey: silver.key, feature: silver.feature });
    shop.returnFromCheckout("order-0001", "success");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(shop.phase).toBe("processing");
    grant(silver.feature);
    await vi.advanceTimersByTimeAsync(3000);
    expect(shop.phase).toBe("success");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });

  it("learns the feature from the order when this tab forgot it", async () => {
    const { shop, grant, orderStatus } = setup();
    orderStatus.mockResolvedValue({
      status: "pending",
      feature: silver.feature,
    });
    shop.returnFromCheckout("order-0001", "success");
    expect(shop.awaiting).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(shop.awaiting).toBe(silver.feature);
    grant(silver.feature);
    await vi.advanceTimersByTimeAsync(3000);
    expect(shop.phase).toBe("success");
  });

  it("a cancelled payment is calm and final, and the product can be bought again", async () => {
    const { shop, fetchProfile, startCheckout } = setup();
    shop.returnFromCheckout("order-0001", "cancel");
    expect(shop.phase).toBe("cancelled");
    expect(shop.busy).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchProfile).not.toHaveBeenCalled();
    await shop.buy(silver);
    expect(startCheckout).toHaveBeenCalled();
  });

  it("a failure hint is checked with the order: not paid means failed", async () => {
    const { shop, orderStatus } = setup();
    orderStatus.mockResolvedValue({
      status: "failed",
      feature: silver.feature,
    });
    shop.returnFromCheckout("order-0001", "failure");
    await vi.advanceTimersByTimeAsync(0);
    expect(shop.phase).toBe("failed");
  });

  it("a failure hint on an order that was paid keeps waiting for the grant", async () => {
    const { shop, orderStatus, grant, pending } = setup();
    pending.save({ productKey: silver.key, feature: silver.feature });
    orderStatus.mockResolvedValue({ status: "paid", feature: silver.feature });
    shop.returnFromCheckout("order-0001", "failure");
    await vi.advanceTimersByTimeAsync(0);
    expect(shop.phase).toBe("processing");
    grant(silver.feature);
    await vi.advanceTimersByTimeAsync(3000);
    expect(shop.phase).toBe("success");
  });

  it("an order reported failed while processing ends the wait", async () => {
    const { shop, orderStatus, pending } = setup();
    pending.save({ productKey: silver.key, feature: silver.feature });
    shop.returnFromCheckout("order-0001", "success");
    orderStatus.mockResolvedValue({
      status: "failed",
      feature: silver.feature,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(shop.phase).toBe("failed");
  });

  it("stops polling after 2 minutes and says it is still processing", async () => {
    const { shop, fetchProfile, pending } = setup();
    pending.save({ productKey: silver.key, feature: silver.feature });
    shop.returnFromCheckout("order-0001", "success");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(shop.phase).toBe("slow");
    const calls = fetchProfile.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(39);
    expect(calls).toBeLessThanOrEqual(40);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchProfile).toHaveBeenCalledTimes(calls);
  });

  it("is done at once when the feature is already there", () => {
    const { shop, session, pending } = setup();
    session.setProfile({ ...profile, features: [silver.feature] });
    pending.save({ productKey: silver.key, feature: silver.feature });
    shop.returnFromCheckout("order-0001", "success");
    expect(shop.phase).toBe("success");
  });

  it("a checkout without a page to visit waits for the grant directly", async () => {
    const { shop, grant } = setup({
      startCheckout: async () => ({ kind: "pending" }),
    });
    await shop.buy(silver);
    expect(shop.phase).toBe("processing");
    grant(silver.feature);
    await vi.advanceTimersByTimeAsync(3000);
    expect(shop.phase).toBe("success");
  });
});

describe("ShopStore: cosmetics and currencies", () => {
  it("lists the currencies products are priced in", () => {
    const { shop } = setup();
    expect(shop.currencies).toEqual(["RUB", "USD"]);
    shop.setCurrency("EUR");
    // No EUR price: the first price is used.
    expect(shop.priceOf(silver)?.money.currency).toBe("RUB");
  });

  it("equips a cosmetic and takes the profile the server returns", async () => {
    const equipped = {
      ...profile,
      features: [silver.feature],
      cosmetics: {
        equipped: {
          ships: "silver" as const,
          hitEffect: "flame" as const,
          theme: "day" as const,
        },
        effective: {
          ships: "silver" as const,
          hitEffect: "flame" as const,
          theme: "day" as const,
        },
      },
    };
    const { shop, session } = setup({
      equip: async () => ({ ok: true, profile: equipped }),
    });
    await shop.equip("ships", "silver");
    expect(session.cosmetics.ships).toBe("silver");
    expect(shop.equipping).toBeNull();
  });
});
