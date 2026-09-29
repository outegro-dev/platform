import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/lib/payments/model";
import {
  OrderWatchStore,
  POLL_INTERVAL_MS,
  POLL_WINDOW_MS,
  type WatchResponse,
} from "./order-watch-store";

const pending: Order = {
  id: "6f1c2c8e-8d2a-4a57-9d8e-2f1f8f0d3a11",
  productKey: "battleship-premium",
  title: { en: "Battleship Premium", ru: "Морской бой Premium" },
  kind: "subscription",
  status: "pending",
  money: { minor: "5000", currency: "RUB", scale: 2 },
  createdAt: "2026-09-29T10:00:00.000Z",
  paidAt: null,
  checkout: { state: "ready", paymentUrl: "https://app.lava.top/pay/1" },
  subscriptionId: null,
  access: null,
};
const paidNoAccess: Order = {
  ...pending,
  status: "paid",
  paidAt: "2026-09-29T10:01:00.000Z",
  checkout: { state: "ready", paymentUrl: null },
};
const paid: Order = {
  ...paidNoAccess,
  subscriptionId: "0b9f4c1e-7b1a-4c9e-8a53-0f2c7b0f5e22",
  access: {
    service: "battleship",
    feature: "premium",
    state: "active",
    validFrom: "2026-09-29T10:01:00.000Z",
    validUntil: "2026-11-01T10:01:00.000Z",
  },
};
const failed: Order = {
  ...pending,
  status: "failed",
  checkout: { state: "ready", paymentUrl: null },
};

const ok = (order: Order): WatchResponse => ({ status: "ok", order });

/** A load() that answers with the given responses in turn, then repeats the last. */
function answers(...responses: WatchResponse[]) {
  let i = 0;
  return vi.fn(
    async () => responses[Math.min(i++, responses.length - 1)] as WatchResponse,
  );
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-09-29T10:00:30Z") }));
afterEach(() => vi.useRealTimers());

describe("OrderWatchStore", () => {
  it("asks every 3 s until the server settles the order, then stops", async () => {
    const load = answers(ok(pending), ok(pending), ok(paid));
    const store = new OrderWatchStore(pending, { load });
    store.start();
    expect(store.phase).toBe("watching");
    expect(load).not.toHaveBeenCalled();

    await tick(POLL_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenLastCalledWith(pending.id);
    await tick(POLL_INTERVAL_MS);
    expect(store.outcome).toBe("processing");
    await tick(POLL_INTERVAL_MS);
    expect(store.phase).toBe("settled");
    expect(store.outcome).toBe("paid");
    expect(store.order).toEqual(paid);

    await tick(60_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("goes from processing to failed the same way", async () => {
    const store = new OrderWatchStore(pending, {
      load: answers(ok(pending), ok(failed)),
    });
    store.start();
    await tick(2 * POLL_INTERVAL_MS);
    expect(store.phase).toBe("settled");
    expect(store.outcome).toBe("failed");
  });

  it("keeps watching a paid order until its access appears", async () => {
    const load = answers(ok(paidNoAccess), ok(paidNoAccess), ok(paid));
    const store = new OrderWatchStore(pending, { load });
    store.start();
    await tick(POLL_INTERVAL_MS);
    expect(store.outcome).toBe("activating");
    expect(store.phase).toBe("watching");
    await tick(2 * POLL_INTERVAL_MS);
    expect(store.outcome).toBe("paid");
    expect(store.phase).toBe("settled");
  });

  it("gives up after 3 minutes and lets the user check again", async () => {
    const load = answers(ok(pending));
    const store = new OrderWatchStore(pending, { load });
    store.start();
    await tick(POLL_WINDOW_MS);
    expect(store.phase).toBe("timed-out");
    expect(load).toHaveBeenCalledTimes(POLL_WINDOW_MS / POLL_INTERVAL_MS);

    await tick(60_000);
    expect(load).toHaveBeenCalledTimes(POLL_WINDOW_MS / POLL_INTERVAL_MS);

    load.mockResolvedValue(ok(paid));
    store.checkAgain();
    expect(store.phase).toBe("watching");
    await tick(0);
    expect(store.phase).toBe("settled");
  });

  it("rides out an outage and says it is retrying", async () => {
    const load = answers(
      { status: "unavailable" },
      { status: "unavailable" },
      ok(paid),
    );
    const store = new OrderWatchStore(pending, { load });
    store.start();
    await tick(POLL_INTERVAL_MS);
    expect(store.trouble).toBe("retrying");
    expect(store.phase).toBe("watching");
    await tick(2 * POLL_INTERVAL_MS);
    expect(store.trouble).toBe("none");
    expect(store.phase).toBe("settled");
  });

  it("treats a failing request like an outage", async () => {
    const load = vi.fn(async (): Promise<WatchResponse> => {
      throw new Error("network");
    });
    const store = new OrderWatchStore(pending, { load });
    store.start();
    await tick(POLL_INTERVAL_MS);
    expect(store.trouble).toBe("retrying");
    expect(store.phase).toBe("watching");
  });

  it.each([
    [{ status: "signed-out" } as const, "signed-out"],
    [{ status: "not-found" } as const, "gone"],
  ])("ends the watch on %o", async (response, phase) => {
    const load = answers(response);
    const store = new OrderWatchStore(pending, { load });
    store.start();
    await tick(10 * POLL_INTERVAL_MS);
    expect(store.phase).toBe(phase);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("words an abandoned order as unpaid until the server says otherwise", async () => {
    const store = new OrderWatchStore(pending, {
      load: answers(ok(pending), ok(paid)),
      stalePending: true,
    });
    expect(store.outcome).toBe("unpaid");
    store.start();
    await tick(POLL_INTERVAL_MS);
    expect(store.outcome).toBe("unpaid");
    await tick(POLL_INTERVAL_MS);
    expect(store.outcome).toBe("paid");
  });

  it("does not poll an order that is already settled", async () => {
    const load = answers(ok(paid));
    const store = new OrderWatchStore(paid, { load });
    store.start();
    expect(store.phase).toBe("settled");
    await tick(30_000);
    expect(load).not.toHaveBeenCalled();
  });

  it("pauses while offline and asks at once when back", async () => {
    const load = answers(ok(pending));
    const store = new OrderWatchStore(pending, { load });
    store.start();
    store.setOnline(false);
    expect(store.trouble).toBe("offline");
    await tick(30_000);
    expect(load).not.toHaveBeenCalled();
    store.setOnline(true);
    await tick(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.trouble).toBe("none");
  });

  it("ignores an answer that arrives after it was stopped", async () => {
    let resolve: (value: WatchResponse) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<WatchResponse>((done) => {
          resolve = done;
        }),
    );
    const store = new OrderWatchStore(pending, { load });
    store.start();
    await tick(POLL_INTERVAL_MS);
    store.stop();
    resolve(ok(paid));
    await tick(0);
    expect(store.order).toBe(pending);
    expect(store.phase).toBe("idle");
    await tick(30_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("restarts cleanly after an unmount and remount", async () => {
    const load = answers(ok(pending));
    const store = new OrderWatchStore(pending, { load });
    store.start();
    store.stop();
    store.start();
    await tick(POLL_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
