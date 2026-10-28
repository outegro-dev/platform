import { randomUUID } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GrantLedger } from "./billing/grants.js";
import type { PaymentsDatabase } from "./common/database.js";
import { CustomersService } from "./customers/customers.service.js";
import {
  financialEntries,
  grants,
  orders,
  outbox,
  walletOrders,
} from "./db/schema.js";
import { FakeWallet } from "./test/fake-wallet.js";
import { customerEvents, type Harness, startHarness } from "./test/harness.js";

/**
 * Phase 3 (W-05): a one-time product bought with grumbles. Payments leads
 * it: an order, a debit in the wallet by `order:{id}`, the grant. Not
 * enough grumbles is an answer with the shortfall and a pack; a grant that
 * fails gives the grumbles back by the same ref; nothing is taken twice.
 */

const SILVER = "battleship-silver-fleet";
const PRICE = 500n;

let h: Harness;
let db: PaymentsDatabase["db"];
const wallet = new FakeWallet();

beforeAll(async () => {
  await wallet.start();
  // Set before the harness reads the environment: prices and packs on.
  Object.assign(process.env, {
    GRUMBLE_PRICES_ENABLED: "true",
    GRUMBLE_PRICES: JSON.stringify({ [SILVER]: Number(PRICE) }),
    WALLET_API_URL: wallet.url,
    GRUMBLE_PACKS_ENABLED: "true",
    GRUMBLE_PACKS: JSON.stringify([
      {
        key: "grumbles-300",
        grumbles: 300,
        offerId: randomUUID(),
        prices: { RUB: "30" },
      },
      {
        key: "grumbles-1000",
        grumbles: 1000,
        offerId: randomUUID(),
        prices: { RUB: "99" },
      },
    ]),
  });
  h = await startHarness();
  db = h.app.get<PaymentsDatabase>(DATABASE).db;
});
afterAll(async () => {
  await h?.close();
  wallet.stop();
});
beforeEach(() => {
  wallet.mode = "ok";
  vi.restoreAllMocks();
});

async function buyer(grumbles: bigint) {
  const userId = randomUUID();
  const email = `buyer.${userId.slice(0, 8)}@example.test`;
  const customers = h.app.get(CustomersService);
  for (const event of customerEvents(userId, email))
    await customers.apply(event);
  wallet.balances.set(userId, grumbles);
  const token = await h.tokenFor(userId);
  return { userId, auth: { authorization: `Bearer ${token}` } };
}

function buy(
  user: { auth: Record<string, string> },
  productKey = SILVER,
  key = `test-${randomUUID()}`,
) {
  return h
    .http()
    .post("/v1/checkout/grumbles")
    .set(user.auth)
    .set("idempotency-key", key)
    .send({ productKey });
}

const grantsOf = (userId: string) =>
  db.select().from(grants).where(eq(grants.userId, userId));
const ordersOf = (userId: string) =>
  db.select().from(walletOrders).where(eq(walletOrders.userId, userId));

describe("buying with grumbles (TC-W-05-01)", () => {
  it("debits once by the order's ref, grants, and moves no money", async () => {
    const user = await buyer(1000n);
    const res = await buy(user).expect(200);
    expect(res.body).toMatchObject({
      status: "paid",
      productKey: SILVER,
      grumbles: "500",
      balanceAfter: "500",
    });
    const ref = `order:${res.body.orderId}`;
    expect(wallet.debits(ref)).toHaveLength(1);
    expect(wallet.debits(ref)[0]?.body).toMatchObject({
      userId: user.userId,
      unit: "GRM",
      amount: "500",
      source: "battleship-shop",
      objectRef: ref,
    });
    expect(await grantsOf(user.userId)).toEqual([
      expect.objectContaining({
        service: "battleship",
        feature: "cosmetics.silver-fleet",
        sourceType: "purchase",
        sourceId: res.body.orderId,
        state: "active",
        validUntil: null,
      }),
    ]);
    const changed = await db
      .select({ id: outbox.eventId })
      .from(outbox)
      .where(
        and(
          eq(outbox.type, "billing.grant.changed.v1"),
          sql`${outbox.envelope}->'payload'->>'userId' = ${user.userId}`,
        ),
      );
    expect(changed).toHaveLength(1);
    // No money order, no money journal: grumbles never meet the provider.
    expect(
      await db.select().from(orders).where(eq(orders.userId, user.userId)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(financialEntries)
        .where(eq(financialEntries.userId, user.userId)),
    ).toEqual([]);
  });

  it("answers the same key with the same order and debits nothing more", async () => {
    const user = await buyer(1000n);
    const key = `test-${randomUUID()}`;
    const first = await buy(user, SILVER, key).expect(200);
    const again = await buy(user, SILVER, key).expect(200);
    expect(again.body).toEqual(first.body);
    expect(wallet.debits(`order:${first.body.orderId}`)).toHaveLength(1);
    await buy(user, "battleship-premium", key).expect(409);
  });

  it("shows the price in grumbles only for what is sold for them", async () => {
    const res = await h.http().get("/v1/catalog").expect(200);
    const price = (key: string) =>
      res.body.products.find((p: { key: string }) => p.key === key)
        ?.priceGrumbles;
    expect(price(SILVER)).toBe("500");
    expect(price("battleship-premium")).toBeNull();
    const user = await buyer(10_000n);
    await buy(user, "battleship-premium").expect(422);
  });
});

describe("not enough grumbles (TC-W-05-02)", () => {
  it("says how many are missing and which pack covers them, then the same purchase goes through", async () => {
    const user = await buyer(100n);
    const short = await buy(user).expect(200);
    expect(short.body).toEqual({
      status: "short",
      productKey: SILVER,
      grumbles: "500",
      balance: "100",
      shortfall: "400",
      pack: { key: "grumbles-1000", grumbles: "1000" },
    });
    // Nothing was ordered or taken.
    expect(await ordersOf(user.userId)).toEqual([]);
    // The pack arrives; back to the same purchase.
    wallet.balances.set(user.userId, 1100n);
    const paid = await buy(user).expect(200);
    expect(paid.body).toMatchObject({ status: "paid", balanceAfter: "600" });
  });

  it("turns a debit refused in a race into the same answer", async () => {
    const user = await buyer(600n);
    const spy = vi
      .spyOn(wallet.balances, "get")
      // The first look says enough; then someone spends it.
      .mockImplementationOnce(() => 600n);
    wallet.balances.set(user.userId, 50n);
    const res = await buy(user).expect(200);
    spy.mockRestore();
    expect(res.body).toMatchObject({ status: "short", shortfall: "450" });
    const [order] = await ordersOf(user.userId);
    expect(order).toMatchObject({
      status: "failed",
      failure: "insufficient_funds",
    });
    expect(await grantsOf(user.userId)).toEqual([]);
  });
});

describe("when something fails (TC-W-05-03)", () => {
  it("gives the grumbles back by the same ref when the grant fails", async () => {
    const user = await buyer(1000n);
    vi.spyOn(h.app.get(GrantLedger), "activate").mockRejectedValueOnce(
      new Error("database went away"),
    );
    await buy(user).expect(500);
    const [order] = await ordersOf(user.userId);
    expect(order).toMatchObject({ status: "failed", failure: "grant_failed" });
    const ref = `order:${order?.id}`;
    expect(wallet.refs.get(ref)?.state).toBe("reversed");
    expect(wallet.balances.get(user.userId)).toBe(1000n);
    expect(await grantsOf(user.userId)).toEqual([]);
  });

  it("rolls back a debit whose answer was lost, by the same ref", async () => {
    const user = await buyer(1000n);
    wallet.mode = "lose-answer";
    await buy(user).expect(503);
    const [order] = await ordersOf(user.userId);
    expect(order).toMatchObject({
      status: "failed",
      failure: "wallet_unavailable",
    });
    expect(wallet.balances.get(user.userId)).toBe(1000n);
    expect(await grantsOf(user.userId)).toEqual([]);
  });

  it("says the wallet is unavailable and takes nothing when it is down", async () => {
    const user = await buyer(1000n);
    wallet.mode = "down";
    await buy(user).expect(503);
    expect(await ordersOf(user.userId)).toEqual([]);
  });
});

describe("owned already and double clicks (TC-W-05-04)", () => {
  it("refuses what the buyer owns with ALREADY_OWNED and debits nothing", async () => {
    const user = await buyer(2000n);
    await buy(user).expect(200);
    const calls = wallet.calls.length;
    const again = await buy(user).expect(422);
    expect(again.body.error.code).toBe("ALREADY_OWNED");
    expect(
      wallet.calls.slice(calls).filter((c) => c.path.endsWith("/debit")),
    ).toEqual([]);
    expect(wallet.balances.get(user.userId)).toBe(1500n);
  });

  it("makes one order and one debit of two clicks at once", async () => {
    const user = await buyer(2000n);
    const results = await Promise.all([buy(user), buy(user)]);
    // The second click either joins the first order or finds it owned.
    for (const res of results)
      expect(
        res.status === 200 ? res.body.status : (res.body.error.code as string),
      ).toMatch(/^(paid|ALREADY_OWNED)$/);
    expect(results.some((r) => r.body.status === "paid")).toBe(true);
    const placed = await ordersOf(user.userId);
    expect(placed).toHaveLength(1);
    expect(wallet.balances.get(user.userId)).toBe(1500n);
    expect(await grantsOf(user.userId)).toHaveLength(1);
  });
});
