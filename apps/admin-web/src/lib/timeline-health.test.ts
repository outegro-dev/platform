import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail } from "./adapters/payments";
import { probe, readTerminus } from "./health";
import { orderTimeline } from "./order-timeline";

describe("order timeline", () => {
  it("tells the story oldest first with both times of provider facts", () => {
    const money = { minor: "5000", currency: "RUB", scale: 2 };
    const detail: OrderDetail = {
      order: {
        id: "o1",
        userId: "u1",
        productKey: "battleship-premium",
        title: { en: "Battleship Premium", ru: "Морской бой Premium" },
        kind: "subscription",
        status: "paid",
        money,
        priceVersion: 1,
        createdAt: "2026-09-01T10:00:00.000Z",
        paidAt: "2026-09-01T10:03:00.000Z",
        checkout: null,
        subscriptionId: "s1",
        access: null,
        correlationId: "c1",
      },
      attempt: {
        id: "a1",
        state: "ready",
        providerInvoiceId: "inv",
        failureReason: null,
        checks: 0,
        nextCheckAt: null,
        requestedAt: "2026-09-01T10:00:01.000Z",
        resolvedAt: "2026-09-01T10:03:00.000Z",
      },
      payments: [
        {
          id: "p1",
          orderId: "o1",
          subscriptionId: "s1",
          userId: "u1",
          kind: "subscription_initial",
          state: "confirmed",
          money,
          providerContractId: "lava_1",
          paidAt: "2026-09-01T10:02:30.000Z",
          confirmedAt: "2026-09-01T10:02:50.000Z",
        },
      ],
      subscription: null,
      grants: [],
      refunds: [],
      events: [],
      audit: [
        {
          id: "au1",
          actorId: "op",
          action: "subscription.cancel",
          targetType: "subscription",
          targetId: "s1",
          reason: "Asked by the user",
          data: {},
          createdAt: "2026-09-10T08:00:00.000Z",
        },
      ],
    };
    const items = orderTimeline(detail);
    expect(items.map((item) => item.kind)).toEqual([
      "order",
      "attempt",
      "payment",
      "attemptResolved",
      "audit",
    ]);
    const payment = items.find((item) => item.kind === "payment");
    expect(payment?.also).toEqual({
      label: "recorded",
      at: "2026-09-01T10:02:50.000Z",
    });
    expect(items.at(-1)?.detail).toBe("Asked by the user");
  });
});

describe("service health", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads terminus details", () => {
    expect(
      readTerminus({
        status: "error",
        details: {
          postgres: { status: "up" },
          rabbitmq: { status: "down", message: "refused" },
        },
      }),
    ).toEqual([
      { name: "postgres", up: true, message: null },
      { name: "rabbitmq", up: false, message: "refused" },
    ]);
  });

  it("tells up, degraded, down and not configured apart", async () => {
    expect((await probe("payments", undefined)).state).toBe("unconfigured");
    vi.stubGlobal("fetch", async () =>
      Response.json({ status: "ok", details: { postgres: { status: "up" } } }),
    );
    expect((await probe("identity", "http://auth")).state).toBe("up");
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { status: "error", details: { postgres: { status: "down" } } },
        { status: 503 },
      ),
    );
    expect((await probe("identity", "http://auth")).state).toBe("degraded");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const down = await probe("identity", "http://auth");
    expect(down.state).toBe("down");
    expect(down.latencyMs).toBeNull();
  });
});
