import { randomUUID } from "node:crypto";
import {
  type AnyEvent,
  billingGrantChanged,
  billingPaymentConfirmed,
  createEvent,
  defineQueue,
  identityRoleBindingChanged,
} from "@outegro/contracts";
import { DATABASE, HealthRegistry, Messaging } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PaymentsDatabase } from "./common/database.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  auditLog,
  customers as customerTable,
  grants,
  outbox,
  payments,
  providerEvents,
  reconciliationIssues,
  subscriptions,
} from "./db/schema.js";
import { catalog } from "./domain/catalog.js";
import type { Currency } from "./domain/money.js";
import { customerEvents, type Harness, startHarness } from "./test/harness.js";
import { lavaPayloads } from "./test/lava-payloads.js";
import { ReconciliationWorker } from "./workers/reconciliation.worker.js";

const PREMIUM = "battleship-premium";
const SILVER = "battleship-silver-fleet";
const SILVER_OFFER =
  catalog.find((p) => p.key === SILVER)?.providerOfferId ?? "";

let h: Harness;
let db: PaymentsDatabase["db"];
let customers: CustomersService;
let reconciliation: ReconciliationWorker;

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<PaymentsDatabase>(DATABASE).db;
  customers = h.app.get(CustomersService);
  reconciliation = h.app.get(ReconciliationWorker);
});
afterAll(() => h?.close());
beforeEach(() => {
  h.clock.set(new Date());
  h.lava.reset();
});

type Customer = Awaited<ReturnType<typeof newCustomer>>;

async function newCustomer(options: { roles?: string[]; email?: string } = {}) {
  const userId = randomUUID();
  const email = options.email ?? `admin.${userId.slice(0, 8)}@example.test`;
  for (const event of customerEvents(userId, email))
    await customers.apply(event);
  const token = await h.tokenFor(userId, options.roles ?? []);
  return { userId, email, auth: { authorization: `Bearer ${token}` } };
}

const post = (path: string, user: Customer, body: object) =>
  h.http().post(path).set(user.auth).send(body);
const get = (path: string, user: Customer) => h.http().get(path).set(user.auth);

async function buy(user: Customer, productKey: string, currency: Currency) {
  const res = await h
    .http()
    .post("/v1/checkout")
    .set(user.auth)
    .set("idempotency-key", `admin-${randomUUID()}`)
    .send({ productKey, currency })
    .expect(200);
  const invoice = h.lava.last();
  await h
    .http()
    .post("/webhooks/lava")
    .set("x-api-key", h.webhookSecret)
    .send(
      lavaPayloads.paymentSuccess({
        contractId: invoice.id,
        email: user.email,
        amount: Number(invoice.amount),
        currency,
        at: h.clock.now(),
        subscription: invoice.type === "SUBSCRIPTION_FIRST_INVOICE",
      }),
    )
    .expect(200);
  return { orderId: res.body.orderId as string, invoiceId: invoice.id };
}

const auditOf = (targetId: string) =>
  db.select().from(auditLog).where(eq(auditLog.targetId, targetId));
const grantEvents = (grantId: string) =>
  db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(
      and(
        eq(outbox.type, billingGrantChanged.type),
        sql`${outbox.envelope}->'payload'->>'grantId' = ${grantId}`,
      ),
    )
    .then((rows) =>
      rows.map(
        (row) =>
          row.envelope as AnyEvent & {
            payload: { state: string; sourceType: string };
          },
      ),
    );

describe("manual grants (A-05, INV-22)", () => {
  it("a manual grant requires grants.assign, a reason, and writes audit", async () => {
    const plain = await newCustomer();
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const owner = await newCustomer({ roles: ["owner"] });
    const target = await newCustomer();
    const validUntil = new Date(
      h.clock.now().getTime() + 7 * 86_400_000,
    ).toISOString();
    const body = {
      userId: target.userId,
      service: "battleship",
      feature: "premium",
      validUntil,
      reason: "tester access for the beta",
    };
    await h.http().post("/v1/admin/grants").send(body).expect(401);
    await post("/v1/admin/grants", plain, body).expect(403);
    await post("/v1/admin/grants", operator, body).expect(403);
    const { reason: _reason, ...withoutReason } = body;
    await post("/v1/admin/grants", owner, withoutReason).expect(400);
    await post("/v1/admin/grants", owner, { ...body, reason: "x" }).expect(400);
    await post("/v1/admin/grants", owner, {
      ...body,
      validUntil: new Date(h.clock.now().getTime() - 1000).toISOString(),
    }).expect(422);
    expect(
      await db.select().from(grants).where(eq(grants.userId, target.userId)),
    ).toHaveLength(0);

    const created = await post("/v1/admin/grants", owner, body).expect(201);
    expect(created.body).toMatchObject({
      userId: target.userId,
      service: "battleship",
      feature: "premium",
      sourceType: "manual",
      state: "active",
      validUntil,
      version: 1,
    });
    const [entry] = await auditOf(created.body.id);
    expect(entry).toMatchObject({
      actorId: owner.userId,
      action: "grant.created",
      targetType: "grant",
      reason: "tester access for the beta",
    });
    expect(entry?.requestId).toBeTruthy();
    const [event] = await grantEvents(created.body.id);
    expect(event?.payload).toMatchObject({
      sourceType: "manual",
      state: "active",
    });
    await post("/v1/admin/grants", owner, body).expect(409);

    await post(`/v1/admin/grants/${created.body.id}/revoke`, plain, {
      reason: "done",
    }).expect(403);
    await post(`/v1/admin/grants/${created.body.id}/revoke`, owner, {}).expect(
      400,
    );
    const revoked = await post(
      `/v1/admin/grants/${created.body.id}/revoke`,
      owner,
      {
        reason: "beta finished",
      },
    ).expect(200);
    expect(revoked.body).toMatchObject({ state: "revoked", version: 2 });
    expect(
      (await auditOf(created.body.id)).map((a) => a.action).sort(),
    ).toEqual(["grant.created", "grant.revoked"]);
    expect(
      (await grantEvents(created.body.id)).map((e) => e.payload.state).sort(),
    ).toEqual(["active", "revoked"]);
    await post(`/v1/admin/grants/${created.body.id}/revoke`, owner, {
      reason: "again",
    }).expect(422);
    await post(`/v1/admin/grants/${randomUUID()}/revoke`, owner, {
      reason: "missing",
    }).expect(404);
  });

  it("a token older than the latest role change cannot run admin commands", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const target = await newCustomer();
    await customers.apply(
      createEvent(identityRoleBindingChanged, {
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: {
          bindingId: randomUUID(),
          userId: owner.userId,
          roleKey: "owner",
          scope: "platform",
          state: "active",
          accessVersion: 3,
        },
      }),
    );
    const body = {
      userId: target.userId,
      service: "battleship",
      feature: "premium",
      reason: "stale token test",
    };
    const stale = await post("/v1/admin/grants", owner, body).expect(401);
    expect(stale.body.error.code).toBe("UNAUTHENTICATED");
    const fresh = {
      ...owner,
      auth: {
        authorization: `Bearer ${await h.tokenFor(owner.userId, ["owner"], 3)}`,
      },
    };
    await post("/v1/admin/grants", fresh, body).expect(201);
    const [row] = await db
      .select()
      .from(customerTable)
      .where(eq(customerTable.userId, owner.userId));
    expect(row?.accessVersion).toBe(3);
  });

  it("TC-PAY-06-01: revoking the purchase grant leaves a manual grant of the same feature", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    await buy(user, SILVER, "USD");
    await post("/v1/admin/grants", owner, {
      userId: user.userId,
      service: "battleship",
      feature: "cosmetics.silver-fleet",
      reason: "compensation for a bug",
    }).expect(201);
    const rows = await db
      .select()
      .from(grants)
      .where(eq(grants.userId, user.userId));
    const purchase = rows.find((g) => g.sourceType === "purchase");
    const calls = h.lava.cancelCalls.length;
    await post(`/v1/admin/grants/${purchase?.id}/revoke`, owner, {
      reason: "fraud check",
    }).expect(200);
    // A one-time purchase has no renewal to stop.
    expect(h.lava.cancelCalls).toHaveLength(calls);
    const after = await db
      .select()
      .from(grants)
      .where(eq(grants.userId, user.userId));
    expect(after.find((g) => g.sourceType === "purchase")?.state).toBe(
      "revoked",
    );
    expect(after.find((g) => g.sourceType === "manual")?.state).toBe("active");
  });
});

describe("revoking a subscription grant stops its renewal at Lava", () => {
  const subscriptionOf = (orderId: string) =>
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.orderId, orderId))
      .then((rows) => rows[0]);
  const grantOf = (userId: string) =>
    db
      .select()
      .from(grants)
      .where(eq(grants.userId, userId))
      .then((rows) => rows[0]);
  const issueOf = (subjectKey: string) =>
    db
      .select()
      .from(reconciliationIssues)
      .where(eq(reconciliationIssues.subjectKey, subjectKey))
      .then((rows) => rows[0]);
  const cancelCallsFor = (contractId: string) =>
    h.lava.cancelCalls.filter((call) => call.parentContractId === contractId);

  async function revokedPremium(currency: Currency = "USD") {
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    const { orderId, invoiceId } = await buy(user, PREMIUM, currency);
    const grant = await grantOf(user.userId);
    const res = await post(`/v1/admin/grants/${grant?.id}/revoke`, owner, {
      reason: "abuse of the ranked queue",
    }).expect(200);
    // The revoke stands whatever Lava answered.
    expect(res.body).toMatchObject({ id: grant?.id, state: "revoked" });
    const subscription = await subscriptionOf(orderId);
    if (!subscription || !grant) throw new Error("no subscription");
    return { owner, user, orderId, invoiceId, grant, subscription };
  }

  it("revoke cancels the renewal at Lava exactly once", async () => {
    const { owner, user, invoiceId, grant, subscription } =
      await revokedPremium();
    expect(cancelCallsFor(invoiceId)).toEqual([
      { parentContractId: invoiceId, email: user.email },
    ]);
    expect(subscription).toMatchObject({
      state: "cancelling",
      autoRenew: false,
      nextCancelAttemptAt: null,
    });
    const [entry] = await auditOf(grant.id);
    expect(entry).toMatchObject({
      action: "grant.revoked",
      data: { sourceType: "subscription", stopsRenewal: true },
    });
    // Nothing is sent twice: the revoke is refused, the worker has nothing due.
    await post(`/v1/admin/grants/${grant.id}/revoke`, owner, {
      reason: "second click",
    }).expect(422);
    h.clock.advance(10 * 60_000);
    await reconciliation.tick();
    expect(cancelCallsFor(invoiceId)).toHaveLength(1);
  });

  it("a cancel Lava does not answer keeps the revoke, opens renewal_cancel_failed and is retried", async () => {
    h.lava.cancelMode = "timeout";
    const { user, invoiceId, subscription } = await revokedPremium("EUR");
    expect(await grantOf(user.userId)).toMatchObject({ state: "revoked" });
    expect(subscription).toMatchObject({
      state: "cancel_requested",
      autoRenew: true,
      cancelAttempts: 1,
    });
    expect(await issueOf(`cancel:${subscription.id}`)).toMatchObject({
      kind: "renewal_cancel_failed",
      severity: "high",
      status: "open",
      related: { subscriptionId: subscription.id },
      evidence: { reason: "timeout", attempts: 1 },
    });
    // The next try gets through: renewal is off and the issue closes itself.
    h.lava.cancelMode = "ok";
    h.clock.advance(61_000);
    await reconciliation.tick();
    expect(cancelCallsFor(invoiceId)).toHaveLength(2);
    expect(await subscriptionOf(subscription.orderId)).toMatchObject({
      state: "cancelling",
      autoRenew: false,
    });
    expect(await issueOf(`cancel:${subscription.id}`)).toMatchObject({
      status: "resolved",
      resolution: "renewal cancelled at the provider",
    });
  });

  it("a cancel Lava refuses waits for an operator, who can send it again", async () => {
    h.lava.cancelMode = "reject";
    const { invoiceId, subscription } = await revokedPremium();
    expect(subscription).toMatchObject({
      state: "cancel_requested",
      autoRenew: true,
      nextCancelAttemptAt: null,
    });
    expect(await issueOf(`cancel:${subscription.id}`)).toMatchObject({
      kind: "renewal_cancel_failed",
      status: "open",
      evidence: { reason: "lava_400" },
    });
    h.lava.cancelMode = "ok";
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const res = await post(
      `/v1/admin/subscriptions/${subscription.id}/cancel`,
      operator,
      { reason: "Lava support fixed the contract" },
    ).expect(200);
    expect(res.body).toMatchObject({ state: "cancelling", autoRenew: false });
    expect(cancelCallsFor(invoiceId)).toHaveLength(2);
    expect(await issueOf(`cancel:${subscription.id}`)).toMatchObject({
      status: "resolved",
    });
    // Confirmed off: sending again calls nobody.
    await post(`/v1/admin/subscriptions/${subscription.id}/cancel`, operator, {
      reason: "once more",
    }).expect(200);
    expect(cancelCallsFor(invoiceId)).toHaveLength(2);
  });

  it("a renewal Lava charges after the revoke grants nothing and asks for a refund", async () => {
    h.lava.cancelMode = "timeout";
    const { user, orderId, invoiceId, grant } = await revokedPremium();
    const res = await h
      .http()
      .post("/webhooks/lava")
      .set("x-api-key", h.webhookSecret)
      .send(
        lavaPayloads.renewalSuccess({
          parentContractId: invoiceId,
          email: user.email,
          amount: 0.59,
          currency: "USD",
          at: h.clock.now(),
        }),
      )
      .expect(200);
    expect(res.body.status).toBe("processed");
    expect(await grantOf(user.userId)).toMatchObject({
      state: "revoked",
      version: 2,
    });
    expect(
      (await grantEvents(grant.id)).map((e) => e.payload.state).sort(),
    ).toEqual(["active", "revoked"]);
    const renewal = (
      await db.select().from(payments).where(eq(payments.orderId, orderId))
    ).find((payment) => payment.kind === "subscription_renewal");
    expect(renewal).toMatchObject({ state: "confirmed", amountMinor: 59n });
    expect(await issueOf(`payment:${renewal?.id}`)).toMatchObject({
      kind: "renewal_after_revoke",
      severity: "high",
      status: "open",
      related: { paymentId: renewal?.id, grantId: grant.id },
      evidence: { paid: { minor: "59", currency: "USD", scale: 2 } },
    });
  });
});

describe("admin reads", () => {
  it("lists orders, payments, subscriptions and events; an order shows its whole chain", async () => {
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const plain = await newCustomer();
    const user = await newCustomer();
    const { orderId, invoiceId } = await buy(user, PREMIUM, "RUB");
    await get("/v1/admin/orders", plain).expect(403);

    const list = await get(
      `/v1/admin/orders?userId=${user.userId}`,
      operator,
    ).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: orderId,
      status: "paid",
      userId: user.userId,
    });

    const detail = await get(`/v1/admin/orders/${orderId}`, operator).expect(
      200,
    );
    expect(detail.body.order).toMatchObject({ id: orderId, status: "paid" });
    expect(detail.body.attempt).toMatchObject({
      state: "ready",
      providerInvoiceId: invoiceId,
    });
    expect(detail.body.payments).toHaveLength(1);
    expect(detail.body.payments[0]).toMatchObject({
      kind: "subscription_initial",
      money: { minor: "5000", currency: "RUB", scale: 2 },
    });
    expect(detail.body.subscription).toMatchObject({
      state: "active",
      autoRenew: true,
    });
    expect(detail.body.grants).toHaveLength(1);
    expect(detail.body.events).toHaveLength(1);
    expect(detail.body.events[0]).toMatchObject({
      type: "payment.success",
      status: "processed",
    });
    expect(detail.body.events[0]).not.toHaveProperty("payload");
    await get(`/v1/admin/orders/${randomUUID()}`, operator).expect(404);

    const event = await get(
      `/v1/admin/provider-events/${detail.body.events[0].id}`,
      operator,
    ).expect(200);
    expect(event.body.payload).toMatchObject({ contractId: invoiceId });
    const byContract = await get(
      `/v1/admin/provider-events?contractId=${invoiceId}`,
      operator,
    ).expect(200);
    expect(byContract.body.items).toHaveLength(1);
    const paymentsList = await get(
      `/v1/admin/payments?userId=${user.userId}`,
      operator,
    ).expect(200);
    expect(paymentsList.body.items).toHaveLength(1);
    const subs = await get(
      `/v1/admin/subscriptions?userId=${user.userId}`,
      operator,
    ).expect(200);
    expect(subs.body.items[0]).toMatchObject({
      state: "active",
      userId: user.userId,
    });
    const grantList = await get(
      `/v1/admin/grants?userId=${user.userId}`,
      operator,
    ).expect(200);
    expect(grantList.body.items[0]).toMatchObject({
      sourceType: "subscription",
      state: "active",
    });
    await get("/v1/admin/issues?status=open", operator).expect(200);
    await get("/v1/admin/refunds", operator).expect(200);
  });

  it("pages with an opaque cursor and rejects a tampered one", async () => {
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const user = await newCustomer();
    // One unpaid order per product and currency: three currencies, three orders.
    for (const currency of ["USD", "EUR", "RUB"]) {
      h.clock.advance(1000);
      await h
        .http()
        .post("/v1/checkout")
        .set(user.auth)
        .set("idempotency-key", `page-${randomUUID()}`)
        .send({ productKey: SILVER, currency })
        .expect(200);
    }
    const first = await get(
      `/v1/admin/orders?userId=${user.userId}&limit=2`,
      operator,
    ).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await get(
      `/v1/admin/orders?userId=${user.userId}&limit=2&cursor=${first.body.nextCursor}`,
      operator,
    ).expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map(
      (o: { id: string }) => o.id,
    );
    expect(new Set(ids).size).toBe(3);
    const mine = await get("/v1/me/orders?limit=2", user).expect(200);
    expect(mine.body.items).toHaveLength(2);
    const bad = Buffer.from("2026-01-01T00:00:00.000Z|not-a-uuid").toString(
      "base64url",
    );
    await get(`/v1/admin/orders?cursor=${bad}`, operator).expect(400);
  });
});

describe("admin commands", () => {
  it("a billing operator can stop a renewal with a reason; it is audited, not refunded", async () => {
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const plain = await newCustomer();
    const user = await newCustomer();
    const { orderId, invoiceId } = await buy(user, PREMIUM, "USD");
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.orderId, orderId));
    await post(`/v1/admin/subscriptions/${sub?.id}/cancel`, plain, {
      reason: "asked",
    }).expect(403);
    await post(
      `/v1/admin/subscriptions/${sub?.id}/cancel`,
      operator,
      {},
    ).expect(400);
    const res = await post(
      `/v1/admin/subscriptions/${sub?.id}/cancel`,
      operator,
      {
        reason: "customer asked by email",
      },
    ).expect(200);
    expect(res.body).toMatchObject({ state: "cancelling", autoRenew: false });
    expect(h.lava.cancelCalls.at(-1)).toEqual({
      parentContractId: invoiceId,
      email: user.email,
    });
    const [entry] = await auditOf(sub?.id ?? "");
    expect(entry).toMatchObject({
      action: "subscription.cancel",
      actorId: operator.userId,
    });
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
    expect(payment?.state).toBe("confirmed");
  });

  it("an operator links an unmatched refund to its purchase with a reason", async () => {
    const owner = await newCustomer({ roles: ["owner"] });
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const user = await newCustomer();
    const { orderId } = await buy(user, SILVER, "EUR");
    const res = await h
      .http()
      .post("/webhooks/lava")
      .set("x-api-key", h.webhookSecret)
      .send(
        lavaPayloads.refund({
          tierId: SILVER_OFFER,
          email: user.email,
          amount: 0.52,
          currency: "EUR",
          at: h.clock.now(),
        }),
      )
      .expect(200);
    // One look-alike purchase is still not proof: nothing happens by itself.
    expect(res.body.status).toBe("unmatched");
    const unmatched = await get(
      "/v1/admin/refunds?state=unmatched",
      owner,
    ).expect(200);
    const refund = unmatched.body.items[0];
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
    expect(refund.evidence.candidatePaymentIds).toEqual([payment?.id]);
    await post(`/v1/admin/refunds/${refund.id}/match`, operator, {
      paymentId: payment?.id,
      reason: "checked in the Lava cabinet",
    }).expect(403);
    const matched = await post(`/v1/admin/refunds/${refund.id}/match`, owner, {
      paymentId: payment?.id,
      reason: "checked in the Lava cabinet",
    }).expect(200);
    expect(matched.body.refund).toMatchObject({
      state: "recorded",
      paymentId: payment?.id,
    });
    const [grant] = await db
      .select()
      .from(grants)
      .where(eq(grants.userId, user.userId));
    expect(grant).toMatchObject({ state: "revoked" });
    const [entry] = await auditOf(refund.id);
    expect(entry).toMatchObject({
      action: "refund.matched",
      actorId: owner.userId,
    });
    const [issue] = await db
      .select()
      .from(reconciliationIssues)
      .where(eq(reconciliationIssues.subjectKey, `refund:${refund.id}`));
    expect(issue).toMatchObject({
      status: "resolved",
      resolvedBy: owner.userId,
    });
    const [event] = await db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.refundId, refund.id));
    expect(event).toMatchObject({
      status: "processed",
      paymentId: payment?.id,
    });
    expect(event?.note).toContain("matched by operator");
    await post(`/v1/admin/refunds/${refund.id}/match`, owner, {
      paymentId: payment?.id,
      reason: "second time",
    }).expect(422);
  });

  it("refund requests need refunds.request and a confirmed payment", async () => {
    const operator = await newCustomer({ roles: ["billing_operator"] });
    const owner = await newCustomer({ roles: ["owner"] });
    const user = await newCustomer();
    const { orderId } = await buy(user, SILVER, "RUB");
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId));
    const path = `/v1/admin/payments/${payment?.id}/refund-request`;
    await post(path, operator, { reason: "please" }).expect(403);
    const first = await post(path, owner, { reason: "buyer asked" }).expect(
      201,
    );
    expect(first.body).toMatchObject({
      state: "requested",
      kind: "refund",
      paymentId: payment?.id,
    });
    const again = await post(path, owner, {
      reason: "buyer asked twice",
    }).expect(201);
    expect(again.body.id).toBe(first.body.id);
    const [entry] = await auditOf(payment?.id ?? "");
    expect(entry).toMatchObject({
      action: "refund.requested",
      reason: "buyer asked",
    });
    await post(`/v1/admin/payments/${randomUUID()}/refund-request`, owner, {
      reason: "nope",
    }).expect(404);
  });
});

describe("stats", () => {
  it("reports revenue per currency and day, live subscriptions and conversion", async () => {
    const operator = await newCustomer({ roles: ["billing_operator"] });
    // A day nobody else uses, so the numbers are exactly ours.
    h.clock.set(new Date("2031-01-01T10:00:00.000Z"));
    const a = await newCustomer();
    const b = await newCustomer();
    const c = await newCustomer();
    const d = await newCustomer();
    await buy(a, SILVER, "RUB");
    await buy(b, PREMIUM, "RUB");
    await buy(c, PREMIUM, "USD");
    await h
      .http()
      .post("/v1/checkout")
      .set(d.auth)
      .set("idempotency-key", `stats-${randomUUID()}`)
      .send({ productKey: SILVER, currency: "USD" })
      .expect(200);
    const res = await get(
      "/v1/admin/stats?from=2031-01-01T00:00:00.000Z&to=2031-01-02T00:00:00.000Z",
      operator,
    ).expect(200);
    expect(res.body.revenue.byDay).toEqual([
      {
        day: "2031-01-01",
        currency: "RUB",
        gross: { minor: "10000", currency: "RUB", scale: 2 },
        refunded: { minor: "0", currency: "RUB", scale: 2 },
        net: { minor: "10000", currency: "RUB", scale: 2 },
        payments: 2,
      },
      {
        day: "2031-01-01",
        currency: "USD",
        gross: { minor: "59", currency: "USD", scale: 2 },
        refunded: { minor: "0", currency: "USD", scale: 2 },
        net: { minor: "59", currency: "USD", scale: 2 },
        payments: 1,
      },
    ]);
    expect(res.body.revenue.totals).toHaveLength(2);
    expect(res.body.activeSubscriptions).toEqual({
      total: 2,
      byProduct: [{ productKey: PREMIUM, count: 2 }],
    });
    expect(res.body.conversion).toEqual([
      { productKey: PREMIUM, checkouts: 2, paid: 2, failed: 0, pending: 0 },
      { productKey: SILVER, checkouts: 2, paid: 1, failed: 0, pending: 1 },
    ]);
    await get(
      "/v1/admin/stats?from=2031-01-02T00:00:00.000Z&to=2031-01-01T00:00:00.000Z",
      operator,
    ).expect(400);
    await get("/v1/admin/stats", await newCustomer()).expect(403);
  });
});

describe("service", () => {
  it("answers liveness and readiness like the other services", async () => {
    const live = await h.http().get("/health").expect(200);
    expect(live.body.status).toBe("ok");
    const deep = await h.http().get("/health/deep").expect(200);
    expect(Object.keys(deep.body.info).sort()).toEqual([
      "postgres",
      "rabbitmq",
      "valkey",
    ]);
    await h.http().get("/v1/health").expect(404);
  });

  it("consumes Identity events from RabbitMQ and publishes billing events", async () => {
    const identity = new Messaging(
      { url: h.rabbitUrl, service: "identity" },
      new HealthRegistry(),
    );
    const admin = new Messaging(
      { url: h.rabbitUrl, service: "admin" },
      new HealthRegistry(),
    );
    const received: AnyEvent[] = [];
    await admin.subscribe(
      defineQueue("admin", `payments-test-${randomUUID().slice(0, 8)}`, [
        {
          producer: "payments",
          types: [billingPaymentConfirmed.type, billingGrantChanged.type],
        },
      ]),
      async (event) => {
        received.push(event);
      },
    );
    try {
      const userId = randomUUID();
      const email = `broker.${userId.slice(0, 8)}@example.test`;
      for (const event of customerEvents(userId, email))
        await identity.publish("identity.events", event);
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        const [row] = await db
          .select()
          .from(customerTable)
          .where(eq(customerTable.userId, userId));
        if (row?.email === email) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const user = {
        userId,
        email,
        auth: { authorization: `Bearer ${await h.tokenFor(userId)}` },
      };
      const { orderId } = await buy(user, SILVER, "USD");
      const confirmedFor = (e: AnyEvent) =>
        e.type === billingPaymentConfirmed.type &&
        (e.payload as { orderId: string }).orderId === orderId;
      const grantFor = (e: AnyEvent) =>
        e.type === billingGrantChanged.type &&
        (e.payload as { userId: string }).userId === userId;
      // Both are written in one transaction; the relay may publish either first.
      const deadline = Date.now() + 15_000;
      while (
        Date.now() < deadline &&
        !(received.some(confirmedFor) && received.some(grantFor))
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(received.find(confirmedFor)?.producer).toBe("payments");
      expect(received.some(grantFor)).toBe(true);
    } finally {
      await identity.onApplicationShutdown();
      await admin.onApplicationShutdown();
    }
  });
});
