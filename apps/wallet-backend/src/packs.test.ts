import { randomUUID } from "node:crypto";
import { adminWalletCardSchema } from "@outegro/contracts/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, invariants, startHarness } from "./test/harness.js";

/**
 * Phase 2 (W-04) on real PostgreSQL: packs bought with money arrive from
 * Payments' events. A pack is credited once however often and in whatever
 * order it comes; a refund or a chargeback takes back what the wallet
 * holds, never more than the pack brought, and leaves the rest as a debt
 * that restricts the wallet until the next pack pays it off.
 */

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

const owner = async () => h.auth(randomUUID(), ["owner"]);

function debit(userId: string, amount: number, ref = `order:${randomUUID()}`) {
  return h
    .http()
    .post("/v1/internal/debit")
    .set(h.service)
    .send({
      unit: "GRM",
      source: "roulette",
      ref,
      userId,
      amount: `${amount}`,
    });
}

async function card(userId: string) {
  const res = await h
    .http()
    .get(`/v1/admin/wallets/${userId}`)
    .set(await owner())
    .expect(200);
  expect(adminWalletCardSchema.safeParse(res.body).success).toBe(true);
  return res.body;
}

async function rows(sql: string, params: unknown[]) {
  return (await h.root.query(sql, params)).rows;
}

async function expectInvariants() {
  expect(await invariants(h)).toEqual({
    drift: 0,
    chain: 0,
    system: 0,
    total: 0n,
    negative: 0,
  });
}

/** A player who bought a pack of `grumbles`; returns the pack's payment. */
async function bought(userId: string, grumbles: number) {
  const event = h.packEvent(userId, grumbles);
  expect(await h.billing().apply(event)).toBe(true);
  return event.payload.paymentId;
}

describe("a pack bought with money (TC-W-04-01)", () => {
  it("is credited once, against issued_purchase, with its lot", async () => {
    const userId = randomUUID();
    const event = h.packEvent(userId, 1000);
    expect(await h.billing().apply(event)).toBe(true);
    // The same event again, and the same payment under another event id.
    expect(await h.billing().apply(event)).toBe(false);
    const again = h.packEvent(userId, 1000, event.payload.paymentId);
    expect(await h.billing().apply(again)).toBe(false);

    const { wallet, history } = await card(userId);
    expect(wallet).toMatchObject({
      balance: "1000",
      state: "active",
      debt: "0",
    });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      kind: "purchase",
      source: "pay",
      amount: "1000",
      ref: `pack:payment:${event.payload.paymentId}`,
      objectRef: `order:${event.payload.orderId}`,
      counterAccount: "issued_purchase",
      meta: {
        productKey: "grumbles-1000",
        money: { minor: "9900", currency: "RUB", scale: 2 },
      },
    });
    expect(
      await rows(
        "select grumbles::text, money_minor::text, currency from wallet_lots where payment_id = $1",
        [event.payload.paymentId],
      ),
    ).toEqual([{ grumbles: "1000", money_minor: "9900", currency: "RUB" }]);
    await expectInvariants();
  });

  it("is credited once when two deliveries race", async () => {
    const userId = randomUUID();
    const paymentId = randomUUID();
    const deliveries = Array.from({ length: 6 }, () =>
      h.packEvent(userId, 500, paymentId),
    );
    const results = await Promise.allSettled(
      deliveries.map((event) => h.billing().apply(event)),
    );
    // A loser either saw the pack or hit its unique key and is retried.
    const applied = results.filter(
      (r) => r.status === "fulfilled" && r.value,
    ).length;
    expect(applied).toBe(1);
    for (const [i, result] of results.entries())
      if (result.status === "rejected") {
        const retry = deliveries[i];
        if (retry) expect(await h.billing().apply(retry)).toBe(false);
      }
    expect((await card(userId)).wallet.balance).toBe("500");
    expect(
      await rows(
        "select count(*)::int as n from wallet_lots where user_id = $1",
        [userId],
      ),
    ).toEqual([{ n: 1 }]);
    await expectInvariants();
  });

  it("is refused through the internal API: pack refs are the wallet's own", async () => {
    const userId = randomUUID();
    await bought(userId, 10);
    const refused = await debit(userId, 1, `pack:payment:${randomUUID()}`);
    expect(refused.status).toBe(400);
    expect((await card(userId)).wallet.balance).toBe("10");
  });
});

describe("a refunded or charged-back pack (TC-W-04-03)", () => {
  it("waits for its purchase when it comes first", async () => {
    const userId = randomUUID();
    const pack = h.packEvent(userId, 100);
    const early = h.reversalEvent(userId, pack.payload.paymentId, 100);
    await expect(h.billing().apply(early)).rejects.toThrow(/no pack/);
    expect(await h.billing().apply(pack)).toBe(true);
    // The retry of the reversal now finds its pack.
    expect(await h.billing().apply(early)).toBe(true);
    expect((await card(userId)).wallet).toMatchObject({
      balance: "0",
      debt: "0",
      state: "active",
    });
    await expectInvariants();
  });

  it("takes back a partial refund, and never more than the pack over all cases", async () => {
    const userId = randomUUID();
    const paymentId = await bought(userId, 1000);
    expect(
      await h.billing().apply(h.reversalEvent(userId, paymentId, 400)),
    ).toBe(true);
    // Asks for 800 more: only 600 were left of the pack.
    expect(
      await h.billing().apply(h.reversalEvent(userId, paymentId, 800)),
    ).toBe(true);
    // Nothing is left to ask for.
    expect(
      await h
        .billing()
        .apply(h.reversalEvent(userId, paymentId, 1, "chargeback")),
    ).toBe(false);
    const { wallet, history } = await card(userId);
    expect(wallet).toMatchObject({ balance: "0", debt: "0", state: "active" });
    expect(
      history.items.map((i: { kind: string; amount: string }) => [
        i.kind,
        i.amount,
      ]),
    ).toEqual([
      ["clawback", "-600"],
      ["clawback", "-400"],
      ["purchase", "1000"],
    ]);
    expect(
      await rows(
        "select grumbles::text, taken::text, debt::text from wallet_lot_reversals where payment_id = $1 order by created_at, grumbles",
        [paymentId],
      ),
    ).toHaveLength(2);
    await expectInvariants();
  });

  it("leaves what was spent as a debt that restricts the wallet until a pack pays it", async () => {
    const userId = randomUUID();
    const paymentId = await bought(userId, 1000);
    await debit(userId, 700).expect(200);
    const chargeback = h.reversalEvent(userId, paymentId, 1000, "chargeback");
    expect(await h.billing().apply(chargeback)).toBe(true);
    expect(await h.billing().apply(chargeback)).toBe(false);

    let view = await card(userId);
    expect(view.wallet).toMatchObject({
      balance: "0",
      debt: "700",
      state: "restricted",
      restrictedReason: "debt",
    });
    expect(view.history.items[0]).toMatchObject({
      kind: "clawback",
      amount: "-300",
      ref: `pack:case:${chargeback.payload.caseId}`,
      reason: "pack charged back",
      meta: { kind: "chargeback", debt: "700" },
    });
    expect(
      await rows(
        "select grumbles::text, taken::text, debt::text from wallet_lot_reversals where case_id = $1",
        [chargeback.payload.caseId],
      ),
    ).toEqual([{ grumbles: "1000", taken: "300", debt: "700" }]);
    // Restricted: no stakes, but payouts still arrive.
    await debit(userId, 1).expect(423);

    // The next pack pays the debt off first and lifts the restriction.
    const next = await bought(userId, 1000);
    view = await card(userId);
    expect(view.wallet).toMatchObject({
      balance: "300",
      debt: "0",
      state: "active",
      restrictedReason: null,
    });
    expect(view.history.items[0]).toMatchObject({
      kind: "clawback",
      amount: "-700",
      ref: `pack:repay:${next}`,
      reason: "debt repaid",
    });
    await debit(userId, 1).expect(200);
    await expectInvariants();
  });

  it("pays a debt off in parts when a pack is smaller than it", async () => {
    const userId = randomUUID();
    const paymentId = await bought(userId, 500);
    await debit(userId, 500).expect(200);
    await h.billing().apply(h.reversalEvent(userId, paymentId, 500));
    await bought(userId, 200);
    expect((await card(userId)).wallet).toMatchObject({
      balance: "0",
      debt: "300",
      state: "restricted",
    });
    await bought(userId, 1000);
    expect((await card(userId)).wallet).toMatchObject({
      balance: "700",
      debt: "0",
      state: "active",
    });
    await expectInvariants();
  });

  it("keeps a debtor restricted when the account comes back to active", async () => {
    const userId = randomUUID();
    const paymentId = await bought(userId, 100);
    await debit(userId, 100).expect(200);
    await h.billing().apply(h.reversalEvent(userId, paymentId, 100));
    const identity = h.identity();
    await identity.apply(h.statusEvent(userId, "suspended", 2));
    // A suspension keeps the debt's own reason.
    expect((await card(userId)).wallet.restrictedReason).toBe("debt");
    await identity.apply(h.statusEvent(userId, "active", 3));
    expect((await card(userId)).wallet).toMatchObject({
      state: "restricted",
      restrictedReason: "debt",
    });

    // Without a debt, the account's restriction comes and goes as before.
    const clean = randomUUID();
    await bought(clean, 10);
    await identity.apply(h.statusEvent(clean, "suspended", 2));
    expect((await card(clean)).wallet.restrictedReason).toBe(
      "account_suspended",
    );
    await identity.apply(h.statusEvent(clean, "active", 3));
    expect((await card(clean)).wallet).toMatchObject({
      state: "active",
      restrictedReason: null,
    });
  });

  it("refuses a case that names another wallet than its pack", async () => {
    const userId = randomUUID();
    const paymentId = await bought(userId, 100);
    await expect(
      h.billing().apply(h.reversalEvent(randomUUID(), paymentId, 100)),
    ).rejects.toThrow(/another wallet/);
    expect((await card(userId)).wallet.balance).toBe("100");
  });
});

describe("the journal and the database", () => {
  it("finds a debt that differs from its packs' reversals, and clears it once it agrees", async () => {
    const userId = randomUUID();
    const paymentId = await bought(userId, 300);
    await debit(userId, 300).expect(200);
    await h.billing().apply(h.reversalEvent(userId, paymentId, 300));
    await bought(userId, 100);
    expect((await card(userId)).wallet.debt).toBe("200");
    const subject = `wallet:${userId}:GRM`;
    const clean = await h.reconciliation().pass("full");
    expect(clean.issues.filter((i) => i.subject === subject)).toEqual([]);

    await h.root.query(
      "update wallets set debt = 50 where user_id = $1 and unit = 'GRM'",
      [userId],
    );
    const drifted = await h.reconciliation().pass("full");
    expect(drifted.issues.filter((i) => i.subject === subject)).toEqual([
      {
        kind: "debt_drift",
        subject,
        details: { cached: "50", journal: "200" },
      },
    ]);
    await h.root.query(
      "update wallets set debt = 200 where user_id = $1 and unit = 'GRM'",
      [userId],
    );
    await h.reconciliation().pass("full");
    expect(
      await rows(
        "select state from reconciliation_issues where kind = 'debt_drift' and subject = $1",
        [subject],
      ),
    ).toEqual([{ state: "resolved" }]);
  });

  it("never lets packs or their reversals be changed", async () => {
    const userId = randomUUID();
    const paymentId = await bought(userId, 10);
    await h.billing().apply(h.reversalEvent(userId, paymentId, 5));
    const { createDatabase } = await import("@outegro/db");
    const app = createDatabase({ url: h.appUrl });
    try {
      for (const statement of [
        "update wallet_lots set grumbles = 1",
        "delete from wallet_lots",
        "update wallet_lot_reversals set taken = 0",
        "delete from wallet_lot_reversals",
      ])
        await expect(app.pool.query(statement)).rejects.toThrow(
          /permission denied/,
        );
    } finally {
      await app.close();
    }
  });
});
