import { randomUUID } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CatalogService } from "./catalog/catalog.service.js";
import type { PaymentsDatabase } from "./common/database.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  financialEntries,
  grants,
  orders,
  outbox,
  payments,
} from "./db/schema.js";
import { catalog } from "./domain/catalog.js";
import { type PackConfig, packProducts } from "./domain/packs.js";
import type { FakeInvoice } from "./test/fake-lava.js";
import { customerEvents, type Harness, startHarness } from "./test/harness.js";
import { lavaPayloads } from "./test/lava-payloads.js";

/**
 * Phase 2 (W-04) in payments: a pack of grumbles is a one-time product
 * that opens no access. Its payment goes to the money journal as any
 * other and asks the wallet to credit the grumbles; a refund, whole or in
 * part, and a chargeback ask the wallet to take them back. Grumbles never
 * reach the provider or the money journal.
 */

const PACK: PackConfig = {
  key: "grumbles-1000",
  grumbles: 1000,
  offerId: randomUUID(),
  prices: { RUB: "99", USD: "1.10" },
};

let h: Harness;
let db: PaymentsDatabase["db"];

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<PaymentsDatabase>(DATABASE).db;
  // The harness keeps packs disabled; this file sells one.
  h.lava.extraProducts = packProducts([PACK]);
  await h.app.get(CatalogService).sync([...catalog, ...packProducts([PACK])]);
});
afterAll(() => h?.close());
beforeEach(() => {
  h.clock.set(new Date());
  h.lava.reset();
});

type Customer = Awaited<ReturnType<typeof newCustomer>>;

async function newCustomer(roles: string[] = []) {
  const userId = randomUUID();
  const email = `buyer.${userId.slice(0, 8)}@example.test`;
  const customers = h.app.get(CustomersService);
  for (const event of customerEvents(userId, email))
    await customers.apply(event);
  const token = await h.tokenFor(userId, roles);
  return { userId, email, auth: { authorization: `Bearer ${token}` } };
}

const webhook = (payload: unknown) =>
  h
    .http()
    .post("/webhooks/lava")
    .set("x-api-key", h.webhookSecret)
    .send(payload as object);

async function startPack(user: Customer, currency: "RUB" | "USD" = "RUB") {
  const res = await h
    .http()
    .post("/v1/checkout")
    .set(user.auth)
    .set("idempotency-key", `test-${randomUUID()}`)
    .send({ productKey: PACK.key, currency })
    .expect(200);
  const invoice = h.lava.find(
    res.body.paymentUrl.split("/").at(-1) as string,
  ) as FakeInvoice;
  return { orderId: res.body.orderId as string, invoice };
}

function paid(user: Customer, invoice: FakeInvoice) {
  return lavaPayloads.paymentSuccess({
    contractId: invoice.id,
    email: user.email,
    amount: Number(invoice.amount),
    currency: invoice.currency ?? "RUB",
    at: h.clock.now(),
  });
}

async function buyPack(user: Customer) {
  const started = await startPack(user);
  await webhook(paid(user, started.invoice)).expect(200);
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, started.orderId));
  if (!payment) throw new Error("no payment");
  return { ...started, payment };
}

/** An operator's refund in the Lava cabinet, then Lava's webhook for it. */
async function refund(user: Customer, paymentId: string, amount: number) {
  const owner = await newCustomer(["owner"]);
  await h
    .http()
    .post(`/v1/admin/payments/${paymentId}/refund-request`)
    .set(owner.auth)
    .send({ reason: "unspent grumbles returned on request" })
    .expect(201);
  const res = await webhook(
    lavaPayloads.refund({
      tierId: PACK.offerId,
      email: user.email,
      amount,
      currency: "RUB",
      at: h.clock.now(),
      refundType: amount < 99 ? "partial" : "full",
    }),
  ).expect(200);
  expect(res.body.status).toBe("processed");
}

const events = (type: string, userId: string) =>
  db
    .select({ envelope: outbox.envelope })
    .from(outbox)
    .where(
      and(
        eq(outbox.type, type),
        sql`${outbox.envelope}->'payload'->>'userId' = ${userId}`,
      ),
    )
    .orderBy(outbox.createdAt)
    .then((rows) =>
      rows.map(
        (row) => (row.envelope as { payload: Record<string, unknown> }).payload,
      ),
    );

describe("the catalog", () => {
  it("keeps packs out until the owner enables them", () => {
    // The harness leaves GRUMBLE_PACKS_ENABLED at its default.
    expect(
      h.app
        .get(CatalogService)
        .definition()
        .some((product) => product.kind === "grumble_pack"),
    ).toBe(false);
  });

  it("lists an enabled pack with its grumbles and both titles", async () => {
    const res = await h.http().get("/v1/catalog").expect(200);
    const pack = res.body.products.find(
      (p: { key: string }) => p.key === PACK.key,
    );
    expect(pack).toMatchObject({
      service: "wallet",
      kind: "grumble_pack",
      periodicity: "ONE_TIME",
      grumbles: "1000",
      title: { en: "1,000 grumbles", ru: "1 000 грамблсов" },
    });
    const other = res.body.products.find(
      (p: { key: string }) => p.key !== PACK.key,
    );
    expect(other.grumbles).toBeNull();
  });
});

describe("a paid pack (TC-W-04-01, TC-W-04-02, TC-W-04-05)", () => {
  it("opens no access and asks the wallet to credit it once", async () => {
    const user = await newCustomer();
    const { orderId, invoice, payment } = await buyPack(user);
    // Lava delivers it again: nothing new.
    await webhook(paid(user, invoice)).expect(200);

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order).toMatchObject({
      status: "paid",
      kind: "grumble_pack",
      grumbles: 1000n,
    });
    expect(
      await db.select().from(grants).where(eq(grants.userId, user.userId)),
    ).toEqual([]);
    expect(await events("billing.grumbles-purchased.v1", user.userId)).toEqual([
      {
        paymentId: payment.id,
        orderId,
        userId: user.userId,
        productKey: PACK.key,
        grumbles: "1000",
        money: { minor: "9900", currency: "RUB", scale: 2 },
        paidAt: payment.confirmedAt.toISOString(),
      },
    ]);
    expect(
      await events("billing.payment.confirmed.v1", user.userId),
    ).toHaveLength(1);
    // Money in the journal, in the currency paid; never grumbles.
    const entries = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.paymentId, payment.id));
    expect(entries.map((e) => [e.type, e.currency, e.amountMinor])).toEqual([
      ["payment", "RUB", 9900n],
    ]);
  });

  it("is never a credit before the provider confirms it (return URL)", async () => {
    const user = await newCustomer();
    const { orderId } = await startPack(user);
    const res = await h
      .http()
      .get(`/v1/me/orders/${orderId}`)
      .set(user.auth)
      .expect(200);
    expect(res.body.status).toBe("pending");
    expect(await events("billing.grumbles-purchased.v1", user.userId)).toEqual(
      [],
    );
  });

  it("can be bought again and again", async () => {
    const user = await newCustomer();
    await buyPack(user);
    await buyPack(user);
    expect(
      await events("billing.grumbles-purchased.v1", user.userId),
    ).toHaveLength(2);
  });

  it("is sold in money only: GRM never reaches the provider", async () => {
    const user = await newCustomer();
    await h
      .http()
      .post("/v1/checkout")
      .set(user.auth)
      .set("idempotency-key", `test-${randomUUID()}`)
      .send({ productKey: PACK.key, currency: "GRM" })
      .expect(400);
    const { invoice } = await startPack(user, "USD");
    expect(invoice.input.currency).toBe("USD");
    expect(invoice.amount).toBe("1.10");
  });
});

describe("a refunded or charged-back pack (TC-W-04-03)", () => {
  it("asks back the share of each partial refund, rounded for the buyer, and the rest with the last", async () => {
    const user = await newCustomer();
    const { orderId, payment } = await buyPack(user);
    await refund(user, payment.id, 33);
    let [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, payment.id));
    expect(row?.state).toBe("confirmed");
    await refund(user, payment.id, 66);
    [row] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row?.state).toBe("refunded");
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order?.status).toBe("refunded");

    const reversed = await events("billing.grumbles-reversed.v1", user.userId);
    // 33 of 99 roubles buy 333.3 grumbles: 333 come back, the rest later.
    expect(reversed.map((e) => [e.kind, e.grumbles, e.money])).toEqual([
      ["refund", "333", { minor: "3300", currency: "RUB", scale: 2 }],
      ["refund", "667", { minor: "6600", currency: "RUB", scale: 2 }],
    ]);
    expect(
      await db
        .select({ amount: financialEntries.amountMinor })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.paymentId, payment.id),
            eq(financialEntries.type, "refund"),
          ),
        ),
    ).toHaveLength(2);
  });

  it("asks back on a chargeback what no refund took yet", async () => {
    const user = await newCustomer();
    const { payment, invoice } = await buyPack(user);
    await refund(user, payment.id, 33);
    await webhook(
      lavaPayloads.chargeback({
        tierId: PACK.offerId,
        email: user.email,
        amount: 99,
        currency: "RUB",
        at: h.clock.now(),
        contractId: invoice.id,
      }),
    ).expect(200);
    const reversed = await events("billing.grumbles-reversed.v1", user.userId);
    expect(reversed.map((e) => [e.kind, e.grumbles])).toEqual([
      ["refund", "333"],
      ["chargeback", "667"],
    ]);
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, payment.id));
    expect(row?.state).toBe("disputed");
  });
});

describe("titles", () => {
  it("name a pack in both languages with the right Russian form", async () => {
    const { packTitle } = await import("./domain/packs.js");
    expect(packTitle(1)).toEqual({ en: "1 grumble", ru: "1 грамблс" });
    expect(packTitle(2)).toEqual({ en: "2 grumbles", ru: "2 грамблса" });
    expect(packTitle(21)).toEqual({ en: "21 grumbles", ru: "21 грамблс" });
    expect(packTitle(10_000)).toEqual({
      en: "10,000 grumbles",
      ru: "10 000 грамблсов",
    });
  });
});
