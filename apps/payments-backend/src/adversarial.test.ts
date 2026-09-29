import { randomUUID } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IssueRegistry } from "./billing/issues.js";
import type { PaymentsDatabase } from "./common/database.js";
import { env } from "./config/env.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  auditLog,
  billingPeriods,
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
import { catalog } from "./domain/catalog.js";
import type { Currency } from "./domain/money.js";
import { addMonthsUtc } from "./domain/periods.js";
import type { FakeInvoice } from "./test/fake-lava.js";
import { customerEvents, type Harness, startHarness } from "./test/harness.js";
import { lavaPayloads } from "./test/lava-payloads.js";
import { ExpiryWorker } from "./workers/expiry.worker.js";
import { ReconciliationWorker } from "./workers/reconciliation.worker.js";

/**
 * QA attack suite for the money path: webhook transport and replay,
 * exact amounts, concurrent deliveries in different orders, grant
 * boundaries, operator visibility of problems, and authorization.
 */

const PREMIUM = "battleship-premium";
const SILVER = "battleship-silver-fleet";
const SILVER_OFFER =
  catalog.find((p) => p.key === SILVER)?.providerOfferId ?? "";
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

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

type Customer = Awaited<ReturnType<typeof newCustomer>>;

async function newCustomer(options: { roles?: string[]; email?: string } = {}) {
  const userId = randomUUID();
  const email = options.email ?? `qa.${userId.slice(0, 8)}@example.test`;
  for (const event of customerEvents(userId, email))
    await customers.apply(event);
  const token = await h.tokenFor(userId, options.roles ?? []);
  return { userId, email, auth: { authorization: `Bearer ${token}` } };
}

const newKey = () => `qa-${randomUUID()}`;

function checkout(
  user: Customer,
  body: Record<string, unknown>,
  key: string = newKey(),
) {
  return h
    .http()
    .post("/v1/checkout")
    .set(user.auth)
    .set("idempotency-key", key)
    .send(body);
}

function webhook(payload: unknown, secret: string | null = h.webhookSecret) {
  const req = h.http().post("/webhooks/lava");
  if (secret !== null) req.set("x-api-key", secret);
  return req.send(payload as object);
}

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

function paidWebhook(
  user: Customer,
  invoice: FakeInvoice,
  at = h.clock.now(),
  amount: number | string = Number(invoice.amount),
) {
  return {
    ...lavaPayloads.paymentSuccess({
      contractId: invoice.id,
      email: user.email,
      amount: 0,
      currency: invoice.currency ?? "USD",
      at,
      subscription: invoice.type === "SUBSCRIPTION_FIRST_INVOICE",
    }),
    amount,
  };
}

const orderRow = (orderId: string) =>
  db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .then((rows) => rows[0]);
const subscriptionsOf = (orderId: string) =>
  db.select().from(subscriptions).where(eq(subscriptions.orderId, orderId));
const paymentsOf = (orderId: string) =>
  db.select().from(payments).where(eq(payments.orderId, orderId));
const grantsOf = (userId: string) =>
  db.select().from(grants).where(eq(grants.userId, userId));
const issueOf = (subjectKey: string) =>
  db
    .select()
    .from(reconciliationIssues)
    .where(eq(reconciliationIssues.subjectKey, subjectKey))
    .then((rows) => rows[0]);
const eventsFor = (contractIds: string[]) =>
  db
    .select()
    .from(providerEvents)
    .where(inArray(providerEvents.contractId, contractIds));
const outboxOf = (type: string, field: string, value: string) =>
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

/** Deterministic shuffle, so a failing ordering can be replayed. */
function shuffled<T>(items: T[], seed: number) {
  const copy = [...items];
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Lets the worker retry every unmatched or failed event that is due. */
async function drainRetries() {
  for (let i = 0; i < 4; i++) {
    h.clock.advance(16 * MINUTE_MS);
    await reconciliation.tick();
  }
}

describe("webhook transport and authentication", () => {
  it("only the exact X-Api-Key header authenticates; nothing is stored otherwise", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    const payload = paidWebhook(user, invoice);
    const attempts = [
      // Sent twice: Node joins the values, which never equals the secret.
      h
        .http()
        .post("/webhooks/lava")
        .set("x-api-key", `${h.webhookSecret}, ${h.webhookSecret}`)
        .send(payload),
      h
        .http()
        .post("/webhooks/lava")
        .set("x-api-key", `${h.webhookSecret} extra`)
        .send(payload),
      h
        .http()
        .post("/webhooks/lava")
        .set("x-api-key", h.webhookSecret.toUpperCase())
        .send(payload),
      h
        .http()
        .post(`/webhooks/lava?x-api-key=${h.webhookSecret}`)
        .send(payload),
      h
        .http()
        .post("/webhooks/lava")
        .set("authorization", `Bearer ${h.webhookSecret}`)
        .send(payload),
      h.http().post("/v1/webhooks/lava").set("x-api-key", h.webhookSecret),
    ];
    const results = await Promise.all(attempts);
    expect(results.map((r) => r.status)).toEqual([
      401, 401, 401, 401, 401, 404,
    ]);
    for (const res of results)
      expect(JSON.stringify(res.body)).not.toContain(h.webhookSecret);
    expect(await eventsFor([invoice.id])).toHaveLength(0);
    expect(await orderRow(orderId)).toMatchObject({ status: "pending" });
  });

  it("a garbled or oversized body gets no 2xx (Lava retries) and stores nothing", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    const garbled = await h
      .http()
      .post("/webhooks/lava")
      .set("x-api-key", h.webhookSecret)
      .set("content-type", "application/json")
      .send(`{"eventType":"payment.success","contractId":"${invoice.id}",`);
    expect(garbled.status).toBe(400);
    expect(garbled.body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(garbled.body)).not.toMatch(/Unexpected|JSON|at /);
    const huge = await h
      .http()
      .post("/webhooks/lava")
      .set("x-api-key", h.webhookSecret)
      .set("content-type", "application/json")
      .send(
        JSON.stringify({
          ...paidWebhook(user, invoice),
          padding: "x".repeat(300_000),
        }),
      );
    expect(huge.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(huge.body)).not.toContain("padding");
    expect(await eventsFor([invoice.id])).toHaveLength(0);
    expect(await orderRow(orderId)).toMatchObject({ status: "pending" });
  });

  it("the buyer email in a webhook never decides whose order is paid", async () => {
    const owner = await newCustomer();
    const other = await newCustomer();
    const mine = await startPurchase(owner, SILVER, "USD");
    const theirs = await startPurchase(other, SILVER, "USD");
    // Lava reports owner's contract, but with the other buyer's email.
    const res = await webhook({
      ...paidWebhook(owner, mine.invoice),
      buyer: { email: other.email },
    }).expect(200);
    expect(res.body.status).toBe("processed");
    expect(await orderRow(mine.orderId)).toMatchObject({ status: "paid" });
    expect(await orderRow(theirs.orderId)).toMatchObject({ status: "pending" });
    expect(await grantsOf(owner.userId)).toHaveLength(1);
    expect(await grantsOf(other.userId)).toHaveLength(0);
    // A contract we never created pays nobody, whatever the email says.
    const stray = await webhook({
      ...paidWebhook(other, theirs.invoice),
      contractId: randomUUID(),
    }).expect(200);
    expect(stray.body.status).toBe("unmatched");
    expect(await grantsOf(other.userId)).toHaveLength(0);
  });
});

describe("exact money against the order snapshot", () => {
  it("accepts only the snapshot amount, in any exact spelling; never rounds", async () => {
    const user = await newCustomer();
    const cases: {
      amount: number | string;
      currency?: string;
      status: string;
    }[] = [
      { amount: "50.00", status: "processed" },
      { amount: 50.001, status: "invalid" },
      { amount: "49.999", status: "invalid" },
      { amount: 5000, status: "mismatch" },
      { amount: 49.99, status: "mismatch" },
      { amount: 0, status: "mismatch" },
      { amount: -50, status: "invalid" },
      { amount: 1e21, status: "invalid" },
      { amount: "5e1", status: "invalid" },
      { amount: 50, currency: "rub", status: "invalid" },
      { amount: 50, currency: "USD", status: "mismatch" },
    ];
    for (const { amount, currency, status } of cases) {
      // Every case needs its own order: a paid silver fleet cannot be bought twice.
      const buyer = status === "processed" ? user : await newCustomer();
      const { orderId, invoice } = await startPurchase(buyer, SILVER, "RUB");
      const res = await webhook({
        ...paidWebhook(buyer, invoice, h.clock.now(), amount),
        ...(currency ? { currency } : {}),
      }).expect(200);
      expect(res.body.status, `${amount} ${currency ?? "RUB"}`).toBe(status);
      const order = await orderRow(orderId);
      expect(order?.status).toBe(status === "processed" ? "paid" : "pending");
      const [payment] = await paymentsOf(orderId);
      if (status === "processed") expect(payment?.amountMinor).toBe(5000n);
      else expect(payment).toBeUndefined();
    }
  });

  it("a client can name only product and currency; price, user and amount fields are refused", async () => {
    const user = await newCustomer();
    const victim = await newCustomer();
    for (const extra of [
      { priceId: randomUUID() },
      { amount: "0.01" },
      { amountMinor: "1" },
      { userId: victim.userId },
      { price: { minor: "1", currency: "USD", scale: 2 } },
    ]) {
      await checkout(user, {
        productKey: SILVER,
        currency: "USD",
        ...extra,
      }).expect(400);
    }
    expect(
      await db.select().from(orders).where(eq(orders.userId, user.userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(orders).where(eq(orders.userId, victim.userId)),
    ).toHaveLength(0);
  });
});

describe("idempotency and concurrency", () => {
  it("ten parallel checkouts with one key reach the provider once", async () => {
    const user = await newCustomer();
    const key = newKey();
    const before = h.lava.createCalls;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.lava.beforeAnswer = () => gate;
    const pending = Array.from({ length: 10 }, () =>
      checkout(user, { productKey: PREMIUM, currency: "EUR" }, key).then(
        (res) => res,
      ),
    );
    // Let every request pass validation while the one provider call is held.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    const results = await Promise.all(pending);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.orderId)).size).toBe(1);
    expect(h.lava.createCalls - before).toBe(1);
    expect(
      await db.select().from(orders).where(eq(orders.userId, user.userId)),
    ).toHaveLength(1);
  });

  it("the key is scoped to the user: another user's same key is a separate order", async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    const key = newKey();
    const first = await checkout(
      a,
      { productKey: SILVER, currency: "USD" },
      key,
    ).expect(200);
    const second = await checkout(
      b,
      { productKey: SILVER, currency: "USD" },
      key,
    ).expect(200);
    expect(second.body.orderId).not.toBe(first.body.orderId);
    // And b cannot read a's order through the shared key.
    await h
      .http()
      .get(`/v1/me/orders/${first.body.orderId}`)
      .set(b.auth)
      .expect(404);
  });

  for (const seed of [1, 7, 42, 1337]) {
    it(`a subscription storm in shuffled order (seed ${seed}) settles to one exact state`, async () => {
      const user = await newCustomer();
      const { orderId, invoice } = await startPurchase(user, PREMIUM, "USD");
      const paidAt = h.clock.now();
      const first = paidWebhook(user, invoice, paidAt);
      const renewalId = randomUUID();
      const renewal = lavaPayloads.renewalSuccess({
        contractId: renewalId,
        parentContractId: invoice.id,
        email: user.email,
        amount: 0.59,
        currency: "USD",
        at: paidAt,
      });
      const staleFailure = lavaPayloads.renewalFailed({
        parentContractId: invoice.id,
        email: user.email,
        amount: 0.59,
        currency: "USD",
        at: new Date(paidAt.getTime() - 3_600_000),
      });
      const lateFirstFailure = lavaPayloads.paymentFailed({
        contractId: invoice.id,
        email: user.email,
        amount: 0.59,
        currency: "USD",
        at: new Date(paidAt.getTime() - 60_000),
        subscription: true,
      });
      const cancelled = lavaPayloads.cancelled({
        contractId: invoice.id,
        email: user.email,
        cancelledAt: paidAt,
        willExpireAt: addMonthsUtc(addMonthsUtc(paidAt, 1), 1),
      });
      // The buyer paid on the page; reconciliation may see it at the same time.
      h.lava.complete(invoice.id, paidAt);
      h.clock.advance(61_000);
      const deliveries: (() => Promise<unknown>)[] = [
        () => webhook(first),
        () => webhook(first),
        () => webhook(Object.fromEntries(Object.entries(first).reverse())),
        () => webhook(renewal),
        () => webhook({ ...renewal, errorMessage: null }),
        () => webhook(staleFailure),
        () => webhook(lateFirstFailure),
        () => webhook(cancelled),
        () => reconciliation.tick(),
      ];
      await Promise.all(shuffled(deliveries, seed).map((send) => send()));
      await drainRetries();

      const [subscription, ...extra] = await subscriptionsOf(orderId);
      expect(extra).toHaveLength(0);
      const paidUntil = addMonthsUtc(addMonthsUtc(paidAt, 1), 1);
      expect(subscription).toMatchObject({
        state: "cancelling",
        autoRenew: false,
      });
      expect(subscription?.paidUntil).toEqual(paidUntil);
      const paid = await paymentsOf(orderId);
      expect(paid.map((p) => p.kind).sort()).toEqual([
        "subscription_initial",
        "subscription_renewal",
      ]);
      expect(
        await db
          .select()
          .from(billingPeriods)
          .where(eq(billingPeriods.subscriptionId, subscription?.id ?? "")),
      ).toHaveLength(2);
      expect(
        await db
          .select()
          .from(financialEntries)
          .where(
            inArray(
              financialEntries.paymentId,
              paid.map((p) => p.id),
            ),
          ),
      ).toHaveLength(2);
      expect(await orderRow(orderId)).toMatchObject({ status: "paid" });

      const [grant, ...more] = await grantsOf(user.userId);
      expect(more).toHaveLength(0);
      expect(grant).toMatchObject({ state: "active", version: 2 });
      expect(grant?.validUntil).toEqual(
        new Date(paidUntil.getTime() + 3 * DAY_MS),
      );
      const grantVersions = (
        await outboxOf("billing.grant.changed.v1", "grantId", grant?.id ?? "")
      ).map((e) => e.aggregateVersion);
      expect(grantVersions.sort()).toEqual([1, 2]);
      expect(
        await outboxOf("billing.payment.confirmed.v1", "orderId", orderId),
      ).toHaveLength(2);
      const subscriptionVersions = (
        await outboxOf(
          "billing.subscription.changed.v1",
          "subscriptionId",
          subscription?.id ?? "",
        )
      )
        .map((e) => e.aggregateVersion)
        .sort((x, y) => x - y);
      expect(subscriptionVersions).toEqual(
        subscriptionVersions.map((_, i) => i + 1),
      );

      const stored = await eventsFor([invoice.id, renewalId]);
      expect(
        stored.filter((e) =>
          ["received", "failed", "unmatched"].includes(e.status),
        ),
      ).toEqual([]);
      const open = await db
        .select()
        .from(reconciliationIssues)
        .where(
          and(
            eq(reconciliationIssues.status, "open"),
            inArray(reconciliationIssues.subjectKey, [
              `contract:${invoice.id}`,
              `contract:${renewalId}`,
              ...stored.map((e) => `event:${e.id}`),
            ]),
          ),
        );
      expect(open).toEqual([]);
    });
  }

  it("a purchase paid by webhook and by reconciliation at once has one effect", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "EUR");
    h.lava.complete(invoice.id);
    h.clock.advance(61_000);
    const payload = paidWebhook(user, invoice);
    await Promise.all([
      webhook(payload),
      reconciliation.tick(),
      webhook(payload),
      webhook({ ...payload, errorMessage: null }),
    ]);
    expect(await paymentsOf(orderId)).toHaveLength(1);
    const [grant, ...more] = await grantsOf(user.userId);
    expect(more).toHaveLength(0);
    expect(grant).toMatchObject({ state: "active", version: 1 });
    expect(
      await outboxOf("billing.payment.confirmed.v1", "orderId", orderId),
    ).toHaveLength(1);
    expect(
      await outboxOf("billing.grant.changed.v1", "grantId", grant?.id ?? ""),
    ).toHaveLength(1);
  });
});

describe("grant lifecycle", () => {
  it("access ends exactly at validUntil: one millisecond before it is still in force", async () => {
    const user = await newCustomer();
    const { orderId } = await startPurchase(user, PREMIUM, "RUB");
    const invoice = h.lava.last();
    await webhook(paidWebhook(user, invoice)).expect(200);
    const [grant] = await grantsOf(user.userId);
    if (!grant?.validUntil) throw new Error("grant without end");
    h.clock.set(new Date(grant.validUntil.getTime() - 1));
    await expiry.tick();
    expect((await grantsOf(user.userId))[0]).toMatchObject({
      state: "active",
      version: 1,
    });
    expect((await subscriptionsOf(orderId))[0]?.state).toBe("past_due");
    h.clock.set(grant.validUntil);
    await expiry.tick();
    expect((await grantsOf(user.userId))[0]).toMatchObject({
      state: "expired",
      version: 2,
    });
    expect((await subscriptionsOf(orderId))[0]?.state).toBe("expired");
  });

  it("an old event replayed after a revoke never brings the grant back", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "USD");
    const payload = paidWebhook(user, invoice);
    await webhook(payload).expect(200);
    const [grant] = await grantsOf(user.userId);
    await h
      .http()
      .post(`/v1/admin/grants/${grant?.id}/revoke`)
      .set(owner.auth)
      .send({ reason: "fraud review" })
      .expect(200);
    // The same delivery, a reformatted copy and a reconciliation fact.
    expect((await webhook(payload).expect(200)).body.status).toBe("duplicate");
    expect(
      (
        await h
          .http()
          .post("/webhooks/lava")
          .set("x-api-key", h.webhookSecret)
          .set("content-type", "application/json")
          .send(JSON.stringify(payload, null, 2))
          .expect(200)
      ).body.status,
    ).toBe("duplicate");
    h.lava.complete(invoice.id);
    await h.app
      .get((await import("./billing/provider-events.js")).ProviderEvents)
      .recordFact(
        {
          kind: "payment",
          outcome: "success",
          recurring: false,
          contractId: invoice.id,
          parentContractId: null,
          amount: "0.59",
          currency: "USD",
          providerStatus: "COMPLETED",
          occurredAt: h.clock.now().toISOString(),
          errorMessage: null,
        },
        `reconcile:${invoice.id}:COMPLETED`,
        { replay: true },
      )
      .then(async (id) => {
        if (id)
          await h.app
            .get((await import("./billing/provider-events.js")).ProviderEvents)
            .process(id);
      });
    const [after, ...more] = await grantsOf(user.userId);
    expect(more).toHaveLength(0);
    expect(after).toMatchObject({ state: "revoked", version: 2 });
    expect(
      await outboxOf("billing.grant.changed.v1", "grantId", grant?.id ?? ""),
    ).toHaveLength(2);
    expect(await paymentsOf(orderId)).toHaveLength(1);
  });

  it("a renewal of a subscription whose grant was revoked keeps the grant revoked", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, PREMIUM, "USD");
    await webhook(paidWebhook(user, invoice)).expect(200);
    const [grant] = await grantsOf(user.userId);
    await h
      .http()
      .post(`/v1/admin/grants/${grant?.id}/revoke`)
      .set(owner.auth)
      .send({ reason: "abuse" })
      .expect(200);
    const [sub] = await subscriptionsOf(orderId);
    h.clock.set(new Date((sub?.paidUntil.getTime() ?? 0) - MINUTE_MS));
    await webhook(
      lavaPayloads.renewalSuccess({
        parentContractId: invoice.id,
        email: user.email,
        amount: 0.59,
        currency: "USD",
        at: h.clock.now(),
      }),
    ).expect(200);
    expect((await grantsOf(user.userId))[0]).toMatchObject({
      state: "revoked",
    });
  });
});

describe("operator visibility of money problems", () => {
  it("a partial refund matched by an operator stays visible as an open issue", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, SILVER, "RUB");
    await webhook(paidWebhook(user, invoice)).expect(200);
    const res = await webhook(
      lavaPayloads.refund({
        tierId: SILVER_OFFER,
        email: user.email,
        amount: 25,
        currency: "RUB",
        refundType: "partial",
        at: h.clock.now(),
      }),
    ).expect(200);
    expect(res.body.status).toBe("unmatched");
    const [event] = await db
      .select()
      .from(providerEvents)
      .where(
        and(
          eq(providerEvents.type, "refund.success"),
          sql`${providerEvents.payload}->'data'->>'customer_email' = ${user.email}`,
        ),
      );
    const refundId = event?.refundId ?? "";
    const [payment] = await paymentsOf(orderId);
    const matched = await h
      .http()
      .post(`/v1/admin/refunds/${refundId}/match`)
      .set(owner.auth)
      .send({ paymentId: payment?.id, reason: "found it in the Lava cabinet" })
      .expect(200);
    expect(matched.body.refund.state).toBe("review_required");
    // Nothing was revoked, so a person has to decide: the issue must be open.
    expect((await grantsOf(user.userId))[0]).toMatchObject({ state: "active" });
    expect(await issueOf(`refund:${refundId}`)).toMatchObject({
      kind: "refund_review",
      status: "open",
    });
  });

  it("a renewal that first arrived without its parent and then mismatches stays an open issue", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, PREMIUM, "USD");
    const renewal = lavaPayloads.renewalSuccess({
      parentContractId: invoice.id,
      email: user.email,
      amount: 0.99,
      currency: "USD",
      at: h.clock.now(),
    });
    expect((await webhook(renewal).expect(200)).body.status).toBe("unmatched");
    await webhook(paidWebhook(user, invoice)).expect(200);
    h.clock.advance(61_000);
    await reconciliation.tick();
    const [event] = await eventsFor([renewal.contractId]);
    expect(event?.status).toBe("mismatch");
    // Money arrived and bought nothing: an operator must see it.
    expect(await paymentsOf(orderId)).toHaveLength(1);
    expect(await issueOf(`contract:${renewal.contractId}`)).toMatchObject({
      kind: "amount_mismatch",
      status: "open",
      severity: "high",
    });
  });
  it("a problem that comes back after it was resolved is open again, with its new kind", async () => {
    const registry = h.app.get(IssueRegistry);
    const subject = `qa:${randomUUID()}`;
    const t0 = h.clock.now();
    await registry.open(
      db,
      { kind: "unmatched_event", severity: "medium", subjectKey: subject },
      t0,
    );
    await registry.open(
      db,
      { kind: "unmatched_event", severity: "medium", subjectKey: subject },
      new Date(t0.getTime() + 1_000),
    );
    expect(await issueOf(subject)).toMatchObject({
      status: "open",
      occurrences: 2,
    });
    await registry.resolve(
      db,
      subject,
      { actorId: null, resolution: "matched on retry" },
      new Date(t0.getTime() + 2_000),
    );
    const later = new Date(t0.getTime() + 3_000);
    await registry.open(
      db,
      {
        kind: "event_failed",
        severity: "high",
        subjectKey: subject,
        evidence: { error: "boom" },
      },
      later,
    );
    expect(await issueOf(subject)).toMatchObject({
      kind: "event_failed",
      severity: "high",
      status: "open",
      resolvedAt: null,
      resolution: null,
      evidence: { error: "boom" },
      firstSeenAt: later,
      lastSeenAt: later,
      occurrences: 3,
    });
  });
});

describe("cancellation retries", () => {
  it("retries an unanswered cancel after 1, 5, 15 min, 1 h and 6 h, then asks an operator", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, PREMIUM, "USD");
    await webhook(paidWebhook(user, invoice)).expect(200);
    const [sub] = await subscriptionsOf(orderId);
    h.lava.cancelMode = "timeout";
    const before = h.lava.cancelCalls.length;
    await h
      .http()
      .post(`/v1/me/subscriptions/${sub?.id}/cancel`)
      .set(user.auth)
      .expect(200);
    const calls = () => h.lava.cancelCalls.length - before;
    expect(calls()).toBe(1);
    for (const [minutes, expected] of [
      [1, 2],
      [5, 3],
      [15, 4],
      [60, 5],
      [360, 6],
    ] as const) {
      h.clock.advance(minutes * MINUTE_MS + 1_000);
      await reconciliation.tick();
      expect(calls(), `after +${minutes} min`).toBe(expected);
    }
    h.clock.advance(DAY_MS);
    await reconciliation.tick();
    expect(calls()).toBe(6);
    expect(await issueOf(`cancel:${sub?.id}`)).toMatchObject({
      kind: "cancel_failed",
      status: "open",
    });
    expect((await subscriptionsOf(orderId))[0]).toMatchObject({
      state: "cancel_requested",
      nextCancelAttemptAt: null,
    });
  });

  it("a cancel still unanswered when access ends keeps being retried until Lava confirms", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, PREMIUM, "USD");
    await webhook(paidWebhook(user, invoice)).expect(200);
    const [sub] = await subscriptionsOf(orderId);
    if (!sub) throw new Error("no subscription");
    const accessEnds = sub.paidUntil.getTime() + 3 * DAY_MS;
    // The buyer cancels in the last half hour of grace and Lava does not answer.
    h.clock.set(new Date(accessEnds - 30 * MINUTE_MS));
    h.lava.cancelMode = "timeout";
    const before = h.lava.cancelCalls.length;
    await h
      .http()
      .post(`/v1/me/subscriptions/${sub.id}/cancel`)
      .set(user.auth)
      .expect(200);
    h.clock.set(new Date(accessEnds));
    await expiry.tick();
    expect((await subscriptionsOf(orderId))[0]).toMatchObject({
      state: "expired",
      autoRenew: true,
    });
    // Lava may still renew this subscription: the command must not be lost.
    h.lava.cancelMode = "ok";
    h.clock.advance(MINUTE_MS);
    await reconciliation.tick();
    expect(h.lava.cancelCalls.length - before).toBe(2);
    expect((await subscriptionsOf(orderId))[0]).toMatchObject({
      state: "expired",
      autoRenew: false,
      nextCancelAttemptAt: null,
    });
    expect(await issueOf(`cancel:${sub.id}`)).toBeUndefined();
  });
});

describe("authorization of admin commands", () => {
  it("every command needs its permission, a fresh token and a reason, and is audited", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const auditor = await newCustomer({ roles: ["auditor"] });
    const plain = await newCustomer();
    const user = await newCustomer();
    const bought = await startPurchase(user, PREMIUM, "USD");
    await webhook(paidWebhook(user, bought.invoice)).expect(200);
    const [sub] = await subscriptionsOf(bought.orderId);
    const [payment] = await paymentsOf(bought.orderId);
    const [grant] = await grantsOf(user.userId);
    const commands: { path: string; body: object; allowed: Customer[] }[] = [
      {
        path: "/v1/admin/grants",
        body: {
          userId: user.userId,
          service: "battleship",
          feature: "premium",
        },
        allowed: [owner],
      },
      {
        path: `/v1/admin/grants/${grant?.id}/revoke`,
        body: {},
        allowed: [owner],
      },
      {
        path: `/v1/admin/subscriptions/${sub?.id}/cancel`,
        body: {},
        allowed: [owner, operator],
      },
      {
        path: `/v1/admin/payments/${payment?.id}/refund-request`,
        body: {},
        allowed: [owner],
      },
      {
        path: `/v1/admin/refunds/${randomUUID()}/match`,
        body: { paymentId: payment?.id },
        allowed: [owner],
      },
    ];
    for (const command of commands) {
      const send = (who: Customer | null, body: object) => {
        const req = h.http().post(command.path);
        if (who) req.set(who.auth);
        return req.send(body);
      };
      await send(null, { ...command.body, reason: "no token" }).expect(401);
      for (const who of [plain, auditor, operator, owner]) {
        if (command.allowed.includes(who)) continue;
        await send(who, { ...command.body, reason: "not allowed" }).expect(403);
      }
      for (const who of command.allowed) {
        await send(who, command.body).expect(400);
        await send(who, { ...command.body, reason: "  " }).expect(400);
      }
    }
    // A role change after the token was issued: the old token is refused.
    await customers.apply({
      ...(await import("@outegro/contracts")).createEvent(
        (await import("@outegro/contracts")).identityRoleBindingChanged,
        {
          aggregateId: randomUUID(),
          aggregateVersion: 1,
          payload: {
            bindingId: randomUUID(),
            userId: operator.userId,
            roleKey: "billing_operator",
            scope: "platform",
            state: "revoked",
            accessVersion: 5,
          },
        },
      ),
    });
    await h
      .http()
      .post(`/v1/admin/subscriptions/${sub?.id}/cancel`)
      .set(operator.auth)
      .send({ reason: "customer asked" })
      .expect(401);
    expect(
      h.lava.cancelCalls.some((c) => c.parentContractId === bought.invoice.id),
    ).toBe(false);
    // Reads need billing.read.
    await h.http().get("/v1/admin/orders").set(plain.auth).expect(403);
    await h.http().get("/v1/admin/orders").set(auditor.auth).expect(200);
    // The allowed command writes its audit row with the reason.
    await h
      .http()
      .post(`/v1/admin/payments/${payment?.id}/refund-request`)
      .set(owner.auth)
      .send({ reason: "buyer asked by email" })
      .expect(201);
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, payment?.id ?? ""));
    expect(entry).toMatchObject({
      action: "refund.requested",
      actorId: owner.userId,
      reason: "buyer asked by email",
    });
    expect(
      await db
        .select()
        .from(refunds)
        .where(eq(refunds.paymentId, payment?.id ?? "")),
    ).toHaveLength(1);
  });
});

describe("configuration safety", () => {
  const base = {
    PORT: "4003",
    DATABASE_URL: "postgres://u:p@localhost:5432/payments",
    VALKEY_URL: "redis://localhost:6379",
    RABBITMQ_URL: "amqp://u:p@localhost:5672",
    AUTH_JWKS_URL: "http://localhost:4001/.well-known/jwks.json",
    AUTH_ISSUER: "http://localhost:4001",
    AUTH_AUDIENCE: "outegro",
    LAVA_WEBHOOK_SECRET: "s".repeat(32),
  };

  it("sales are closed by default and an empty API key means no provider", () => {
    const parsed = env.schema.parse({ ...base, LAVA_API_KEY: "" });
    expect(parsed.CHECKOUT_ENABLED).toBe(false);
    expect(parsed.LAVA_API_KEY).toBeUndefined();
    expect(parsed.LAVA_API_URL).toBe("https://gate.lava.top");
    expect(
      env.schema.parse({ ...base, CHECKOUT_ENABLED: "1" }).CHECKOUT_ENABLED,
    ).toBe(true);
    expect(
      env.schema.safeParse({ ...base, CHECKOUT_ENABLED: "maybe" }).success,
    ).toBe(false);
  });

  it("a missing or short webhook secret stops startup without echoing values", () => {
    const { LAVA_WEBHOOK_SECRET: _, ...without } = base;
    expect(env.schema.safeParse(without).success).toBe(false);
    const short = env.schema.safeParse({
      ...base,
      LAVA_WEBHOOK_SECRET: "short-secret-value",
    });
    expect(short.success).toBe(false);
    expect(
      JSON.stringify(short.error?.issues.map((i) => i.message)),
    ).not.toContain("short-secret-value");
  });
});

describe("database constraints behind the invariants", () => {
  it("rejects a second period, grant or journal entry for the same source", async () => {
    const user = await newCustomer();
    const { orderId, invoice } = await startPurchase(user, PREMIUM, "USD");
    await webhook(paidWebhook(user, invoice)).expect(200);
    const [payment] = await paymentsOf(orderId);
    const [sub] = await subscriptionsOf(orderId);
    const [grant] = await grantsOf(user.userId);
    const now = h.clock.now();
    await expect(
      db.insert(billingPeriods).values({
        subscriptionId: sub?.id ?? "",
        paymentId: payment?.id ?? "",
        periodStart: now,
        periodEnd: new Date(now.getTime() + DAY_MS),
        createdAt: now,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(grants).values({
        userId: user.userId,
        service: grant?.service ?? "",
        feature: grant?.feature ?? "",
        sourceType: "subscription",
        sourceId: sub?.id ?? "",
        state: "active",
        validFrom: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(financialEntries).values({
        type: "payment",
        sourceRef: `payment:${payment?.id}`,
        currency: "USD",
        amountMinor: 59n,
        occurredAt: now,
        createdAt: now,
      }),
    ).rejects.toThrow();
    await expect(
      db
        .update(payments)
        .set({ amountMinor: 0n })
        .where(eq(payments.id, payment?.id ?? "")),
    ).rejects.toThrow();
  });
});
