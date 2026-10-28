import { randomUUID } from "node:crypto";
import {
  adminWalletCardSchema,
  rollbackResponseSchema,
} from "@outegro/contracts/wallet";
import { createDatabase } from "@outegro/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, invariants, startHarness } from "./test/harness.js";

/**
 * W-01 and W-02 on real PostgreSQL: the journal only grows, caches equal
 * the journal and every account of a unit sums to zero after each
 * operation, concurrent debits never overdraw, refs make every call
 * idempotent, a rollback before its debit leaves a tombstone.
 */

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

const ref = (prefix = "order") => `${prefix}:${randomUUID()}`;
type Page = { nextCursor: string | null };

function debit(body: Record<string, unknown>) {
  return h
    .http()
    .post("/v1/internal/debit")
    .set(h.service)
    .send({ unit: "GRM", source: "roulette", ...body });
}

function credit(items: Record<string, unknown>[], extra = {}) {
  return h
    .http()
    .post("/v1/internal/credit-batch")
    .set(h.service)
    .send({ unit: "GRM", source: "roulette", items, ...extra });
}

function rollback(body: Record<string, unknown>) {
  return h.http().post("/v1/internal/rollback").set(h.service).send(body);
}

/** A player with `amount` grumbles, paid out through the internal API. */
async function funded(amount: number) {
  const userId = randomUUID();
  await credit([{ ref: ref("payout"), userId, amount: String(amount) }]).expect(
    200,
  );
  return userId;
}

async function balance(userId: string) {
  const res = await h
    .http()
    .get("/v1/me/wallet")
    .set(await h.auth(userId))
    .expect(200);
  return res.body.balance as string;
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

describe("journal and database guarantees (W-01)", () => {
  it("never lets the application role or the owner change the journal (TC-W-01-01)", async () => {
    const userId = await funded(10);
    const app = createDatabase({ url: h.appUrl });
    try {
      for (const statement of [
        "update wallet_tx set amount = 999",
        "delete from wallet_tx",
        "truncate wallet_tx",
        "update wallet_refs set request_fingerprint = 'x'",
        "delete from wallet_refs",
      ])
        await expect(
          app.pool.query(statement),
          statement,
        ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.close();
    }
    // Even a superuser hits the trigger.
    for (const statement of [
      "update wallet_tx set reason = 'x'",
      "delete from wallet_tx",
      "truncate wallet_tx",
    ])
      await expect(h.root.query(statement), statement).rejects.toThrow(
        /append-only/,
      );
    expect(await balance(userId)).toBe("10");
    await expectInvariants();
  });

  it("refuses a negative balance and a journal row whose numbers do not add up (TC-W-01-03)", async () => {
    const userId = await funded(5);
    await expect(
      h.root.query("update wallets set balance = -1 where user_id = $1", [
        userId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.root.query(
        `insert into wallet_tx (id, user_id, unit, kind, source, ref, amount, balance_before,
           balance_after, wallet_version, counter_account, created_at)
         values ($1, $2, 'GRM', 'credit', 'roulette', $3, 5, 5, 11, 99, 'spent', now())`,
        [randomUUID(), userId, ref()],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const unknown = await debit({
      ref: ref(),
      userId,
      unit: "XYZ",
      amount: "1",
    }).expect(400);
    expect(unknown.body.error.fieldErrors).toHaveProperty("unit");
    for (const amount of ["0", "-5", "1.5", "1e3", "1000000000000000"])
      await debit({ ref: ref(), userId, amount }).expect(400);
    // Refs the wallet builds itself are not for callers.
    await debit({ ref: "grant:x", userId, amount: "1" }).expect(400);
    await rollback({ ref: "rollback:x" }).expect(400);
    expect(await balance(userId)).toBe("5");
    await expectInvariants();
  });

  it("keeps every cache equal to the journal and all accounts at zero after each operation (TC-W-01-02)", async () => {
    const userId = await funded(100);
    await expectInvariants();
    const first = ref();
    await debit({ ref: first, userId, amount: "30" }).expect(200);
    await expectInvariants();
    await rollback({ ref: first }).expect(200);
    await expectInvariants();
    await debit({ ref: ref(), userId, amount: "100" }).expect(200);
    await expectInvariants();
    await credit([
      { ref: ref("payout"), userId, amount: "7" },
      { ref: ref("payout"), userId, amount: "3" },
    ]).expect(200);
    await expectInvariants();
    const { rows } = await h.root.query(
      `select kind, amount::text, balance_before::text as before,
         balance_after::text as after, wallet_version as version
       from wallet_tx where user_id = $1 order by wallet_version`,
      [userId],
    );
    expect(rows).toEqual([
      { kind: "credit", amount: "100", before: "0", after: "100", version: 1 },
      { kind: "debit", amount: "-30", before: "100", after: "70", version: 2 },
      {
        kind: "reversal",
        amount: "30",
        before: "70",
        after: "100",
        version: 3,
      },
      { kind: "debit", amount: "-100", before: "100", after: "0", version: 4 },
      { kind: "credit", amount: "7", before: "0", after: "7", version: 5 },
      { kind: "credit", amount: "3", before: "7", after: "10", version: 6 },
    ]);
  });
});

describe("operations and idempotency (W-02)", () => {
  it("lets 100 concurrent debits take exactly the balance (TC-W-02-01)", async () => {
    const userId = await funded(50);
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        debit({ ref: ref(), userId, amount: "1" }),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(50);
    expect(statuses.filter((s) => s === 402)).toHaveLength(50);
    for (const refused of responses.filter((r) => r.status === 402))
      expect(refused.body.error).toMatchObject({
        code: "INSUFFICIENT_FUNDS",
        retryable: false,
      });
    expect(await balance(userId)).toBe("0");
    const { rows } = await h.root.query(
      "select count(*)::int as n from wallet_tx where user_id = $1 and kind = 'debit'",
      [userId],
    );
    expect(rows[0].n).toBe(50);
    // Every success saw a distinct balance: no two debits read the same one.
    const afters = responses
      .filter((r) => r.status === 200)
      .map((r) => Number(r.body.balanceAfter))
      .sort((a, b) => a - b);
    expect(afters).toEqual(Array.from({ length: 50 }, (_, i) => i));
    await expectInvariants();
  });

  it("answers a repeat with the same operation and refuses the ref with other data (TC-W-02-02)", async () => {
    const userId = await funded(20);
    const key = ref();
    const meta = { roundId: randomUUID(), color: "red" };
    const first = await debit({ ref: key, userId, amount: "5", meta }).expect(
      200,
    );
    expect(first.body).toMatchObject({
      ref: key,
      userId,
      unit: "GRM",
      kind: "debit",
      amount: "-5",
      balanceBefore: "20",
      balanceAfter: "15",
      replayed: false,
    });
    // The same request again (a reason does not change it): the same answer.
    const again = await debit({
      ref: key,
      userId,
      amount: "5",
      meta,
      reason: "retry",
    }).expect(200);
    expect(again.body).toEqual({ ...first.body, replayed: true });
    // Concurrent repeats wait for the first and get its answer too.
    const burst = await Promise.all(
      Array.from({ length: 10 }, () =>
        debit({ ref: key, userId, amount: "5" }),
      ),
    );
    for (const res of burst) expect(res.body.txId).toBe(first.body.txId);
    const other = await debit({ ref: key, userId, amount: "6" }).expect(409);
    expect(other.body.error).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      fieldErrors: { ref: ["conflict"] },
    });
    await debit({ ref: key, userId: randomUUID(), amount: "5" }).expect(409);
    expect(await balance(userId)).toBe("15");
    // A refusal is not stored: the same ref works once the money is there.
    const later = ref();
    await debit({ ref: later, userId, amount: "40" }).expect(402);
    await credit([{ ref: ref("payout"), userId, amount: "25" }]).expect(200);
    await debit({ ref: later, userId, amount: "40" }).expect(200);
    expect(await balance(userId)).toBe("0");
    await expectInvariants();
  });

  it("leaves a tombstone for a rollback before its debit and reverses a debit once (TC-W-02-03)", async () => {
    const userId = await funded(10);
    const early = ref();
    const tombstone = await rollback({ ref: early }).expect(200);
    expect(tombstone.body).toEqual({
      ref: early,
      state: "tombstoned",
      reversal: null,
      replayed: false,
    });
    const late = await debit({ ref: early, userId, amount: "3" }).expect(409);
    expect(late.body.error.fieldErrors).toEqual({ ref: ["rolled_back"] });
    expect((await rollback({ ref: early }).expect(200)).body).toMatchObject({
      state: "tombstoned",
      replayed: true,
    });

    const paid = ref();
    await debit({ ref: paid, userId, amount: "4" }).expect(200);
    const reversed = await rollback({
      ref: paid,
      reason: "round cancelled",
    }).expect(200);
    expect(reversed.body).toMatchObject({
      ref: paid,
      state: "reversed",
      replayed: false,
      reversal: {
        ref: `rollback:${paid}`,
        kind: "reversal",
        amount: "4",
        balanceBefore: "6",
        balanceAfter: "10",
      },
    });
    const twice = await rollback({ ref: paid }).expect(200);
    expect(twice.body).toEqual({
      ...reversed.body,
      replayed: true,
      reversal: { ...reversed.body.reversal, replayed: true },
    });
    // A late retry of a reversed debit must not read as a success.
    const retried = await debit({ ref: paid, userId, amount: "4" }).expect(409);
    expect(retried.body.error.fieldErrors).toEqual({ ref: ["rolled_back"] });
    // Only debits roll back.
    const payout = ref("payout");
    await credit([{ ref: payout, userId, amount: "1" }]).expect(200);
    const refused = await rollback({ ref: payout }).expect(422);
    expect(refused.body.error.fieldErrors).toEqual({ ref: ["not_debit"] });
    expect(await balance(userId)).toBe("11");
    await expectInvariants();
  });

  it("orders a debit and a rollback of one ref that race (TC-W-02-03)", async () => {
    const userId = await funded(100);
    const refs = Array.from({ length: 20 }, () => ref());
    const results = await Promise.all(
      refs.flatMap((key) => [
        debit({ ref: key, userId, amount: "5" }),
        rollback({ ref: key }),
      ]),
    );
    for (let i = 0; i < refs.length; i++) {
      const [d, r] = [results[2 * i], results[2 * i + 1]];
      if (r?.body.state === "tombstoned") expect(d?.status).toBe(409);
      else {
        expect(d?.status).toBe(200);
        expect(r?.body.state).toBe("reversed");
      }
    }
    // Whatever the order, every grumble came back.
    expect(await balance(userId)).toBe("100");
    await expectInvariants();
  });

  it("applies a credit batch whole or not at all (TC-W-02-04)", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const taken = ref("payout");
    await credit([{ ref: taken, userId: a, amount: "1" }]).expect(200);
    const items = [
      { ref: ref("payout"), userId: a, amount: "10", meta: { roundId: "r1" } },
      { ref: ref("payout"), userId: b, amount: "20" },
      { ref: ref("payout"), userId: a, amount: "5" },
    ];
    const refused = await credit([
      ...items,
      { ref: taken, userId: a, amount: "2" },
    ]).expect(409);
    expect(refused.body.error.fieldErrors).toEqual({
      "items.3.ref": ["conflict"],
    });
    expect(await balance(a)).toBe("1");
    expect(await balance(b)).toBe("0");
    const dup = await credit([
      ...items.slice(0, 1),
      ...items.slice(0, 1),
    ]).expect(400);
    expect(dup.body.error.fieldErrors).toHaveProperty(["items.1.ref"]);

    const applied = await credit(items, { correlationId: "round-r1" }).expect(
      200,
    );
    expect(
      applied.body.items.map((o: { balanceAfter: string }) => o.balanceAfter),
    ).toEqual(["11", "20", "16"]);
    const again = await credit(items).expect(200);
    expect(again.body.items).toEqual(
      applied.body.items.map((o: object) => ({ ...o, replayed: true })),
    );
    expect(await balance(a)).toBe("16");
    expect(await balance(b)).toBe("20");
    const tooMany = Array.from({ length: 1001 }, () => ({
      ref: ref("payout"),
      userId: a,
      amount: "1",
    }));
    await credit(tooMany).expect(400);
    await expectInvariants();
  });

  it("serves batches of a thousand without deadlocks against debits", async () => {
    const players = Array.from({ length: 50 }, () => randomUUID());
    const batch = () =>
      credit(
        Array.from({ length: 1000 }, (_, i) => ({
          ref: ref("payout"),
          userId: players[(i * 7) % players.length],
          amount: "1",
        })),
      );
    const results = await Promise.all([
      batch(),
      batch(),
      ...players.map((userId) => debit({ ref: ref(), userId, amount: "1" })),
    ]);
    expect(results.slice(0, 2).map((r) => r.status)).toEqual([200, 200]);
    for (const r of results.slice(2)) expect([200, 402]).toContain(r.status);
    await expectInvariants();
  });

  it("keeps the internal API to services and a wallet to its owner (TC-W-02-05)", async () => {
    const userId = await funded(9);
    const body = {
      ref: ref(),
      userId,
      unit: "GRM",
      amount: "1",
      source: "battleship-shop",
    };
    await h.http().post("/v1/internal/debit").send(body).expect(401);
    await h
      .http()
      .post("/v1/internal/debit")
      .set({ authorization: `Bearer ${"x".repeat(64)}` })
      .send(body)
      .expect(401);
    // A player's token is not a service token.
    await h
      .http()
      .post("/v1/internal/debit")
      .set(await h.auth(userId))
      .send(body)
      .expect(401);
    await debit({ ...body, reason: "skin", meta: { orderId: "o-1" } }).expect(
      200,
    );

    const mine = await h
      .http()
      .get("/v1/me/wallet/history")
      .set(await h.auth(userId))
      .expect(200);
    expect(mine.body.items).toHaveLength(2);
    for (const item of mine.body.items)
      expect(Object.keys(item).sort()).toEqual([
        "amount",
        "balanceAfter",
        "balanceBefore",
        "createdAt",
        "id",
        "kind",
        "source",
      ]);
    const stranger = randomUUID();
    const theirs = await h
      .http()
      .get("/v1/me/wallet")
      .set(await h.auth(stranger))
      .expect(200);
    expect(theirs.body).toEqual({
      unit: "GRM",
      balance: "0",
      state: "active",
      exists: false,
      updatedAt: null,
    });
    await h.http().get("/v1/me/wallet").expect(401);
    await h
      .http()
      .get("/v1/me/wallet/history?cursor=bogus")
      .set(await h.auth(userId))
      .expect(400);
  });

  it("reads many balances for a service, unknown and restricted players included", async () => {
    const rich = await funded(70);
    const restricted = await funded(5);
    await h.identity().apply(h.statusEvent(restricted, "suspended", 1));
    const newcomer = randomUUID();
    const suspendedNewcomer = randomUUID();
    await h.identity().apply(h.statusEvent(suspendedNewcomer, "suspended", 1));
    const ids = [rich, newcomer, restricted, suspendedNewcomer, rich];
    const res = await h
      .http()
      .post("/v1/internal/balances")
      .set(h.service)
      .send({ unit: "GRM", userIds: ids })
      .expect(200);
    expect(res.body.items).toEqual([
      {
        userId: rich,
        unit: "GRM",
        balance: "70",
        state: "active",
        exists: true,
      },
      {
        userId: newcomer,
        unit: "GRM",
        balance: "0",
        state: "active",
        exists: false,
      },
      {
        userId: restricted,
        unit: "GRM",
        balance: "5",
        state: "restricted",
        exists: true,
      },
      {
        userId: suspendedNewcomer,
        unit: "GRM",
        balance: "0",
        state: "restricted",
        exists: false,
      },
      {
        userId: rich,
        unit: "GRM",
        balance: "70",
        state: "active",
        exists: true,
      },
    ]);
    await h
      .http()
      .post("/v1/internal/balances")
      .send({ unit: "GRM", userIds: [rich] })
      .expect(401);
    await h
      .http()
      .post("/v1/internal/balances")
      .set(h.service)
      .send({ unit: "GRM", userIds: [] })
      .expect(400);
    await h
      .http()
      .post("/v1/internal/balances")
      .set(h.service)
      .send({
        unit: "GRM",
        userIds: Array.from({ length: 1001 }, () => randomUUID()),
      })
      .expect(400);
  });

  it("pages a player's history by the wallet's own order", async () => {
    const userId = await funded(30);
    for (let i = 0; i < 4; i++)
      await debit({ ref: ref(), userId, amount: "1" }).expect(200);
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { items: { balanceAfter: string }[] } & Page } =
        await h
          .http()
          .get("/v1/me/wallet/history")
          .query({ limit: 2, ...(cursor ? { cursor } : {}) })
          .set(await h.auth(userId))
          .expect(200);
      seen.push(...res.body.items.map((i) => Number(i.balanceAfter)));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([26, 27, 28, 29, 30]);
  });
});

describe("review fixes", () => {
  it("rolls back a debit whose ref is as long as allowed, inside the contract", async () => {
    const userId = await funded(10);
    const long = `order:${"x".repeat(194)}`;
    expect(long).toHaveLength(200);
    await debit({ ref: long, userId, amount: "3" }).expect(200);
    const back = await rollback({ ref: long }).expect(200);
    expect(back.body.reversal.ref).toHaveLength(209);
    expect(rollbackResponseSchema.safeParse(back.body).success).toBe(true);
    const card = await h
      .http()
      .get(`/v1/admin/wallets/${userId}`)
      .set(await h.auth(randomUUID(), ["owner"]))
      .expect(200);
    expect(adminWalletCardSchema.safeParse(card.body).success).toBe(true);
  });

  it("gives back what was spent for a return from pay", async () => {
    const userId = randomUUID();
    await credit([{ ref: ref("return"), userId, amount: "15" }], {
      source: "pay",
    }).expect(200);
    const { rows } = await h.root.query(
      "select counter_account from wallet_tx where user_id = $1",
      [userId],
    );
    expect(rows).toEqual([{ counter_account: "spent" }]);
  });

  it("refuses cursors PostgreSQL could not hold, with 400", async () => {
    const userId = await funded(1);
    const huge = Buffer.from("v9999999999").toString("base64url");
    await h
      .http()
      .get(`/v1/me/wallet/history?cursor=${huge}`)
      .set(await h.auth(userId))
      .expect(400);
    const far = Buffer.from(
      `+275760-09-13T00:00:00.000Z|${randomUUID()}`,
    ).toString("base64url");
    await h
      .http()
      .get(`/v1/admin/wallets?cursor=${far}`)
      .set(await h.auth(randomUUID(), ["owner"]))
      .expect(400);
  });
});

describe("sources (owner's additions of 28.10)", () => {
  it("keeps the source and the object of every operation; a daily bonus is issued, payouts return what was spent", async () => {
    const userId = randomUUID();
    const daily = `daily:${userId}:1`;
    const bonus = await credit([{ ref: daily, userId, amount: "100" }], {
      source: "daily-bonus",
    }).expect(200);
    expect(bonus.body.items[0]).toMatchObject({
      source: "daily-bonus",
      objectRef: null,
    });
    const stake = ref("stake");
    const debited = await debit({
      ref: stake,
      userId,
      amount: "30",
      objectRef: "round:1207",
      meta: { roundId: "1207", color: "red" },
    }).expect(200);
    expect(debited.body).toMatchObject({
      source: "roulette",
      objectRef: "round:1207",
    });
    await credit([
      { ref: ref("payout"), userId, amount: "60", objectRef: "round:1207" },
    ]).expect(200);
    const back = await rollback({ ref: stake }).expect(200);
    expect(back.body.reversal).toMatchObject({
      source: "roulette",
      objectRef: "round:1207",
    });
    const { rows } = await h.root.query(
      `select kind, source, object_ref, counter_account from wallet_tx
       where user_id = $1 order by wallet_version`,
      [userId],
    );
    expect(rows).toEqual([
      {
        kind: "credit",
        source: "daily-bonus",
        object_ref: null,
        counter_account: "issued_bonus",
      },
      {
        kind: "debit",
        source: "roulette",
        object_ref: "round:1207",
        counter_account: "spent",
      },
      {
        kind: "credit",
        source: "roulette",
        object_ref: "round:1207",
        counter_account: "spent",
      },
      {
        kind: "reversal",
        source: "roulette",
        object_ref: "round:1207",
        counter_account: "spent",
      },
    ]);
    // The source is part of the request: the same ref from another one is not.
    await credit([{ ref: daily, userId, amount: "100" }], {
      source: "roulette",
    }).expect(409);
    // Every call names its source; the console's own is not for callers.
    await h
      .http()
      .post("/v1/internal/debit")
      .set(h.service)
      .send({ ref: ref(), userId, unit: "GRM", amount: "1" })
      .expect(400);
    await debit({ ref: ref(), userId, amount: "1", source: "admin" }).expect(
      400,
    );
    await debit({ ref: ref(), userId, amount: "1", objectRef: "a b" }).expect(
      400,
    );
    const history = await h
      .http()
      .get("/v1/me/wallet/history")
      .set(await h.auth(userId))
      .expect(200);
    expect(history.body.items.map((i: { source: string }) => i.source)).toEqual(
      ["roulette", "roulette", "roulette", "daily-bonus"],
    );
    await expectInvariants();
  });
});

describe("accounts from Identity (TC-W-01-04)", () => {
  it("restricts debits of a suspended account and lifts it only with a newer status", async () => {
    const userId = await funded(10);
    const identity = h.identity();
    await identity.apply(h.statusEvent(userId, "suspended", 2));
    const refused = await debit({ ref: ref(), userId, amount: "1" }).expect(
      423,
    );
    expect(refused.body.error.code).toBe("WALLET_RESTRICTED");
    // Restricted is checked before the balance.
    await debit({ ref: ref(), userId, amount: "999" }).expect(423);
    // Payouts and rollbacks still arrive.
    await credit([{ ref: ref("payout"), userId, amount: "5" }]).expect(200);
    // An older status, and the same event again, change nothing.
    expect(await identity.apply(h.statusEvent(userId, "active", 1))).toBe(
      false,
    );
    const replayed = h.statusEvent(userId, "suspended", 2);
    await identity.apply(replayed);
    expect(await identity.apply(replayed)).toBe(false);
    await debit({ ref: ref(), userId, amount: "1" }).expect(423);
    expect(await identity.apply(h.statusEvent(userId, "active", 3))).toBe(true);
    await debit({ ref: ref(), userId, amount: "1" }).expect(200);
    expect(await balance(userId)).toBe("14");

    // A deleted account keeps its balance and journal, restricted.
    await identity.apply(h.statusEvent(userId, "deleted", 4));
    const view = await h
      .http()
      .get("/v1/me/wallet")
      .set(await h.auth(userId))
      .expect(200);
    expect(view.body).toMatchObject({ balance: "14", state: "restricted" });
    await expectInvariants();
  });

  it("creates the wallet of a suspended account restricted", async () => {
    const userId = randomUUID();
    await h.identity().apply(h.statusEvent(userId, "suspended", 1));
    await credit([{ ref: ref("payout"), userId, amount: "3" }]).expect(200);
    await debit({ ref: ref(), userId, amount: "1" }).expect(423);
    const fresh = randomUUID();
    await h.identity().apply(h.statusEvent(fresh, "suspended", 1));
    await debit({ ref: ref(), userId: fresh, amount: "1" }).expect(423);
  });
});
