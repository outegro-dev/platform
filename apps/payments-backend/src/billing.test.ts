import { randomUUID } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CatalogService } from "./catalog/catalog.service.js";
import type { PaymentsDatabase } from "./common/database.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  billingPeriods,
  checkoutAttempts,
  financialEntries,
  grants,
  orders,
  outbox,
  payments,
  providerEvents,
  reconciliationIssues,
  refunds,
  subscriptions,
} from "./db/schema.js";
import { type CatalogProduct, catalog } from "./domain/catalog.js";
import type { Currency } from "./domain/money.js";
import { addMonthsUtc } from "./domain/periods.js";
import type { FakeInvoice } from "./test/fake-lava.js";
import { customerEvents, type Harness, startHarness } from "./test/harness.js";
import { lavaPayloads } from "./test/lava-payloads.js";
import { ExpiryWorker } from "./workers/expiry.worker.js";
import { ReconciliationWorker } from "./workers/reconciliation.worker.js";

const PREMIUM = "battleship-premium";
const SILVER = "battleship-silver-fleet";
const DAY_MS = 86_400_000;

let h: Harness;
let db: PaymentsDatabase["db"];
let customers: CustomersService;
let reconciliation: ReconciliationWorker;
let expiry: ExpiryWorker;

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<PaymentsDatabase>(DATABASE).db;
  customers = h.app.get(CustomersService);
  reconciliation = h.app.get(ReconciliationWorker);
  expiry = h.app.get(ExpiryWorker);
});
afterAll(() => h?.close());
beforeEach(() => {
  h.clock.set(new Date());
  h.lava.reset();
});

function productOf(key: string): CatalogProduct {
  const found = catalog.find((p) => p.key === key);
  if (!found) throw new Error(`no product ${key}`);
  return found;
}
const newKey = () => `test-${randomUUID()}`;

type Customer = Awaited<ReturnType<typeof newCustomer>>;

async function newCustomer(
  options: { locale?: "en" | "ru"; email?: string; roles?: string[] } = {},
) {
  const userId = randomUUID();
  const email = options.email ?? `buyer.${userId.slice(0, 8)}@example.test`;
  for (const event of customerEvents(userId, email, options.locale ?? "en"))
    await customers.apply(event);
  const token = await h.tokenFor(userId, options.roles ?? []);
  return { userId, email, token, auth: { authorization: `Bearer ${token}` } };
}

function checkout(
  user: Customer,
  body: Record<string, unknown>,
  key: string | null = newKey(),
) {
  const req = h.http().post("/v1/checkout").set(user.auth);
  if (key) req.set("idempotency-key", key);
  return req.send(body);
}

function webhook(payload: unknown, secret: string | null = h.webhookSecret) {
  const req = h.http().post("/webhooks/lava");
  if (secret !== null) req.set("x-api-key", secret);
  return req.send(payload as object);
}

/** Checkout that must reach `ready`; returns the order id and the fake invoice. */
async function startPurchase(
  user: Customer,
  productKey: string,
  currency: Currency = "USD",
) {
  const res = await checkout(user, { productKey, currency }).expect(200);
  expect(res.body).toMatchObject({ state: "ready", status: "pending" });
  const invoice = h.lava.find(res.body.paymentUrl.split("/").at(-1) as string);
  return { orderId: res.body.orderId as string, invoice };
}

function paidWebhook(user: Customer, invoice: FakeInvoice, at = h.clock.now()) {
  return lavaPayloads.paymentSuccess({
    contractId: invoice.id,
    email: user.email,
    amount: Number(invoice.amount),
    currency: invoice.currency ?? "USD",
    at,
    subscription: invoice.type === "SUBSCRIPTION_FIRST_INVOICE",
  });
}

/** A paid purchase; returns what tests need to go on. */
async function buy(
  user: Customer,
  productKey: string,
  currency: Currency = "USD",
) {
  const { orderId, invoice } = await startPurchase(user, productKey, currency);
  const res = await webhook(paidWebhook(user, invoice)).expect(200);
  expect(res.body.status).toBe("processed");
  return { orderId, invoice };
}

const eventsOf = (type: string, field: string, value: string) =>
  db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(
      and(
        eq(outbox.type, type),
        sql`${outbox.envelope}->'payload'->>${field} = ${value}`,
      ),
    )
    .then((rows) =>
      rows.map(
        (row) =>
          row.envelope as {
            payload: Record<string, unknown>;
            aggregateVersion: number;
          },
      ),
    );

const grantsOf = (userId: string) =>
  db.select().from(grants).where(eq(grants.userId, userId));
const orderRow = (orderId: string) =>
  db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0]);
const subscriptionOf = (orderId: string) =>
  db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orderId, orderId))
    .then((rows) => rows[0]);
const attemptOf = (orderId: string) =>
  db
    .select()
    .from(checkoutAttempts)
    .where(eq(checkoutAttempts.orderId, orderId))
    .then((rows) => rows[0]);
const paymentsOf = (orderId: string) =>
  db.select().from(payments).where(eq(payments.orderId, orderId));

describe("catalog (PAY-02)", () => {
  it("lists the two Battleship products with server prices", async () => {
    const res = await h.http().get("/v1/catalog").expect(200);
    expect(res.body.checkoutEnabled).toBe(true);
    const premium = res.body.products.find(
      (p: { key: string }) => p.key === PREMIUM,
    );
    expect(premium).toMatchObject({
      service: "battleship",
      feature: "premium",
      kind: "subscription",
      periodicity: "MONTHLY",
      graceDays: 3,
    });
    expect(premium.prices.map((p: { money: unknown }) => p.money)).toEqual([
      { minor: "52", currency: "EUR", scale: 2 },
      { minor: "5000", currency: "RUB", scale: 2 },
      { minor: "59", currency: "USD", scale: 2 },
    ]);
    const silver = res.body.products.find(
      (p: { key: string }) => p.key === SILVER,
    );
    expect(silver).toMatchObject({
      feature: "cosmetics.silver-fleet",
      kind: "one_time",
    });
  });

  it("TC-PAY-02-01: a new price version never rewrites an existing order", async () => {
    const user = await newCustomer();
    const { orderId } = await startPurchase(user, SILVER, "EUR");
    const service = h.app.get(CatalogService);
    const changed = catalog.map((p) =>
      p.key === SILVER ? { ...p, prices: { ...p.prices, EUR: "0.99" } } : p,
    );
    await service.sync(changed);
    try {
      const old = await orderRow(orderId);
      expect(old).toMatchObject({
        amountMinor: 52n,
        priceVersion: 1,
        currency: "EUR",
      });
      const other = await newCustomer();
      const res = await checkout(other, {
        productKey: SILVER,
        currency: "EUR",
      }).expect(200);
      expect(await orderRow(res.body.orderId)).toMatchObject({
        amountMinor: 99n,
        priceVersion: 2,
      });
    } finally {
      await service.sync(catalog);
    }
    const list = await h.http().get("/v1/catalog").expect(200);
    const silver = list.body.products.find(
      (p: { key: string }) => p.key === SILVER,
    );
    expect(
      silver.prices.find(
        (p: { money: { currency: string } }) => p.money.currency === "EUR",
      ),
    ).toMatchObject({ version: 3, money: { minor: "52" } });
  });

  it("TC-PAY-02-03: provider payment ids are unique in the database itself", async () => {
    const user = await newCustomer();
    const { orderId } = await buy(user, SILVER);
    const [payment] = await paymentsOf(orderId);
    await expect(
      db.insert(payments).values({
        orderId,
        userId: user.userId,
        provider: "lava",
        providerContractId: payment?.providerContractId ?? "",
        kind: "purchase",
        currency: "USD",
        amountMinor: 59n,
        paidAt: new Date(),
        confirmedAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe("checkout (PAY-03)", () => {
  it("creates the order and the Lava invoice from server data only", async () => {
    const user = await newCustomer({ locale: "ru" });
    const res = await checkout(user, {
      productKey: PREMIUM,
      currency: "RUB",
    }).expect(200);
    expect(res.body).toMatchObject({ state: "ready", status: "pending" });
    expect(res.body.paymentUrl).toMatch(/^https:\/\/app\.lava\.top\/pay\//);
    const invoice = h.lava.last();
    expect(invoice.input).toMatchObject({
      email: user.email,
      offerId: productOf(PREMIUM).providerOfferId,
      currency: "RUB",
      periodicity: "MONTHLY",
      buyerLanguage: "RU",
    });
    expect(invoice.input.returnUrls.success).toBe(
      `https://pay.outegro.dev/checkout/result?orderId=${res.body.orderId}&result=success`,
    );
    expect(await orderRow(res.body.orderId)).toMatchObject({
      userId: user.userId,
      amountMinor: 5000n,
      currency: "RUB",
      status: "pending",
      service: "battleship",
      feature: "premium",
      graceDays: 3,
    });
    expect(await attemptOf(res.body.orderId)).toMatchObject({
      state: "ready",
      providerInvoiceId: invoice.id,
      buyerEmail: user.email,
    });
  });

  it("TC-PAY-03-01: two parallel requests with one key make one order and one invoice", async () => {
    const user = await newCustomer();
    const key = newKey();
    const before = h.lava.createCalls;
    const [a, b] = await Promise.all([
      checkout(user, { productKey: SILVER, currency: "USD" }, key),
      checkout(user, { productKey: SILVER, currency: "USD" }, key),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.orderId).toBe(b.body.orderId);
    expect(h.lava.createCalls - before).toBe(1);
    const mine = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, user.userId));
    expect(mine).toHaveLength(1);
    // A later repeat returns the same logical result.
    const again = await checkout(
      user,
      { productKey: SILVER, currency: "USD" },
      key,
    ).expect(200);
    expect(again.body).toMatchObject({
      orderId: a.body.orderId,
      state: "ready",
    });
    expect(h.lava.createCalls - before).toBe(1);
  });

  it("TC-PAY-03-02: the same key with other input is a conflict and the provider is not called", async () => {
    const user = await newCustomer();
    const key = newKey();
    await checkout(user, { productKey: SILVER, currency: "USD" }, key).expect(
      200,
    );
    const before = h.lava.createCalls;
    const res = await checkout(
      user,
      { productKey: SILVER, currency: "EUR" },
      key,
    ).expect(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(h.lava.createCalls).toBe(before);
  });

  it("TC-PAY-03-03: a lost provider answer leaves the attempt unknown, never a second invoice", async () => {
    const user = await newCustomer();
    const key = newKey();
    h.lava.mode = "timeout";
    const before = h.lava.createCalls;
    const first = await checkout(
      user,
      { productKey: SILVER, currency: "USD" },
      key,
    ).expect(200);
    expect(first.body).toMatchObject({
      state: "unknown",
      status: "pending",
      paymentUrl: null,
    });
    h.lava.mode = "ok";
    const again = await checkout(
      user,
      { productKey: SILVER, currency: "USD" },
      key,
    ).expect(200);
    expect(again.body).toMatchObject({
      orderId: first.body.orderId,
      state: "unknown",
    });
    expect(h.lava.createCalls - before).toBe(1);
    const lost = h.lava.last();

    // Reconciliation finds exactly one invoice for this buyer and takes it over.
    h.clock.advance(61_000);
    await reconciliation.tick();
    expect(await attemptOf(first.body.orderId)).toMatchObject({
      state: "ready",
      providerInvoiceId: lost.id,
    });
    expect(h.lava.createCalls - before).toBe(1);
    await webhook(paidWebhook(user, lost)).expect(200);
    expect((await orderRow(first.body.orderId))?.status).toBe("paid");
    expect(await grantsOf(user.userId)).toHaveLength(1);
  });

  it("TC-PAY-03-04: a client-sent price is refused", async () => {
    const user = await newCustomer();
    const res = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
      amount: "0.01",
    }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(
      await db.select().from(orders).where(eq(orders.userId, user.userId)),
    ).toHaveLength(0);
  });

  it("validates the key, the return URL, the product and the buyer", async () => {
    const user = await newCustomer();
    await checkout(user, { productKey: SILVER, currency: "USD" }, null).expect(
      400,
    );
    await checkout(user, { productKey: SILVER, currency: "GBP" }).expect(400);
    await checkout(user, {
      productKey: "no-such-product",
      currency: "USD",
    }).expect(404);
    const foreign = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
      returnUrl: "https://evil.example/steal",
    }).expect(400);
    expect(foreign.body.error.fieldErrors.returnUrl).toBeDefined();
    await checkout(user, {
      productKey: SILVER,
      currency: "USD",
      returnUrl: "https://battleship.outegro.dev/shop",
    }).expect(200);
    expect(h.lava.last().input.returnUrls.cancel).toMatch(
      /^https:\/\/battleship\.outegro\.dev\/shop\?orderId=.+&result=cancel$/,
    );
    // Identity has not told us about this user yet: retry later.
    const stranger = {
      auth: { authorization: `Bearer ${await h.tokenFor(randomUUID())}` },
    };
    const res = await h
      .http()
      .post("/v1/checkout")
      .set(stranger.auth)
      .set("idempotency-key", newKey())
      .send({ productKey: SILVER, currency: "USD" })
      .expect(503);
    expect(res.body.error.retryable).toBe(true);
    // Someone who signed up before payments existed: Identity is asked once.
    const early = randomUUID();
    const earlyEmail = `early.${early.slice(0, 8)}@example.test`;
    h.identityUsers.set(early, {
      userId: early,
      email: earlyEmail,
      emailVerified: true,
      locale: "ru",
      status: "active",
      accessVersion: 3,
    });
    const earlyRes = await h
      .http()
      .post("/v1/checkout")
      .set({ authorization: `Bearer ${await h.tokenFor(early, [], 3)}` })
      .set("idempotency-key", newKey())
      .send({ productKey: SILVER, currency: "RUB" })
      .expect(200);
    expect(earlyRes.body).toMatchObject({ state: "ready", status: "pending" });
    expect(h.lava.last().input.email).toBe(earlyEmail);
    await h
      .http()
      .post("/v1/checkout")
      .send({ productKey: SILVER, currency: "USD" })
      .expect(401);
  });

  it("refuses to sell what the buyer already has", async () => {
    const user = await newCustomer();
    await buy(user, SILVER);
    const owned = await checkout(user, {
      productKey: SILVER,
      currency: "RUB",
    }).expect(422);
    expect(owned.body.error.fieldErrors.productKey).toEqual(["already owned"]);
    await buy(user, PREMIUM, "EUR");
    const subscribed = await checkout(user, {
      productKey: PREMIUM,
      currency: "USD",
    }).expect(422);
    expect(subscribed.body.error.fieldErrors.productKey).toEqual([
      "already subscribed",
    ]);
  });

  it("marks the attempt failed when the provider refuses or cannot be reached", async () => {
    const user = await newCustomer();
    h.lava.mode = "reject";
    const rejected = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
    }).expect(200);
    expect(rejected.body).toMatchObject({
      state: "failed",
      status: "failed",
      paymentUrl: null,
    });
    h.lava.mode = "refused";
    const refused = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
    }).expect(200);
    expect(refused.body).toMatchObject({ state: "failed", status: "failed" });
  });

  it("keeps sales closed while the provider is not configured", async () => {
    const user = await newCustomer();
    h.lava.configured = false;
    try {
      const res = await checkout(user, {
        productKey: SILVER,
        currency: "USD",
      }).expect(422);
      expect(res.body.error.fieldErrors.checkout).toEqual(["sales are closed"]);
      const list = await h.http().get("/v1/catalog").expect(200);
      expect(list.body.checkoutEnabled).toBe(false);
    } finally {
      h.lava.configured = true;
    }
  });
});

describe("webhooks (PAY-04, PAY-05)", () => {
  it("a paid webhook grants access and emits the billing events", async () => {
    const user = await newCustomer({ locale: "ru" });
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    const res = await webhook(paidWebhook(user, invoice)).expect(200);
    expect(res.body).toEqual({ status: "processed" });

    expect(await orderRow(orderId)).toMatchObject({ status: "paid" });
    const [payment] = await paymentsOf(orderId);
    expect(payment).toMatchObject({
      amountMinor: 59n,
      currency: "USD",
      kind: "purchase",
    });
    const [grant] = await grantsOf(user.userId);
    expect(grant).toMatchObject({
      service: "battleship",
      feature: "cosmetics.silver-fleet",
      sourceType: "purchase",
      sourceId: orderId,
      state: "active",
      validUntil: null,
      version: 1,
    });
    const [confirmed] = await eventsOf(
      "billing.payment.confirmed.v1",
      "orderId",
      orderId,
    );
    expect(confirmed?.payload).toMatchObject({
      paymentId: payment?.id,
      userId: user.userId,
      money: { minor: "59", currency: "USD", scale: 2 },
    });
    const [granted] = await eventsOf(
      "billing.grant.changed.v1",
      "sourceId",
      orderId,
    );
    expect(granted?.payload).toMatchObject({
      grantId: grant?.id,
      state: "active",
      sourceType: "purchase",
      validUntil: null,
    });
    expect(granted?.aggregateVersion).toBe(1);
    const [intent] = await eventsOf(
      "notifications.intent.requested.v1",
      "sourceEventId",
      (confirmed as unknown as { eventId: string })?.eventId ?? "",
    );
    expect(intent?.payload).toMatchObject({
      templateKey: "billing.payment-confirmed",
      category: "billing",
      recipient: { userId: user.userId },
      data: { product: "Серебряный флот", amount: "0.59 USD" },
    });
    const mine = await h
      .http()
      .get(`/v1/me/orders/${orderId}`)
      .set(user.auth)
      .expect(200);
    expect(mine.body).toMatchObject({
      status: "paid",
      checkout: { state: "ready", paymentUrl: null },
      access: { state: "active", validUntil: null },
    });
  });

  it("a paid subscription webhook opens a period and a grant until paidUntil + grace", async () => {
    const user = await newCustomer();
    const paidAt = h.clock.now();
    const { orderId } = await buy(user, PREMIUM, "RUB");
    const subscription = await subscriptionOf(orderId);
    const paidUntil = addMonthsUtc(paidAt, 1);
    expect(subscription).toMatchObject({
      state: "active",
      autoRenew: true,
      buyerEmail: user.email,
      amountMinor: 5000n,
    });
    expect(subscription?.paidUntil).toEqual(paidUntil);
    const [grant] = await grantsOf(user.userId);
    expect(grant).toMatchObject({
      sourceType: "subscription",
      sourceId: subscription?.id,
    });
    expect(grant?.validUntil).toEqual(
      new Date(paidUntil.getTime() + 3 * DAY_MS),
    );
    const [changed] = await eventsOf(
      "billing.subscription.changed.v1",
      "subscriptionId",
      subscription?.id ?? "",
    );
    expect(changed?.payload).toMatchObject({
      state: "active",
      autoRenew: true,
      paidUntil: paidUntil.toISOString(),
    });
    const list = await h
      .http()
      .get("/v1/me/subscriptions")
      .set(user.auth)
      .expect(200);
    expect(list.body.items[0]).toMatchObject({
      id: subscription?.id,
      state: "active",
      paidUntil: paidUntil.toISOString(),
      accessUntil: grant?.validUntil?.toISOString(),
      title: { en: "Battleship Premium" },
    });
  });

  it("TC-PAY-04-03 / TC-PAY-05-01: repeated and reformatted deliveries have one effect", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "EUR");
    const payload = paidWebhook(user, invoice);
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    const bodies = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify(i % 2 ? reordered : payload, null, i % 3),
    );
    const results = await Promise.all(
      bodies.map((body) =>
        h
          .http()
          .post("/webhooks/lava")
          .set("x-api-key", h.webhookSecret)
          .set("content-type", "application/json")
          .send(body),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.status === "processed")).toHaveLength(
      1,
    );
    expect(results.filter((r) => r.body.status === "duplicate")).toHaveLength(
      9,
    );
    expect(await paymentsOf(orderId)).toHaveLength(1);
    expect(await grantsOf(user.userId)).toHaveLength(1);
    expect(
      await eventsOf("billing.payment.confirmed.v1", "orderId", orderId),
    ).toHaveLength(1);
    const [payment] = await paymentsOf(orderId);
    expect(
      await db
        .select()
        .from(financialEntries)
        .where(eq(financialEntries.paymentId, payment?.id ?? "")),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(providerEvents)
        .where(eq(providerEvents.contractId, invoice.id)),
    ).toHaveLength(1);
  });

  it("TC-PAY-04-01: a wrong or missing X-Api-Key is 401 and changes nothing", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    const payload = paidWebhook(user, invoice);
    for (const secret of [
      null,
      "",
      "wrong",
      `${h.webhookSecret.slice(0, -1)}x`,
      `${h.webhookSecret}x`,
    ]) {
      const res = await webhook(payload, secret).expect(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
    const basic = await h
      .http()
      .post("/webhooks/lava")
      .set(
        "authorization",
        `Basic ${Buffer.from(`lava:${h.webhookSecret}`).toString("base64")}`,
      )
      .send(payload)
      .expect(401);
    expect(basic.body.error.code).toBe("UNAUTHENTICATED");
    expect(await orderRow(orderId)).toMatchObject({ status: "pending" });
    expect(await paymentsOf(orderId)).toHaveLength(0);
    expect(await grantsOf(user.userId)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(providerEvents)
        .where(eq(providerEvents.contractId, invoice.id)),
    ).toHaveLength(0);
  });

  it("TC-PAY-04-04 / TC-PAY-01-03: unknown and invalid events are stored and acknowledged without effect", async () => {
    const unknown = await webhook({
      eventType: "payout.created",
      contractId: randomUUID(),
      amount: 1,
    }).expect(200);
    expect(unknown.body.status).toBe("quarantined");
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    const broken = await webhook({
      ...paidWebhook(user, invoice),
      amount: "lots",
    }).expect(200);
    expect(broken.body.status).toBe("invalid");
    expect(await orderRow(orderId)).toMatchObject({ status: "pending" });
    const [stored] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.contractId, invoice.id));
    expect(stored).toMatchObject({
      status: "invalid",
      type: "invalid",
      fact: null,
    });
  });

  it("TC-PAY-04-02: when the event cannot be stored, Lava gets no 2xx and retries", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    await db.execute(
      sql`alter table provider_events rename to provider_events_offline`,
    );
    try {
      const res = await webhook(paidWebhook(user, invoice));
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        retryable: true,
      });
      expect(JSON.stringify(res.body)).not.toContain("provider_events");
    } finally {
      await db.execute(
        sql`alter table provider_events_offline rename to provider_events`,
      );
    }
    expect(await orderRow(orderId)).toMatchObject({ status: "pending" });
    const retry = await webhook(paidWebhook(user, invoice)).expect(200);
    expect(retry.body.status).toBe("processed");
    expect(await orderRow(orderId)).toMatchObject({ status: "paid" });
  });

  it("TC-PAY-05-02: another amount or currency opens an issue and grants nothing", async () => {
    const user = await newCustomer();
    const cheaper = await startPurchase(user, SILVER, "USD");
    const res = await webhook({
      ...paidWebhook(user, cheaper.invoice),
      amount: 0.5,
    }).expect(200);
    expect(res.body.status).toBe("mismatch");
    // The same event again is a duplicate delivery, not a second mismatch.
    expect(
      (await webhook({ ...paidWebhook(user, cheaper.invoice), amount: 0.5 }))
        .body.status,
    ).toBe("duplicate");
    const otherCurrency = await startPurchase(user, SILVER, "USD");
    const other = await webhook({
      ...paidWebhook(user, otherCurrency.invoice),
      currency: "EUR",
    }).expect(200);
    expect(other.body.status).toBe("mismatch");
    for (const { orderId, invoice } of [cheaper, otherCurrency]) {
      expect(await orderRow(orderId)).toMatchObject({ status: "pending" });
      const [issue] = await db
        .select()
        .from(reconciliationIssues)
        .where(eq(reconciliationIssues.subjectKey, `contract:${invoice.id}`));
      expect(issue).toMatchObject({
        kind: "amount_mismatch",
        status: "open",
        severity: "high",
      });
    }
    expect(await grantsOf(user.userId)).toHaveLength(0);
  });

  it("TC-PAY-05-03: a webhook that beats the create response is applied once after the mapping", async () => {
    const user = await newCustomer();
    let early: { status: number; body: { status: string } } | null = null;
    h.lava.beforeAnswer = async (invoice) => {
      early = await webhook(paidWebhook(user, invoice));
    };
    const res = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
    }).expect(200);
    expect(early).toMatchObject({ status: 200, body: { status: "unmatched" } });
    expect(await orderRow(res.body.orderId)).toMatchObject({ status: "paid" });
    expect(await paymentsOf(res.body.orderId)).toHaveLength(1);
    const [event] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.orderId, res.body.orderId));
    expect(event).toMatchObject({ status: "processed", attempts: 2 });
  });

  it("TC-PAY-05-04: a late failure never undoes a confirmed payment", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await buy(user, SILVER, "USD");
    const late = lavaPayloads.paymentFailed({
      contractId: invoice.id,
      email: user.email,
      amount: 0.59,
      currency: "USD",
      at: new Date(h.clock.now().getTime() - 60_000),
    });
    const res = await webhook(late).expect(200);
    expect(res.body.status).toBe("ignored");
    expect(await orderRow(orderId)).toMatchObject({ status: "paid" });
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
  });

  it("a failed payment fails the order; a later success on the same contract still counts", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "RUB");
    await webhook(
      lavaPayloads.paymentFailed({
        contractId: invoice.id,
        email: user.email,
        amount: 50,
        currency: "RUB",
        at: h.clock.now(),
      }),
    ).expect(200);
    expect(await orderRow(orderId)).toMatchObject({ status: "failed" });
    await webhook(paidWebhook(user, invoice)).expect(200);
    expect(await orderRow(orderId)).toMatchObject({ status: "paid" });
  });
});

describe("subscriptions (PAY-07, PAY-08)", () => {
  it("a renewal extends paidUntil and the grant exactly once", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await buy(user, PREMIUM, "USD");
    const first = await subscriptionOf(orderId);
    if (!first) throw new Error("no subscription");
    h.clock.set(new Date(first.paidUntil.getTime() - 3_600_000));
    const renewal = lavaPayloads.renewalSuccess({
      parentContractId: invoice.id,
      email: user.email,
      amount: 0.59,
      currency: "USD",
      at: h.clock.now(),
    });
    const res = await webhook(renewal).expect(200);
    expect(res.body.status).toBe("processed");
    const second = await subscriptionOf(orderId);
    const expectedUntil = addMonthsUtc(first.paidUntil, 1);
    expect(second).toMatchObject({ state: "active" });
    expect(second?.paidUntil).toEqual(expectedUntil);
    const [grant] = await grantsOf(user.userId);
    expect(grant).toMatchObject({ state: "active", version: 2 });
    expect(grant?.validUntil).toEqual(
      new Date(expectedUntil.getTime() + 3 * DAY_MS),
    );
    const grantEvents = await eventsOf(
      "billing.grant.changed.v1",
      "grantId",
      grant?.id ?? "",
    );
    expect(grantEvents.map((e) => e.aggregateVersion).sort()).toEqual([1, 2]);
    expect(await paymentsOf(orderId)).toHaveLength(2);

    // TC-PAY-07-01: the same recurrent contract again adds nothing.
    const again = await webhook({ ...renewal, errorMessage: null }).expect(200);
    expect(["duplicate", "ignored"]).toContain(again.body.status);
    expect((await subscriptionOf(orderId))?.paidUntil).toEqual(expectedUntil);
    expect(
      await db
        .select()
        .from(billingPeriods)
        .where(eq(billingPeriods.subscriptionId, first.id)),
    ).toHaveLength(2);
  });

  it("TC-PAY-07-02: an older failure does not undo a later confirmed renewal", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await buy(user, PREMIUM, "USD");
    const sub = await subscriptionOf(orderId);
    if (!sub) throw new Error("no subscription");
    const renewedAt = new Date(sub.paidUntil.getTime() - 60_000);
    h.clock.set(renewedAt);
    await webhook(
      lavaPayloads.renewalSuccess({
        parentContractId: invoice.id,
        email: user.email,
        amount: 0.59,
        currency: "USD",
        at: renewedAt,
      }),
    ).expect(200);
    const stale = await webhook(
      lavaPayloads.renewalFailed({
        parentContractId: invoice.id,
        email: user.email,
        amount: 0.59,
        currency: "USD",
        at: new Date(renewedAt.getTime() - 3_600_000),
      }),
    ).expect(200);
    expect(stale.body.status).toBe("ignored");
    expect((await subscriptionOf(orderId))?.state).toBe("active");
  });

  it("a fresh renewal failure makes the subscription past_due and keeps paid access", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await buy(user, PREMIUM, "EUR");
    const sub = await subscriptionOf(orderId);
    if (!sub) throw new Error("no subscription");
    h.clock.set(sub.paidUntil);
    await webhook(
      lavaPayloads.renewalFailed({
        parentContractId: invoice.id,
        email: user.email,
        amount: 0.52,
        currency: "EUR",
        at: h.clock.now(),
      }),
    ).expect(200);
    expect((await subscriptionOf(orderId))?.state).toBe("past_due");
    const [grant] = await grantsOf(user.userId);
    expect(grant).toMatchObject({ state: "active", version: 1 });
  });

  it("a renewal that arrives before the first payment is applied on retry and its issue closes", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, PREMIUM, "USD");
    const renewal = lavaPayloads.renewalSuccess({
      parentContractId: invoice.id,
      email: user.email,
      amount: 0.59,
      currency: "USD",
      at: h.clock.now(),
    });
    expect((await webhook(renewal).expect(200)).body.status).toBe("unmatched");
    const [issue] = await db
      .select()
      .from(reconciliationIssues)
      .where(
        eq(reconciliationIssues.subjectKey, `contract:${renewal.contractId}`),
      );
    expect(issue).toMatchObject({
      kind: "renewal_without_parent",
      status: "open",
    });
    await webhook(paidWebhook(user, invoice)).expect(200);
    h.clock.advance(61_000);
    await reconciliation.tick();
    expect(await paymentsOf(orderId)).toHaveLength(2);
    const [event] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.contractId, renewal.contractId));
    expect(event).toMatchObject({ status: "processed", attempts: 2 });
    const [closed] = await db
      .select()
      .from(reconciliationIssues)
      .where(
        eq(reconciliationIssues.subjectKey, `contract:${renewal.contractId}`),
      );
    expect(closed).toMatchObject({
      status: "resolved",
      resolution: "parent subscription appeared",
    });
  });

  it("TC-PAY-07-03: a renewal for an unknown parent is unmatched and never creates a subscription", async () => {
    const parent = randomUUID();
    const res = await webhook(
      lavaPayloads.renewalSuccess({
        parentContractId: parent,
        email: "nobody@example.test",
        amount: 0.59,
        currency: "USD",
        at: h.clock.now(),
      }),
    ).expect(200);
    expect(res.body.status).toBe("unmatched");
    expect(
      await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.providerParentContractId, parent)),
    ).toHaveLength(0);
    const issues = await db
      .select()
      .from(reconciliationIssues)
      .where(eq(reconciliationIssues.kind, "renewal_without_parent"));
    expect(
      issues.some(
        (i) =>
          (i.evidence as { parentContractId: string }).parentContractId ===
          parent,
      ),
    ).toBe(true);
  });

  it("cancel keeps access until the paid period ends, then the grant expires", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await buy(user, PREMIUM, "USD");
    const sub = await subscriptionOf(orderId);
    if (!sub) throw new Error("no subscription");
    const res = await h
      .http()
      .post(`/v1/me/subscriptions/${sub.id}/cancel`)
      .set(user.auth)
      .expect(200);
    expect(res.body).toMatchObject({
      state: "cancelling",
      autoRenew: false,
      paidUntil: sub.paidUntil.toISOString(),
    });
    expect(h.lava.cancelCalls.at(-1)).toEqual({
      parentContractId: invoice.id,
      email: user.email,
    });
    // TC-PAY-08-02: repeating the command calls nobody.
    const calls = h.lava.cancelCalls.length;
    await h
      .http()
      .post(`/v1/me/subscriptions/${sub.id}/cancel`)
      .set(user.auth)
      .expect(200);
    expect(h.lava.cancelCalls).toHaveLength(calls);
    const states = (
      await eventsOf(
        "billing.subscription.changed.v1",
        "subscriptionId",
        sub.id,
      )
    ).map((e) => e.payload.state);
    expect(states).toEqual(
      expect.arrayContaining(["active", "cancel_requested", "cancelling"]),
    );

    // Still paid: nothing expires before paidUntil (+ grace).
    h.clock.set(new Date(sub.paidUntil.getTime() - 60_000));
    await expiry.tick();
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
    const grant = (await grantsOf(user.userId))[0];
    if (!grant?.validUntil) throw new Error("grant without end");
    // validUntil is exclusive: at that instant access is over.
    h.clock.set(grant.validUntil);
    await expiry.tick();
    expect((await grantsOf(user.userId))[0]).toMatchObject({
      state: "expired",
      version: 2,
    });
    expect(await subscriptionOf(orderId)).toMatchObject({ state: "expired" });
    const expired = await eventsOf(
      "billing.grant.changed.v1",
      "grantId",
      grant.id,
    );
    expect(
      expired.find((e) => e.aggregateVersion === 2)?.payload,
    ).toMatchObject({
      state: "expired",
    });
  });

  it("an active subscription without renewal goes past_due at paidUntil and expires after grace", async () => {
    const user = await newCustomer();
    const { orderId } = await buy(user, PREMIUM, "RUB");
    const sub = await subscriptionOf(orderId);
    if (!sub) throw new Error("no subscription");
    h.clock.set(sub.paidUntil);
    await expiry.tick();
    expect(await subscriptionOf(orderId)).toMatchObject({ state: "past_due" });
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
    h.clock.set(new Date(sub.paidUntil.getTime() + 3 * DAY_MS));
    await expiry.tick();
    expect(await subscriptionOf(orderId)).toMatchObject({ state: "expired" });
    expect((await grantsOf(user.userId))[0]).toMatchObject({
      state: "expired",
    });
  });

  it("TC-PAY-08-04: a lost cancel answer stays cancel_requested and is retried", async () => {
    const user = await newCustomer();
    const { orderId } = await buy(user, PREMIUM, "USD");
    const sub = await subscriptionOf(orderId);
    if (!sub) throw new Error("no subscription");
    h.lava.cancelMode = "timeout";
    const res = await h
      .http()
      .post(`/v1/me/subscriptions/${sub.id}/cancel`)
      .set(user.auth)
      .expect(200);
    expect(res.body).toMatchObject({
      state: "cancel_requested",
      autoRenew: true,
    });
    h.lava.cancelMode = "ok";
    h.clock.advance(6 * 60_000);
    await reconciliation.tick();
    expect(await subscriptionOf(orderId)).toMatchObject({
      state: "cancelling",
      autoRenew: false,
    });
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
  });

  it("subscription.cancelled from Lava (naming a renewal contract) turns renewal off", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await buy(user, PREMIUM, "USD");
    const sub = await subscriptionOf(orderId);
    if (!sub) throw new Error("no subscription");
    h.clock.set(new Date(sub.paidUntil.getTime() - 60_000));
    const renewalId = randomUUID();
    await webhook(
      lavaPayloads.renewalFailed({
        contractId: renewalId,
        parentContractId: invoice.id,
        email: user.email,
        amount: 0.59,
        currency: "USD",
        at: h.clock.now(),
      }),
    ).expect(200);
    const res = await webhook(
      lavaPayloads.cancelled({
        contractId: renewalId,
        email: user.email,
        cancelledAt: h.clock.now(),
        willExpireAt: sub.paidUntil,
      }),
    ).expect(200);
    expect(res.body.status).toBe("processed");
    expect(await subscriptionOf(orderId)).toMatchObject({
      state: "cancelling",
      autoRenew: false,
      providerExpiresAt: sub.paidUntil,
    });
  });
});

describe("reconciliation (PAY-10)", () => {
  it("TC-PAY-10-01: settles a missed webhook once; the late webhook changes nothing", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    h.lava.complete(invoice.id);
    h.clock.advance(61_000);
    await reconciliation.tick();
    expect(await orderRow(orderId)).toMatchObject({ status: "paid" });
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
    expect(
      await eventsOf("billing.payment.confirmed.v1", "orderId", orderId),
    ).toHaveLength(1);
    const [event] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.orderId, orderId));
    expect(event).toMatchObject({
      source: "reconciliation",
      status: "processed",
    });
    expect((await attemptOf(orderId))?.nextCheckAt).toBeNull();

    const late = await webhook(paidWebhook(user, invoice)).expect(200);
    expect(late.body.status).toBe("ignored");
    expect(await paymentsOf(orderId)).toHaveLength(1);
    expect(await grantsOf(user.userId)).toHaveLength(1);
    expect(
      await eventsOf("billing.payment.confirmed.v1", "orderId", orderId),
    ).toHaveLength(1);
  });

  it("TC-PAY-10-04: a rate-limited provider means back off, not a busy loop", async () => {
    const user = await newCustomer();
    const { orderId } = await startPurchase(user, SILVER, "USD");
    h.lava.failReads = true;
    h.clock.advance(61_000);
    await reconciliation.tick();
    const first = await attemptOf(orderId);
    expect(first).toMatchObject({ state: "ready", checks: 1 });
    expect(first?.nextCheckAt?.getTime()).toBe(
      h.clock.now().getTime() + 60_000,
    );
    await reconciliation.tick();
    expect((await attemptOf(orderId))?.checks).toBe(1);
  });

  it("an attempt whose process died during the call becomes unknown and is recovered", async () => {
    const user = await newCustomer();
    let crashed = "";
    h.lava.beforeAnswer = async (invoice) => {
      crashed = invoice.id;
      throw new Error("process crashed mid-call");
    };
    // The thrown error surfaces as an unknown outcome (the call may have been sent).
    const res = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
    }).expect(200);
    expect(res.body.state).toBe("unknown");
    await db
      .update(checkoutAttempts)
      .set({ state: "requesting" })
      .where(eq(checkoutAttempts.orderId, res.body.orderId));
    h.clock.advance(10 * 60_000);
    await reconciliation.tick();
    expect(await attemptOf(res.body.orderId)).toMatchObject({
      state: "ready",
      providerInvoiceId: crashed,
    });
  });

  it("two invoices that could be ours are never guessed", async () => {
    const user = await newCustomer();
    h.lava.mode = "timeout";
    const a = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
    }).expect(200);
    const b = await checkout(user, {
      productKey: SILVER,
      currency: "USD",
    }).expect(200);
    expect([a.body.state, b.body.state]).toEqual(["unknown", "unknown"]);
    h.lava.mode = "ok";
    for (let i = 0; i < 3; i++) {
      h.clock.advance(20 * 60_000);
      await reconciliation.tick();
    }
    expect((await attemptOf(a.body.orderId))?.state).toBe("unknown");
    expect((await attemptOf(b.body.orderId))?.state).toBe("unknown");
    const issue = await db
      .select()
      .from(reconciliationIssues)
      .where(
        eq(
          reconciliationIssues.subjectKey,
          `attempt:${(await attemptOf(a.body.orderId))?.id}`,
        ),
      );
    expect(issue[0]).toMatchObject({ kind: "checkout_unknown" });
  });
});

describe("refunds and disputes (PAY-09)", () => {
  it("TC-PAY-09-01: two look-alike purchases of one email are never guessed", async () => {
    const email = `shared.${randomUUID().slice(0, 8)}@example.test`;
    const first = await newCustomer({ email });
    const second = await newCustomer({ email });
    await buy(first, SILVER, "USD");
    await buy(second, SILVER, "USD");
    const res = await webhook(
      lavaPayloads.refund({
        tierId: productOf(SILVER).providerOfferId,
        email,
        amount: 0.59,
        currency: "USD",
        at: h.clock.now(),
      }),
    ).expect(200);
    expect(res.body.status).toBe("unmatched");
    for (const user of [first, second])
      expect((await grantsOf(user.userId))[0]).toMatchObject({
        state: "active",
      });
    const [refund] = await db
      .select()
      .from(refunds)
      .where(
        sql`${refunds.evidence}->>'offerId' = ${productOf(SILVER).providerOfferId} and ${refunds.state} = 'unmatched'`,
      )
      .orderBy(sql`${refunds.createdAt} desc`)
      .limit(1);
    const evidence = refund?.evidence as
      | { candidatePaymentIds: string[] }
      | undefined;
    expect(evidence?.candidatePaymentIds).toHaveLength(2);
    // The case waits for an operator; the event is not re-tried on its own.
    const [event] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.refundId, refund?.id ?? ""));
    expect(event).toMatchObject({ status: "unmatched", nextAttemptAt: null });
  });

  it("TC-PAY-09-02: a refund linked to purchase A revokes only grant A, once", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    const { orderId } = await buy(user, SILVER, "USD");
    await buy(user, PREMIUM, "USD");
    const [payment] = await paymentsOf(orderId);
    await h
      .http()
      .post(`/v1/admin/payments/${payment?.id}/refund-request`)
      .set(owner.auth)
      .send({ reason: "buyer asked by email" })
      .expect(201);
    const refund = lavaPayloads.refund({
      tierId: productOf(SILVER).providerOfferId,
      email: user.email,
      amount: 0.59,
      currency: "USD",
      at: h.clock.now(),
    });
    const res = await webhook(refund).expect(200);
    expect(res.body.status).toBe("processed");
    expect((await webhook(refund).expect(200)).body.status).toBe("duplicate");
    expect(
      (await webhook({ ...refund, event_id: randomUUID() }).expect(200)).body
        .status,
    ).toBe("ignored");
    const rows = await grantsOf(user.userId);
    expect(rows.find((g) => g.sourceType === "purchase")).toMatchObject({
      state: "revoked",
      revokeReason: "refund",
    });
    expect(rows.find((g) => g.sourceType === "subscription")).toMatchObject({
      state: "active",
    });
    expect(await orderRow(orderId)).toMatchObject({ status: "refunded" });
    const entries = await db
      .select()
      .from(financialEntries)
      .where(
        and(
          eq(financialEntries.paymentId, payment?.id ?? ""),
          eq(financialEntries.type, "refund"),
        ),
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amountMinor).toBe(-59n);
  });

  it("TC-PAY-09-03: a partial refund waits for an operator and revokes nothing", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    const { orderId } = await buy(user, SILVER, "RUB");
    const [payment] = await paymentsOf(orderId);
    await h
      .http()
      .post(`/v1/admin/payments/${payment?.id}/refund-request`)
      .set(owner.auth)
      .send({ reason: "half of it" })
      .expect(201);
    await webhook(
      lavaPayloads.refund({
        tierId: productOf(SILVER).providerOfferId,
        email: user.email,
        amount: 25,
        currency: "RUB",
        refundType: "partial",
        at: h.clock.now(),
      }),
    ).expect(200);
    const [row] = await db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, payment?.id ?? ""));
    expect(row).toMatchObject({
      state: "review_required",
      refundType: "partial",
    });
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
    expect(await orderRow(orderId)).toMatchObject({ status: "paid" });
  });

  it("TC-PAY-09-04: a chargeback opens a case without deciding its outcome", async () => {
    const user = await newCustomer();
    await buy(user, SILVER, "EUR");
    const res = await webhook(
      lavaPayloads.chargeback({
        tierId: productOf(SILVER).providerOfferId,
        email: user.email,
        amount: 0.52,
        currency: "EUR",
        at: h.clock.now(),
      }),
    ).expect(200);
    expect(res.body.status).toBe("unmatched");
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
    const cases = await db
      .select()
      .from(refunds)
      .where(eq(refunds.kind, "chargeback"))
      .orderBy(sql`${refunds.createdAt} desc`);
    expect(cases[0]).toMatchObject({
      state: "open",
      reason: "fraud",
      paymentId: null,
    });
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.userId, user.userId));
    expect(payment?.state).toBe("confirmed");
  });
});

describe("ownership (INV-10)", () => {
  it("someone else's order or subscription looks like a missing one", async () => {
    const owner = await newCustomer();
    const stranger = await newCustomer();
    const { orderId } = await buy(owner, PREMIUM, "USD");
    const sub = await subscriptionOf(orderId);
    await h
      .http()
      .get(`/v1/me/orders/${orderId}`)
      .set(stranger.auth)
      .expect(404);
    await h.http().get(`/v1/me/orders/${orderId}`).set(owner.auth).expect(200);
    await h.http().get("/v1/me/orders/not-a-uuid").set(owner.auth).expect(404);
    const calls = h.lava.cancelCalls.length;
    await h
      .http()
      .post(`/v1/me/subscriptions/${sub?.id}/cancel`)
      .set(stranger.auth)
      .expect(404);
    expect(h.lava.cancelCalls).toHaveLength(calls);
    expect(await subscriptionOf(orderId)).toMatchObject({ state: "active" });
    const list = await h
      .http()
      .get("/v1/me/orders")
      .set(stranger.auth)
      .expect(200);
    expect(list.body.items).toEqual([]);
    await h.http().get("/v1/me/orders").expect(401);
  });

  it("TC-PAY-11-01: a success redirect proves nothing; the order stays pending", async () => {
    const user = await newCustomer();
    const { orderId } = await startPurchase(user, SILVER, "USD");
    const res = await h
      .http()
      .get(`/v1/me/orders/${orderId}`)
      .set(user.auth)
      .expect(200);
    expect(res.body).toMatchObject({ status: "pending", access: null });
    expect(res.body.checkout.paymentUrl).toMatch(
      /^https:\/\/app\.lava\.top\/pay\//,
    );
  });
});
