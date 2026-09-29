import { describe, expect, it, vi } from "vitest";
import type { CheckoutInput, CheckoutOutcome } from "@/lib/payments/model";
import { CheckoutStore, type KeyVault } from "./checkout-store";

const ORDER = "6f1c2c8e-8d2a-4a57-9d8e-2f1f8f0d3a11";
const PAGE = "https://app.lava.top/pay/inv-1";

function setup(
  outcomes: CheckoutOutcome[],
  options: { online?: boolean } = {},
) {
  const stored = new Map<string, string>();
  const keys: KeyVault = {
    get: (scope) => stored.get(scope) ?? null,
    set: (scope, key) => void stored.set(scope, key),
    clear: (scope) => void stored.delete(scope),
  };
  let n = 0;
  let i = 0;
  const start = vi.fn(
    async (_input: CheckoutInput) =>
      outcomes[Math.min(i++, outcomes.length - 1)] as CheckoutOutcome,
  );
  const navigate = vi.fn();
  const openOrder = vi.fn();
  const store = new CheckoutStore(
    { key: "battleship-premium", currencies: ["EUR", "RUB", "USD"] },
    "RUB",
    {
      start,
      keys,
      newKey: () => `pw-key-${++n}`,
      navigate,
      openOrder,
      wait: async () => {},
      isOnline: () => options.online ?? true,
    },
  );
  const keysUsed = () =>
    start.mock.calls.map(([input]) => input.idempotencyKey);
  return { store, start, navigate, openOrder, stored, keysUsed };
}

describe("CheckoutStore", () => {
  it("sends only intent and goes to the approved payment page", async () => {
    const t = setup([{ kind: "redirect", orderId: ORDER, url: PAGE }]);
    await t.store.buy();
    expect(t.start).toHaveBeenCalledWith({
      productKey: "battleship-premium",
      currency: "RUB",
      idempotencyKey: "pw-key-1",
    });
    expect(t.navigate).toHaveBeenCalledWith(PAGE);
    expect(t.store.status).toBe("redirecting");
    // Kept: buying again after an unpaid Lava page reaches the same order.
    expect(t.stored.get("battleship-premium:RUB")).toBe("pw-key-1");
  });

  it("retries with the same key after an outage, so no second order appears", async () => {
    const t = setup([
      { kind: "unavailable" },
      { kind: "redirect", orderId: ORDER, url: PAGE },
    ]);
    await t.store.buy();
    expect(t.store.problem).toBe("unavailable");
    expect(t.store.status).toBe("idle");
    await t.store.buy();
    expect(t.keysUsed()).toEqual(["pw-key-1", "pw-key-1"]);
    expect(t.navigate).toHaveBeenCalledWith(PAGE);
  });

  it("asks again with the same key while the invoice is being created", async () => {
    const t = setup([
      { kind: "preparing", orderId: ORDER },
      { kind: "preparing", orderId: ORDER },
      { kind: "redirect", orderId: ORDER, url: PAGE },
    ]);
    await t.store.buy();
    expect(t.keysUsed()).toEqual(["pw-key-1", "pw-key-1", "pw-key-1"]);
    expect(t.navigate).toHaveBeenCalledWith(PAGE);
  });

  it("says the page is taking a while and points to the saved order", async () => {
    const t = setup([{ kind: "preparing", orderId: ORDER }]);
    await t.store.buy();
    expect(t.start).toHaveBeenCalledTimes(4);
    expect(t.store.problem).toBe("slow");
    expect(t.store.orderId).toBe(ORDER);
    expect(t.navigate).not.toHaveBeenCalled();
  });

  it("uses one fresh key when the old one belonged to other input", async () => {
    const t = setup([
      { kind: "conflict" },
      { kind: "redirect", orderId: ORDER, url: PAGE },
    ]);
    await t.store.buy();
    expect(t.keysUsed()).toEqual(["pw-key-1", "pw-key-2"]);
    expect(t.navigate).toHaveBeenCalled();
  });

  it("starts over with a new key after a refused payment", async () => {
    const t = setup([
      { kind: "failed", orderId: ORDER },
      { kind: "redirect", orderId: ORDER, url: PAGE },
    ]);
    await t.store.buy();
    expect(t.store.problem).toBe("failed");
    await t.store.buy();
    expect(t.keysUsed()).toEqual(["pw-key-1", "pw-key-2"]);
  });

  it("opens the order when the same key already paid", async () => {
    const t = setup([{ kind: "paid", orderId: ORDER }]);
    await t.store.buy();
    expect(t.openOrder).toHaveBeenCalledWith(ORDER);
    expect(t.navigate).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "owned" } as const, "owned"],
    [{ kind: "closed" } as const, "closed"],
    [{ kind: "gone" } as const, "gone"],
    [{ kind: "blocked", orderId: ORDER } as const, "blocked"],
    [{ kind: "unauthorized" } as const, "signedOut"],
  ])("explains %o", async (outcome, problem) => {
    const t = setup([outcome]);
    await t.store.buy();
    expect(t.store.problem).toBe(problem);
    expect(t.navigate).not.toHaveBeenCalled();
  });

  it("does nothing while offline", async () => {
    const t = setup([{ kind: "redirect", orderId: ORDER, url: PAGE }], {
      online: false,
    });
    await t.store.buy();
    expect(t.start).not.toHaveBeenCalled();
    expect(t.store.problem).toBe("offline");
  });

  it("keeps separate keys per currency and locks the choice while busy", async () => {
    const t = setup([{ kind: "unavailable" }]);
    t.store.selectCurrency("USD");
    expect(t.store.currency).toBe("USD");
    t.store.selectCurrency("GBP");
    expect(t.store.currency).toBe("USD");
    const running = t.store.buy();
    t.store.selectCurrency("EUR");
    expect(t.store.currency).toBe("USD");
    await running;
    expect(t.stored.get("battleship-premium:USD")).toBe("pw-key-1");
    expect(t.stored.has("battleship-premium:RUB")).toBe(false);
  });

  it("is usable again after coming back with the back button", async () => {
    const t = setup([{ kind: "redirect", orderId: ORDER, url: PAGE }]);
    await t.store.buy();
    expect(t.store.busy).toBe(true);
    t.store.resumeAfterReturn();
    expect(t.store.busy).toBe(false);
  });
});
