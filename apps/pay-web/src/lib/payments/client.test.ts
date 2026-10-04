import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentsClient } from "./client";

const ORDER_ID = "6f1c2c8e-8d2a-4a57-9d8e-2f1f8f0d3a11";
const SUB_ID = "0b9f4c1e-7b1a-4c9e-8a53-0f2c7b0f5e22";

/** An order exactly as payments-backend's orderView serializes it. */
const wireOrder = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  productKey: "battleship-premium",
  title: { en: "Battleship Premium", ru: "Морской бой Premium" },
  kind: "subscription",
  status: "paid",
  money: { minor: "5000", currency: "RUB", scale: 2 },
  priceVersion: 1,
  createdAt: "2026-09-01T10:00:00.000Z",
  paidAt: "2026-09-01T10:02:00.000Z",
  checkout: { state: "ready", paymentUrl: null },
  subscriptionId: SUB_ID,
  access: {
    id: "a1d6c0f2-3b4c-4d5e-8f90-1a2b3c4d5e6f",
    userId: "u",
    service: "battleship",
    feature: "premium",
    sourceType: "subscription",
    sourceId: SUB_ID,
    state: "active",
    validFrom: "2026-09-01T10:02:00.000Z",
    validUntil: "2026-10-04T10:02:00.000Z",
    version: 3,
  },
  ...overrides,
});

const wireSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: SUB_ID,
  orderId: ORDER_ID,
  productKey: "battleship-premium",
  title: { en: "Battleship Premium", ru: "Морской бой Premium" },
  state: "active",
  autoRenew: true,
  paidUntil: "2026-10-01T10:02:00.000Z",
  accessUntil: "2026-10-04T10:02:00.000Z",
  money: { minor: "59", currency: "USD", scale: 2 },
  periodicity: "MONTHLY",
  cancelRequestedAt: null,
  cancelledAt: null,
  expiredAt: null,
  createdAt: "2026-09-01T10:02:00.000Z",
  ...overrides,
});

const errorBody = (
  code: string,
  fieldErrors: Record<string, string[]> = {},
) => ({
  error: {
    code,
    messageKey: "x",
    fieldErrors,
    requestId: "r",
    retryable: false,
  },
});

type Call = [string, RequestInit];
const calls = () =>
  (fetch as unknown as { mock: { calls: Call[] } }).mock.calls;

function respond(status: number, body?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
        }),
    ),
  );
}

const logger = { warn: vi.fn(), error: vi.fn() };
const client = (
  checkoutOrigins: string[] = ["https://app.lava.top"],
  returnUrl?: string,
) =>
  new PaymentsClient({
    baseUrl: "http://payments.internal",
    checkoutOrigins,
    ...(returnUrl ? { returnUrl } : {}),
    headers: () => ({ "user-agent": "test" }),
    logger,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  logger.warn.mockReset();
  logger.error.mockReset();
});

describe("reads", () => {
  it("maps the order list and passes the page", async () => {
    respond(200, { items: [wireOrder()], nextCursor: "abc" });
    const result = await client().orders("token", { cursor: "c1", limit: 20 });
    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: ORDER_ID,
            productKey: "battleship-premium",
            title: { en: "Battleship Premium", ru: "Морской бой Premium" },
            kind: "subscription",
            status: "paid",
            money: { minor: "5000", currency: "RUB", scale: 2 },
            createdAt: "2026-09-01T10:00:00.000Z",
            paidAt: "2026-09-01T10:02:00.000Z",
            checkout: { state: "ready", paymentUrl: null },
            subscriptionId: SUB_ID,
            access: {
              service: "battleship",
              feature: "premium",
              state: "active",
              validFrom: "2026-09-01T10:02:00.000Z",
              validUntil: "2026-10-04T10:02:00.000Z",
            },
          },
        ],
        nextCursor: "abc",
      },
    });
    const [url, init] = calls()[0] as Call;
    expect(url).toBe(
      "http://payments.internal/v1/me/orders?cursor=c1&limit=20",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token");
    expect(headers["user-agent"]).toBe("test");
  });

  it("reads unknown statuses as unknown instead of guessing", async () => {
    respond(200, {
      items: [
        wireOrder({
          status: "chargeback_pending",
          kind: "bundle",
          checkout: { state: "cancelled", paymentUrl: null },
          access: null,
        }),
      ],
      nextCursor: null,
    });
    const result = await client().orders("token");
    expect(result.ok && result.data.items[0]).toMatchObject({
      status: "unknown",
      kind: "unknown",
      checkout: { state: "unknown" },
    });
  });

  it("treats an answer outside the contract as an outage, not as empty", async () => {
    respond(200, {
      items: [
        wireOrder({ money: { minor: "0.5", currency: "RUB", scale: 2 } }),
      ],
    });
    expect(await client().orders("token")).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it.each([
    [401, errorBody("UNAUTHENTICATED"), "unauthorized"],
    [404, errorBody("NOT_FOUND"), "not-found"],
    [400, errorBody("VALIDATION_FAILED", { cursor: ["invalid"] }), "invalid"],
    [429, errorBody("RATE_LIMITED"), "unavailable"],
    [503, errorBody("DEPENDENCY_UNAVAILABLE"), "unavailable"],
    [502, undefined, "unavailable"],
  ])("maps HTTP %i to %s", async (status, body, error) => {
    respond(status, body);
    expect(await client().order("token", ORDER_ID)).toEqual({
      ok: false,
      error,
    });
  });

  it("maps a timeout or refused connection to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await client().subscriptions("token")).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("does not ask for ids that cannot exist", async () => {
    respond(200, wireOrder());
    expect(await client().order("token", "../admin")).toEqual({
      ok: false,
      error: "not-found",
    });
    expect(calls()).toHaveLength(0);
  });

  it("maps subscriptions, keeping unknown states unknown", async () => {
    respond(200, {
      items: [
        wireSubscription(),
        wireSubscription({ state: "paused_by_provider" }),
      ],
      nextCursor: null,
    });
    const result = await client().subscriptions("token", { limit: 50 });
    expect(result.ok && result.data.items.map((s) => s.state)).toEqual([
      "active",
      "unknown",
    ]);
    expect(result.ok && result.data.items[0]).toMatchObject({
      accessUntil: "2026-10-04T10:02:00.000Z",
      periodicity: "MONTHLY",
      money: { minor: "59", currency: "USD", scale: 2 },
    });
  });

  it("maps the public catalog without a token", async () => {
    respond(200, {
      checkoutEnabled: true,
      products: [
        {
          key: "battleship-silver-fleet",
          service: "battleship",
          feature: "cosmetics.silver-fleet",
          kind: "one_time",
          periodicity: "ONE_TIME",
          graceDays: 0,
          title: { en: "Silver Fleet", ru: "Серебряный флот" },
          description: { en: "Silver ships", ru: "Серебряные корабли" },
          prices: [
            {
              priceId: "p1",
              version: 2,
              money: { minor: "52", currency: "EUR", scale: 2 },
            },
          ],
        },
      ],
    });
    const result = await client().catalog();
    expect(result).toEqual({
      ok: true,
      data: {
        checkoutEnabled: true,
        products: [
          {
            key: "battleship-silver-fleet",
            service: "battleship",
            feature: "cosmetics.silver-fleet",
            kind: "one_time",
            periodicity: "ONE_TIME",
            graceDays: 0,
            title: { en: "Silver Fleet", ru: "Серебряный флот" },
            description: { en: "Silver ships", ru: "Серебряные корабли" },
            prices: [
              {
                priceId: "p1",
                money: { minor: "52", currency: "EUR", scale: 2 },
              },
            ],
          },
        ],
      },
    });
    const headers = (calls()[0] as Call)[1].headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("keeps every app's products, reading a period or kind it does not know as unknown", async () => {
    const sold = (key: string, service: string, overrides = {}) => ({
      key,
      service,
      feature: "books.all",
      kind: "subscription",
      periodicity: "MONTHLY",
      graceDays: 3,
      title: { en: key, ru: key },
      description: { en: "", ru: "" },
      prices: [
        {
          priceId: `${key}-rub`,
          money: { minor: "5000", currency: "RUB", scale: 2 },
        },
      ],
      ...overrides,
    });
    respond(200, {
      checkoutEnabled: true,
      products: [
        sold("edu-weekly", "edu", { periodicity: "WEEKLY" }),
        sold("edu-yearly", "edu", { periodicity: "PERIOD_YEAR" }),
        sold("assistant-bundle", "assistant", { kind: "bundle" }),
      ],
    });
    const result = await client().catalog();
    expect(
      result.ok &&
        result.data.products.map((p) => [
          p.key,
          p.service,
          p.kind,
          p.periodicity,
        ]),
    ).toEqual([
      ["edu-weekly", "edu", "subscription", "unknown"],
      ["edu-yearly", "edu", "subscription", "PERIOD_YEAR"],
      ["assistant-bundle", "assistant", "unknown", "MONTHLY"],
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("cancelSubscription", () => {
  it("returns the state the server decided", async () => {
    respond(
      200,
      wireSubscription({
        state: "cancel_requested",
        cancelRequestedAt: "2026-09-29T08:00:00.000Z",
      }),
    );
    const outcome = await client().cancelSubscription("token", SUB_ID);
    expect(outcome.kind === "ok" && outcome.subscription.state).toBe(
      "cancel_requested",
    );
    const [url, init] = calls()[0] as Call;
    expect(url).toBe(
      `http://payments.internal/v1/me/subscriptions/${SUB_ID}/cancel`,
    );
    expect(init.method).toBe("POST");
  });

  it.each([
    [404, "not-found"],
    [401, "unauthorized"],
    [503, "unavailable"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    respond(status, errorBody("X"));
    expect(await client().cancelSubscription("token", SUB_ID)).toEqual({
      kind,
    });
  });
});

describe("checkout", () => {
  const input = {
    productKey: "battleship-premium",
    currency: "RUB",
    idempotencyKey: "pw-0f8c1d2e-3a4b-4c5d-8e9f-001122334455",
  };
  const answer = (overrides: Record<string, unknown> = {}) => ({
    orderId: ORDER_ID,
    attemptId: "a",
    state: "ready",
    status: "pending",
    paymentUrl: "https://app.lava.top/pay/inv-1",
    ...overrides,
  });

  it("sends intent only, with the key; buyers return to /checkout/result", async () => {
    respond(200, answer());
    const outcome = await client().checkout("token", input);
    expect(outcome).toEqual({
      kind: "redirect",
      orderId: ORDER_ID,
      url: "https://app.lava.top/pay/inv-1",
    });
    const [url, init] = calls()[0] as Call;
    expect(url).toBe("http://payments.internal/v1/checkout");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token");
    expect(headers["idempotency-key"]).toBe(input.idempotencyKey);
    // No returnUrl: the backend's default is PAY_WEB_URL/checkout/result.
    expect(JSON.parse(String(init.body))).toEqual({
      productKey: "battleship-premium",
      currency: "RUB",
    });
  });

  it("passes a configured return address", async () => {
    respond(200, answer());
    await client(
      ["https://app.lava.top"],
      "https://pay.outegro.dev/checkout/result",
    ).checkout("token", input);
    expect(JSON.parse(String((calls()[0] as Call)[1].body)).returnUrl).toBe(
      "https://pay.outegro.dev/checkout/result",
    );
  });

  it.each([
    ["http://app.lava.top/pay/1", "plain http"],
    ["https://evil.example/pay/1", "an origin not on the list"],
    ["https://user:pass@app.lava.top/pay/1", "credentials in the URL"],
    ["javascript:alert(1)", "a script URL"],
  ])("never follows %s (%s)", async (paymentUrl) => {
    respond(200, answer({ paymentUrl }));
    expect(await client().checkout("token", input)).toEqual({
      kind: "blocked",
      orderId: ORDER_ID,
    });
  });

  it("blocks every payment page when no origin is configured", async () => {
    respond(200, answer());
    const payments = client([]);
    expect(payments.checkoutConfigured).toBe(false);
    expect((await payments.checkout("token", input)).kind).toBe("blocked");
  });

  it.each([
    [
      { state: "requesting", paymentUrl: null },
      { kind: "preparing", orderId: ORDER_ID },
    ],
    [
      { state: "unknown", paymentUrl: null },
      { kind: "preparing", orderId: ORDER_ID },
    ],
    [
      { state: "failed", status: "failed", paymentUrl: null },
      { kind: "failed", orderId: ORDER_ID },
    ],
    [
      { state: "ready", status: "paid", paymentUrl: null },
      { kind: "paid", orderId: ORDER_ID },
    ],
  ])("maps %o", async (overrides, expected) => {
    respond(200, answer(overrides));
    expect(await client().checkout("token", input)).toEqual(expected);
  });

  it.each([
    [
      422,
      errorBody("ALREADY_OWNED", { productKey: ["already subscribed"] }),
      "owned",
    ],
    [
      422,
      errorBody("ALREADY_OWNED", { productKey: ["already owned"] }),
      "owned",
    ],
    // Only the code means "owned"; a field name alone does not.
    [422, errorBody("UNPROCESSABLE", { productKey: ["not offered"] }), "gone"],
    [
      422,
      errorBody("UNPROCESSABLE", { checkout: ["sales are closed"] }),
      "closed",
    ],
    [422, errorBody("UNPROCESSABLE", { currency: ["not offered"] }), "gone"],
    [404, errorBody("NOT_FOUND"), "gone"],
    [409, errorBody("IDEMPOTENCY_CONFLICT"), "conflict"],
    [401, errorBody("UNAUTHENTICATED"), "unauthorized"],
    [503, errorBody("DEPENDENCY_UNAVAILABLE"), "unavailable"],
  ])("maps HTTP %i to %s", async (status, body, kind) => {
    respond(status, body);
    expect(await client().checkout("token", input)).toEqual({ kind });
  });

  it("refuses a malformed key before calling", async () => {
    respond(200, answer());
    expect(
      await client().checkout("token", { ...input, idempotencyKey: "short" }),
    ).toEqual({ kind: "conflict" });
    expect(calls()).toHaveLength(0);
  });
});
