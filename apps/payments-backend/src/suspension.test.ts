import { randomUUID } from "node:crypto";
import { createEvent, identityUserStatusChanged } from "@outegro/contracts";
import { DATABASE } from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PaymentsDatabase } from "./common/database.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  auditLog,
  grants,
  orders,
  payments,
  refunds,
  subscriptions,
} from "./db/schema.js";
import { customerEvents, type Harness, startHarness } from "./test/harness.js";
import { lavaPayloads } from "./test/lava-payloads.js";

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
    const res = await h
      .http()
      .post(`/v1/me/subscriptions/${subscription.id}/cancel`)
      .set(buyer.auth)
      .expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    const [after] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id));
    expect(after).toEqual(subscription);
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
