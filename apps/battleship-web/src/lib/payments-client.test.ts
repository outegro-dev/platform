import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentsClient } from "./payments-client";

const client = (baseUrl: string | null = "http://payments.internal") =>
  new PaymentsClient({
    baseUrl: baseUrl ?? undefined,
    appUrl: "https://battleship.outegro.dev",
    checkoutOrigins: ["https://checkout.lava.ru"],
    logger: { warn: vi.fn(), error: vi.fn() },
  });

const respond = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

const calls = () =>
  (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;

const product = (key: string, feature: string, service = "battleship") => ({
  key,
  service,
  feature,
  kind: feature === "premium" ? "subscription" : "one_time",
  periodicity: feature === "premium" ? "MONTHLY" : "ONE_TIME",
  graceDays: 3,
  title: { en: `${key} en`, ru: `${key} ru` },
  description: { en: "desc", ru: "описание" },
  prices: [
    {
      priceId: `${key}-rub`,
      version: 1,
      money: { minor: "5000", currency: "RUB", scale: 2 },
    },
    {
      priceId: `${key}-usd`,
      version: 1,
      money: { minor: "59", currency: "USD", scale: 2 },
    },
    {
      priceId: `${key}-eur`,
      version: 1,
      money: { minor: "52", currency: "EUR", scale: 2 },
    },
  ],
});

const request = {
  productKey: "battleship-silver-fleet",
  currency: "RUB" as const,
  reference: "bs-6f1c1c8e-7a53-4c32-9a55-1d2b3c4d5e6f",
  accessToken: "token",
};

afterEach(() => vi.unstubAllGlobals());

describe("PaymentsClient", () => {
  it("reads an order's status and the feature it grants", async () => {
    respond(200, {
      orderId: "0b9f7c3e-1111-4222-8333-444455556666",
      status: "PAID",
      productKey: "battleship-silver-fleet",
    });
    expect(
      await client().order("0b9f7c3e-1111-4222-8333-444455556666", "token"),
    ).toEqual({ status: "paid", feature: "cosmetics.silver-fleet" });
    expect(calls()[0]?.[0]).toBe(
      "http://payments.internal/v1/me/orders/0b9f7c3e-1111-4222-8333-444455556666",
    );
    respond(200, { status: "failed", feature: "premium" });
    expect(await client().order("0b9f7c3e-aaaa", "token")).toEqual({
      status: "failed",
      feature: "premium",
    });
    respond(200, { status: "awaiting_payment" });
    expect(await client().order("0b9f7c3e-aaaa", "token")).toEqual({
      status: "pending",
      feature: null,
    });
  });

  it("an unknown or unreachable order is null, and odd ids are not sent", async () => {
    respond(404, {
      error: {
        code: "NOT_FOUND",
        messageKey: "x",
        fieldErrors: {},
        requestId: "r",
        retryable: false,
      },
    });
    expect(await client().order("0b9f7c3e-aaaa", "token")).toBeNull();
    respond(200, {});
    expect(await client().order("../../admin", "token")).toBeNull();
    expect(calls()).toHaveLength(0);
  });

  it("says the shop is not wired when there is no payments URL", async () => {
    const payments = client(null);
    expect(payments.configured).toBe(false);
    expect(await payments.catalog("en")).toEqual({
      status: "unconfigured",
      checkoutEnabled: false,
      products: [],
    });
  });

  it("reads the public catalog, keeps the game's products and localizes them", async () => {
    respond(200, {
      checkoutEnabled: true,
      products: [
        product("battleship-premium", "premium"),
        product("battleship-silver-fleet", "cosmetics.silver-fleet"),
        product("assistant-pro", "pro", "assistant"),
      ],
    });
    const catalog = await client().catalog("ru");
    expect(calls()[0]?.[0]).toBe("http://payments.internal/v1/catalog");
    expect(catalog.status).toBe("ok");
    expect(catalog.checkoutEnabled).toBe(true);
    expect(catalog.products.map((p) => p.key)).toEqual([
      "battleship-premium",
      "battleship-silver-fleet",
    ]);
    expect(catalog.products[0]?.title).toBe("battleship-premium ru");
    expect(catalog.products[0]?.prices.map((p) => p.money.currency)).toEqual([
      "RUB",
      "USD",
      "EUR",
    ]);
  });

  it("passes on that purchases are not open yet", async () => {
    respond(200, {
      checkoutEnabled: false,
      products: [product("battleship-premium", "premium")],
    });
    const catalog = await client().catalog("en");
    expect(catalog.checkoutEnabled).toBe(false);
    expect(catalog.products).toHaveLength(1);
  });

  it("treats a malformed catalog or an outage as unavailable", async () => {
    respond(200, { products: [{ key: 1 }] });
    expect((await client().catalog("en")).status).toBe("unavailable");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("down"))),
    );
    expect((await client().catalog("en")).status).toBe("unavailable");
  });

  it("starts a checkout with the reference as Idempotency-Key and a strict body", async () => {
    respond(200, {
      orderId: "o1",
      attemptId: "a1",
      state: "pending",
      status: "awaiting_payment",
      paymentUrl: "https://checkout.lava.ru/pay/o1",
    });
    expect(await client().checkout(request)).toEqual({
      kind: "redirect",
      url: "https://checkout.lava.ru/pay/o1",
    });
    const [url, init] = calls()[0] ?? [];
    expect(url).toBe("http://payments.internal/v1/checkout");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token");
    expect(headers["idempotency-key"]).toBe(request.reference);
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual([
      "currency",
      "productKey",
      "returnUrl",
    ]);
    expect(body.productKey).toBe("battleship-silver-fleet");
    expect(body.currency).toBe("RUB");
    // Payments appends ?orderId=…&result=… itself: the return URL is just the shop.
    expect(body.returnUrl).toBe("https://battleship.outegro.dev/shop");
  });

  it("asks to retry while the payment page is being prepared", async () => {
    respond(200, {
      orderId: "o1",
      attemptId: null,
      state: "requesting",
      status: "new",
      paymentUrl: null,
    });
    expect(await client().checkout(request)).toEqual({ kind: "preparing" });
    respond(200, {
      orderId: "o1",
      attemptId: null,
      state: "unknown",
      status: "new",
      paymentUrl: null,
    });
    expect(await client().checkout(request)).toEqual({ kind: "preparing" });
  });

  it("waits for the grant when the order needs no page, and fails on a dead order", async () => {
    respond(200, {
      orderId: "o1",
      attemptId: "a1",
      state: "paid",
      status: "paid",
      paymentUrl: null,
    });
    expect(await client().checkout(request)).toEqual({ kind: "pending" });
    respond(200, {
      orderId: "o1",
      attemptId: "a1",
      state: "failed",
      status: "failed",
      paymentUrl: null,
    });
    expect(await client().checkout(request)).toEqual({
      kind: "error",
      reason: "rejected",
    });
  });

  it("never redirects to plain http or to an origin that is not allowed", async () => {
    const payments = client();
    expect(payments.isAllowedPaymentUrl("https://checkout.lava.ru/pay/1")).toBe(
      true,
    );
    expect(payments.isAllowedPaymentUrl("http://checkout.lava.ru/pay/1")).toBe(
      false,
    );
    expect(
      payments.isAllowedPaymentUrl("https://checkout.lava.ru.evil.test/"),
    ).toBe(false);
    expect(
      payments.isAllowedPaymentUrl("https://user:pw@checkout.lava.ru/"),
    ).toBe(false);
    expect(payments.isAllowedPaymentUrl("javascript:alert(1)")).toBe(false);
    respond(200, {
      orderId: "o1",
      attemptId: "a",
      state: "pending",
      status: "x",
      paymentUrl: "https://evil.test/pay",
    });
    expect(await payments.checkout(request)).toEqual({
      kind: "error",
      reason: "blocked",
    });
  });

  it("refuses a malformed reference without calling payments", async () => {
    respond(200, {});
    expect(await client().checkout({ ...request, reference: "short" })).toEqual(
      {
        kind: "error",
        reason: "rejected",
      },
    );
    expect(calls()).toHaveLength(0);
  });

  it("maps ALREADY_OWNED to owned, other refusals and outages to errors", async () => {
    const error = (code: string) => ({
      error: {
        code,
        messageKey: "x",
        fieldErrors: {},
        requestId: "r",
        retryable: false,
      },
    });
    respond(422, error("ALREADY_OWNED"));
    expect(await client().checkout(request)).toEqual({ kind: "owned" });
    // Another 422 (sales closed, no verified email) is a refusal, not "owned".
    respond(422, error("UNPROCESSABLE"));
    expect(await client().checkout(request)).toEqual({
      kind: "error",
      reason: "rejected",
    });
    respond(401, error("UNAUTHENTICATED"));
    expect(await client().checkout(request)).toEqual({
      kind: "error",
      reason: "unauthorized",
    });
    respond(409, error("IDEMPOTENCY_CONFLICT"));
    expect(await client().checkout(request)).toEqual({
      kind: "error",
      reason: "rejected",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("down"))),
    );
    expect(await client().checkout(request)).toEqual({
      kind: "error",
      reason: "unavailable",
    });
  });
});
