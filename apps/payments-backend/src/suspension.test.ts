import { randomUUID } from "node:crypto";
import {
  createEvent,
  identityRoleBindingChanged,
  identityUserStatusChanged,
} from "@outegro/contracts";
import { DATABASE } from "@outegro/nest-common";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PaymentsDatabase } from "./common/database.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  auditLog,
  customers as customerTable,
  grants,
  orders,
  payments,
  reconciliationIssues,
  refunds,
  subscriptions,
} from "./db/schema.js";
import { customerEvents, type Harness, startHarness } from "./test/harness.js";
import { lavaPayloads } from "./test/lava-payloads.js";
import { ExpiryWorker } from "./workers/expiry.worker.js";
import { ReconciliationWorker } from "./workers/reconciliation.worker.js";

/**
 * TC-ID-10-04 in Payments: Identity suspends an account while its access
 * token (up to 5 minutes) is still valid. Purchases, refunds, grants and
 * subscription changes check the account again and refuse, leaving no
 * trace of the attempt.
 */

const PREMIUM = "battleship-premium";

let h: Harness;
let db: PaymentsDatabase["db"];
let customers: CustomersService;

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<PaymentsDatabase>(DATABASE).db;
  customers = h.app.get(CustomersService);
});
afterAll(() => h?.close());
beforeEach(() => {
  h.clock.set(new Date());
  h.lava.reset();
});

async function newCustomer(roles: string[] = []) {
  const userId = randomUUID();
  const email = `account.${userId.slice(0, 8)}@example.test`;
  for (const event of customerEvents(userId, email))
    await customers.apply(event);
  const token = await h.tokenFor(userId, roles);
  return { userId, email, auth: { authorization: `Bearer ${token}` } };
}

type Customer = Awaited<ReturnType<typeof newCustomer>>;

/** What Identity publishes on suspension; the token above predates it. */
const suspend = (user: Customer) =>
  customers.apply(
    createEvent(identityUserStatusChanged, {
      aggregateId: user.userId,
      aggregateVersion: 2,
      payload: { userId: user.userId, status: "suspended", accessVersion: 1 },
    }),
  );

/** A status change as Identity publishes it: every change bumps accessVersion. */
const statusEvent = (
  user: { userId: string },
  status: "active" | "suspended" | "deleted",
  accessVersion: number,
) =>
  createEvent(identityUserStatusChanged, {
    aggregateId: user.userId,
    aggregateVersion: accessVersion + 1,
    payload: { userId: user.userId, status, accessVersion },
  });

/** A role granted in Identity: it bumps accessVersion too, not the status. */
const roleChanged = (user: { userId: string }, accessVersion: number) =>
  createEvent(identityRoleBindingChanged, {
    aggregateId: randomUUID(),
    aggregateVersion: 1,
    payload: {
      bindingId: randomUUID(),
      userId: user.userId,
      roleKey: "support",
      scope: "platform",
      state: "active",
      accessVersion,
    },
  });

async function buyPremium(user: Customer) {
  const res = await h
    .http()
    .post("/v1/checkout")
    .set(user.auth)
    .set("idempotency-key", `suspension-${randomUUID()}`)
    .send({ productKey: PREMIUM, currency: "USD" })
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
        currency: "USD",
        at: h.clock.now(),
        subscription: true,
      }),
    )
    .expect(200);
  const orderId = res.body.orderId as string;
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orderId, orderId));
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId));
  if (!subscription || !payment) throw new Error("purchase did not complete");
  return { subscription, payment };
}

describe("TC-ID-10-04: a suspended account with an unexpired token", () => {
  it("cannot start a purchase", async () => {
    const buyer = await newCustomer();
    await suspend(buyer);
    const res = await h
      .http()
      .post("/v1/checkout")
      .set(buyer.auth)
      .set("idempotency-key", `suspension-${randomUUID()}`)
      .send({ productKey: PREMIUM, currency: "USD" })
      .expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(
      await db.select().from(orders).where(eq(orders.userId, buyer.userId)),
    ).toEqual([]);
  });

  it("cannot change its subscription", async () => {
    const buyer = await newCustomer();
    const { subscription } = await buyPremium(buyer);
    const cancelCalls = h.lava.cancelCalls.length;
    await suspend(buyer);
    const [stopped] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id));
    const res = await h
      .http()
      .post(`/v1/me/subscriptions/${subscription.id}/cancel`)
      .set(buyer.auth)
      .expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    // The suspension itself stopped the renewal; the buyer's request changes
    // nothing on top of it and calls nobody.
    const [after] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id));
    expect(after).toEqual(stopped);
    expect(after).toMatchObject({
      state: "cancel_requested",
      paidUntil: subscription.paidUntil,
    });
    expect(h.lava.cancelCalls).toHaveLength(cancelCalls);
  });

  it("cannot grant, refund or cancel as an operator", async () => {
    const owner = await newCustomer(["owner"]);
    const buyer = await newCustomer();
    const { subscription, payment } = await buyPremium(buyer);
    const cancelCalls = h.lava.cancelCalls.length;
    await suspend(owner);
    const reason = { reason: "from a suspended account" };
    const commands: [string, object][] = [
      [
        "/v1/admin/grants",
        {
          userId: buyer.userId,
          service: "battleship",
          feature: "premium",
          reason: "free premium",
        },
      ],
      [`/v1/admin/payments/${payment.id}/refund-request`, reason],
      [`/v1/admin/subscriptions/${subscription.id}/cancel`, reason],
    ];
    for (const [path, body] of commands) {
      const res = await h.http().post(path).set(owner.auth).send(body);
      expect(res.status, path).toBe(403);
    }

    // No grant, refund, cancellation or audit entry came out of it.
    const granted = await db
      .select({ sourceType: grants.sourceType })
      .from(grants)
      .where(eq(grants.userId, buyer.userId));
    expect(granted).toEqual([{ sourceType: "subscription" }]);
    expect(
      await db.select().from(refunds).where(eq(refunds.paymentId, payment.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.actorId, owner.userId)),
    ).toEqual([]);
    const [after] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id));
    expect(after).toEqual(subscription);
    expect(h.lava.cancelCalls).toHaveLength(cancelCalls);
  });
});

describe("an account Identity suspends or deletes stops its renewals", () => {
  const DAY_MS = 86_400_000;
  const subscriptionsOf = (userId: string) =>
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(asc(subscriptions.createdAt));
  const systemAudit = (ids: string[]) =>
    db
      .select()
      .from(auditLog)
      .where(and(isNull(auditLog.actorId), inArray(auditLog.targetId, ids)));
  const callsFor = (contractId: string) =>
    h.lava.cancelCalls.filter((call) => call.parentContractId === contractId);
  const reconcile = () => h.app.get(ReconciliationWorker).tick();

  it("suspension stops every renewal Lava can still charge, once, and keeps paid time", async () => {
    const buyer = await newCustomer();
    // Cancelled by the buyer: renewal is already off.
    const { subscription: cancelled } = await buyPremium(buyer);
    await h
      .http()
      .post(`/v1/me/subscriptions/${cancelled.id}/cancel`)
      .set(buyer.auth)
      .expect(200);
    h.clock.advance(60_000);
    // Lapsed without a cancel: Lava may still charge it.
    const { subscription: lapsed } = await buyPremium(buyer);
    h.clock.set(new Date(lapsed.paidUntil.getTime() + 3 * DAY_MS));
    await h.app.get(ExpiryWorker).tick();
    // The current one.
    const { subscription: current } = await buyPremium(buyer);
    const before = await subscriptionsOf(buyer.userId);
    expect(before.map((s) => [s.state, s.autoRenew])).toEqual([
      ["expired", false],
      ["expired", true],
      ["active", true],
    ]);
    const calls = h.lava.cancelCalls.length;

    const suspended = statusEvent(buyer, "suspended", 1);
    await customers.apply(suspended);
    const now = h.clock.now();
    const [untouched, stoppedLapsed, stoppedCurrent] = await subscriptionsOf(
      buyer.userId,
    );
    expect(untouched).toEqual(before[0]);
    expect(stoppedLapsed).toMatchObject({
      state: "expired",
      cancelRequestedAt: now,
      nextCancelAttemptAt: now,
    });
    expect(stoppedCurrent).toMatchObject({
      state: "cancel_requested",
      autoRenew: true,
      paidUntil: current.paidUntil,
      cancelRequestedAt: now,
      nextCancelAttemptAt: now,
    });
    expect(
      (await systemAudit([cancelled.id, lapsed.id, current.id]))
        .map((row) => ({
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          reason: row.reason,
        }))
        .sort((a, b) => a.targetId.localeCompare(b.targetId)),
    ).toEqual(
      [lapsed.id, current.id].sort().map((targetId) => ({
        action: "subscription.cancel",
        targetType: "subscription",
        targetId,
        reason: "account suspended",
      })),
    );
    // Nothing is called inside the event's transaction; the worker calls.
    expect(h.lava.cancelCalls).toHaveLength(calls);
    await reconcile();
    expect(callsFor(lapsed.providerParentContractId)).toHaveLength(1);
    expect(callsFor(current.providerParentContractId)).toHaveLength(1);
    expect(callsFor(cancelled.providerParentContractId)).toHaveLength(1);
    expect(
      (await subscriptionsOf(buyer.userId)).map((s) => s.autoRenew),
    ).toEqual([false, false, false]);
    // Paid time and access stay: no refund, no grant change.
    const [kept] = (await subscriptionsOf(buyer.userId)).slice(-1);
    expect(kept?.paidUntil).toEqual(current.paidUntil);
    expect(
      await db
        .select({ state: grants.state })
        .from(grants)
        .where(eq(grants.sourceId, current.id)),
    ).toEqual([{ state: "active" }]);

    // The same event again, a later suspension, and a reactivation change
    // nothing: renewal stays off, and nobody is called again.
    const settled = await subscriptionsOf(buyer.userId);
    await customers.apply(suspended);
    await customers.apply(statusEvent(buyer, "suspended", 2));
    await customers.apply(statusEvent(buyer, "active", 3));
    h.clock.advance(10 * 60_000);
    await reconcile();
    expect(await subscriptionsOf(buyer.userId)).toEqual(settled);
    expect(await systemAudit([lapsed.id, current.id])).toHaveLength(2);
    for (const subscription of [cancelled, lapsed, current])
      expect(callsFor(subscription.providerParentContractId)).toHaveLength(1);
  });

  it("deletion stops the renewal the same way", async () => {
    const buyer = await newCustomer();
    const { subscription } = await buyPremium(buyer);
    await customers.apply(statusEvent(buyer, "deleted", 1));
    const [stopped] = await subscriptionsOf(buyer.userId);
    expect(stopped).toMatchObject({ state: "cancel_requested" });
    expect(await systemAudit([subscription.id])).toEqual([
      expect.objectContaining({
        action: "subscription.cancel",
        reason: "account deleted",
      }),
    ]);
    await reconcile();
    expect(callsFor(subscription.providerParentContractId)).toHaveLength(1);
    expect((await subscriptionsOf(buyer.userId))[0]).toMatchObject({
      state: "cancelling",
      autoRenew: false,
    });
  });

  it("a status event older than an access change already applied stops nothing", async () => {
    const buyer = await newCustomer();
    const { subscription } = await buyPremium(buyer);
    await customers.apply(statusEvent(buyer, "active", 5));
    await customers.apply(statusEvent(buyer, "suspended", 3));
    expect((await subscriptionsOf(buyer.userId))[0]).toEqual(subscription);
    expect(await systemAudit([subscription.id])).toEqual([]);
  });

  it("a suspension stops renewals even when a later role change arrived first", async () => {
    const buyer = await newCustomer();
    const { subscription } = await buyPremium(buyer);
    // Identity suspended the account (1), then changed a role (2). The role
    // change says nothing about the status, so the suspension is current.
    await customers.apply(roleChanged(buyer, 2));
    await customers.apply(statusEvent(buyer, "suspended", 1));
    expect((await subscriptionsOf(buyer.userId))[0]).toMatchObject({
      state: "cancel_requested",
      paidUntil: subscription.paidUntil,
    });
    expect(await systemAudit([subscription.id])).toEqual([
      expect.objectContaining({ reason: "account suspended" }),
    ]);
  });

  it("a suspension delivered twice, or again after a reactivation, stops renewals once", async () => {
    const buyer = await newCustomer();
    const { subscription } = await buyPremium(buyer);
    const suspended = statusEvent(buyer, "suspended", 1);
    await customers.apply(suspended);
    await customers.apply(suspended);
    await customers.apply(statusEvent(buyer, "active", 2));
    await customers.apply({ ...suspended, eventId: randomUUID() });
    expect(await systemAudit([subscription.id])).toHaveLength(1);
    expect((await subscriptionsOf(buyer.userId))[0]).toMatchObject({
      state: "cancel_requested",
    });
  });

  it("a cancel Lava does not answer for a closed account is reported at once and retried", async () => {
    const buyer = await newCustomer();
    const { subscription } = await buyPremium(buyer);
    h.lava.cancelMode = "timeout";
    await customers.apply(statusEvent(buyer, "suspended", 1));
    await reconcile();
    const issue = async () =>
      (
        await db
          .select()
          .from(reconciliationIssues)
          .where(
            eq(reconciliationIssues.subjectKey, `cancel:${subscription.id}`),
          )
      )[0];
    expect(await issue()).toMatchObject({
      kind: "renewal_cancel_failed",
      severity: "high",
      status: "open",
    });
    h.lava.cancelMode = "ok";
    h.clock.advance(61_000);
    await reconcile();
    expect(callsFor(subscription.providerParentContractId)).toHaveLength(2);
    expect((await subscriptionsOf(buyer.userId))[0]).toMatchObject({
      state: "cancelling",
      autoRenew: false,
    });
    expect(await issue()).toMatchObject({ status: "resolved" });
  });
});

/**
 * Identity events may arrive out of order (a retry, a redelivery): the
 * status with the higher accessVersion wins, whatever came last.
 */
describe("account statuses from Identity apply in version order", () => {
  const stored = async (userId: string) =>
    (
      await db
        .select({
          status: customerTable.status,
          accessVersion: customerTable.accessVersion,
        })
        .from(customerTable)
        .where(eq(customerTable.userId, userId))
    )[0];
  const checkout = (user: Customer) =>
    h
      .http()
      .post("/v1/checkout")
      .set(user.auth)
      .set("idempotency-key", `order-${randomUUID()}`)
      .send({ productKey: PREMIUM, currency: "USD" });

  it("a status older than the stored one changes nothing, either way", async () => {
    // Suspended (1), reactivated (2); the suspension is delivered last.
    const back = await newCustomer();
    await customers.apply(statusEvent(back, "active", 2));
    await customers.apply(statusEvent(back, "suspended", 1));
    expect(await stored(back.userId)).toEqual({
      status: "active",
      accessVersion: 2,
    });
    await checkout(back).expect(200);

    // Reactivated (3), suspended (4); the reactivation is delivered last.
    const closed = await newCustomer();
    await customers.apply(statusEvent(closed, "suspended", 4));
    await customers.apply(statusEvent(closed, "active", 3));
    expect(await stored(closed.userId)).toEqual({
      status: "suspended",
      accessVersion: 4,
    });
    const refused = await checkout(closed).expect(403);
    expect(refused.body.error.code).toBe("FORBIDDEN");
  });

  it("a status delivered again, even under a new event id, never undoes a newer one", async () => {
    const buyer = await newCustomer();
    const suspended = statusEvent(buyer, "suspended", 1);
    await customers.apply(suspended);
    await customers.apply(suspended);
    expect((await stored(buyer.userId))?.status).toBe("suspended");
    await customers.apply(statusEvent(buyer, "active", 2));
    await customers.apply(suspended);
    await customers.apply({ ...suspended, eventId: randomUUID() });
    expect((await stored(buyer.userId))?.status).toBe("active");
    await checkout(buyer).expect(200);
  });

  it("the account's creation delivered late does not reopen a suspended account", async () => {
    const userId = randomUUID();
    const late = customerEvents(userId, `late.${userId.slice(0, 8)}@x.test`);
    await customers.apply(statusEvent({ userId }, "suspended", 1));
    for (const event of late.reverse()) await customers.apply(event);
    expect((await stored(userId))?.status).toBe("suspended");
  });

  it("role changes move the access version but never decide the status", async () => {
    const buyer = await newCustomer();
    // Identity: suspended (3), reactivated (4), a role granted (5); the role
    // change overtakes the reactivation.
    await customers.apply(statusEvent(buyer, "suspended", 3));
    await customers.apply(roleChanged(buyer, 5));
    await customers.apply(statusEvent(buyer, "active", 4));
    expect(await stored(buyer.userId)).toEqual({
      status: "active",
      accessVersion: 5,
    });
  });
});
