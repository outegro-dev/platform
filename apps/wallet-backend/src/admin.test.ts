import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReconciliationWorker } from "./reconciliation/reconciliation.worker.js";
import { type Harness, invariants, startHarness } from "./test/harness.js";

/**
 * W-03: what the operator sees and does. Commands with preview, reason,
 * a fresh token and audit; reconciliation that finds a drift and resolves
 * it once the cache is right again; the metrics behind the alert.
 */

let h: Harness;
const owner = randomUUID();
let ownerHeaders: Record<string, string>;

beforeAll(async () => {
  h = await startHarness();
  ownerHeaders = await h.auth(owner, ["owner"]);
});
afterAll(() => h?.close());

const asOwner = (accessVersion = 0) => h.auth(owner, ["owner"], accessVersion);

function command(
  kind: "grant" | "adjust",
  userId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = ownerHeaders,
) {
  return h
    .http()
    .post(`/v1/admin/wallets/${userId}/${kind}`)
    .set(headers)
    .send({ unit: "GRM", reason: "compensation for the outage", ...body });
}

describe("admin commands (TC-W-03-02)", () => {
  it("previews without writing, grants once per form and audits it", async () => {
    const userId = randomUUID();
    const commandId = randomUUID();
    const preview = await command("grant", userId, {
      amount: "500",
      commandId,
      preview: true,
    }).expect(200);
    expect(preview.body).toEqual({
      preview: true,
      balanceBefore: "0",
      balanceAfter: "500",
    });
    const card = await h
      .http()
      .get(`/v1/admin/wallets/${userId}`)
      .set(await asOwner())
      .expect(200);
    expect(card.body.wallet).toMatchObject({ exists: false, balance: "0" });

    const granted = await command("grant", userId, {
      amount: "500",
      commandId,
    }).expect(200);
    expect(granted.body).toMatchObject({
      ref: `grant:${commandId}`,
      kind: "grant",
      amount: "500",
      balanceBefore: "0",
      balanceAfter: "500",
      replayed: false,
    });
    // The same form sent again applies nothing new.
    const again = await command("grant", userId, {
      amount: "500",
      commandId,
    }).expect(200);
    expect(again.body).toEqual({ ...granted.body, replayed: true });

    const taken = await command("adjust", userId, {
      amount: "120",
      commandId: randomUUID(),
      reason: "granted by mistake",
    }).expect(200);
    expect(taken.body).toMatchObject({
      kind: "adjust",
      amount: "-120",
      balanceAfter: "380",
    });
    await command("adjust", userId, {
      amount: "381",
      commandId: randomUUID(),
      preview: true,
    }).expect(402);
    const over = await command("adjust", userId, {
      amount: "381",
      commandId: randomUUID(),
    }).expect(402);
    expect(over.body.error.code).toBe("INSUFFICIENT_FUNDS");

    const journal = await h
      .http()
      .get(`/v1/admin/wallets/${userId}`)
      .set(await asOwner())
      .expect(200);
    expect(journal.body.wallet).toMatchObject({
      exists: true,
      balance: "380",
      state: "active",
      version: 2,
    });
    expect(journal.body.history.items).toMatchObject([
      {
        kind: "adjust",
        amount: "-120",
        balanceBefore: "500",
        balanceAfter: "380",
        counterAccount: "adjust",
        reason: "granted by mistake",
        actorId: owner,
      },
      {
        kind: "grant",
        amount: "500",
        balanceBefore: "0",
        balanceAfter: "500",
        counterAccount: "issued_bonus",
        reason: "compensation for the outage",
        actorId: owner,
      },
    ]);
    const audit = await h
      .http()
      .get("/v1/admin/audit")
      .set(await asOwner())
      .expect(200);
    // Both at the test clock's one instant: compared without their order.
    const mine = audit.body.items.filter(
      (entry: { userId: string }) => entry.userId === userId,
    );
    expect(mine).toHaveLength(2);
    expect(mine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "wallet.adjust",
          amount: "-120",
          actorId: owner,
        }),
        expect.objectContaining({
          action: "wallet.grant",
          amount: "500",
          actorId: owner,
        }),
      ]),
    );
    expect(await invariants(h)).toMatchObject({ drift: 0, total: 0n });
  });

  it("takes from a restricted wallet and refuses amounts over the cap or without a reason", async () => {
    const userId = randomUUID();
    await command("grant", userId, {
      amount: "50",
      commandId: randomUUID(),
    }).expect(200);
    await h.identity().apply(h.statusEvent(userId, "suspended", 1));
    await command("adjust", userId, {
      amount: "50",
      commandId: randomUUID(),
    }).expect(200);
    const capped = await command("grant", userId, {
      amount: "1000001",
      commandId: randomUUID(),
    }).expect(400);
    expect(capped.body.error.fieldErrors).toEqual({ amount: ["too_large"] });
    await command("grant", userId, {
      amount: "1",
      commandId: randomUUID(),
      reason: "  ",
    }).expect(400);
    await command("grant", userId, { amount: "1", commandId: "x" }).expect(400);
    await h
      .http()
      .post("/v1/admin/wallets/not-a-uuid/grant")
      .set(await asOwner())
      .send({
        unit: "GRM",
        amount: "1",
        commandId: randomUUID(),
        reason: "test",
      })
      .expect(400);
  });
});

describe("set the balance (owner's additions of 28.10)", () => {
  const setBalance = (
    userId: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = ownerHeaders,
  ) =>
    h
      .http()
      .post(`/v1/admin/wallets/${userId}/set-balance`)
      .set(headers)
      .send({ unit: "GRM", reason: "season reset", ...body });

  it("grants or takes the difference, once per form, and audits it", async () => {
    const userId = randomUUID();
    const up = randomUUID();
    const preview = await setBalance(userId, {
      balance: "750",
      commandId: up,
      preview: true,
    }).expect(200);
    expect(preview.body).toEqual({
      preview: true,
      balanceBefore: "0",
      balanceAfter: "750",
    });
    const raised = await setBalance(userId, {
      balance: "750",
      commandId: up,
    }).expect(200);
    expect(raised.body).toMatchObject({
      ref: `set:${up}`,
      kind: "grant",
      source: "admin",
      amount: "750",
      balanceAfter: "750",
    });
    // The same form again: the same answer, nothing new.
    const again = await setBalance(userId, {
      balance: "750",
      commandId: up,
    }).expect(200);
    expect(again.body).toEqual({ ...raised.body, replayed: true });

    const lowered = await setBalance(userId, {
      balance: "200",
      commandId: randomUUID(),
      reason: "a bonus too many",
    }).expect(200);
    expect(lowered.body).toMatchObject({
      kind: "adjust",
      amount: "-550",
      balanceBefore: "750",
      balanceAfter: "200",
    });
    const same = await setBalance(userId, {
      balance: "200",
      commandId: randomUUID(),
    }).expect(422);
    expect(same.body.error.fieldErrors).toEqual({ balance: ["unchanged"] });
    await setBalance(userId, {
      balance: "200",
      commandId: randomUUID(),
      preview: true,
    }).expect(422);
    const capped = await setBalance(userId, {
      balance: "2000000",
      commandId: randomUUID(),
    }).expect(400);
    expect(capped.body.error.fieldErrors).toEqual({ amount: ["too_large"] });
    await setBalance(userId, { balance: "-5", commandId: randomUUID() }).expect(
      400,
    );
    await setBalance(
      userId,
      { balance: "1", commandId: randomUUID() },
      await h.auth(randomUUID(), ["billing_operator"]),
    ).expect(403);

    const audit = await h
      .http()
      .get("/v1/admin/audit")
      .set(ownerHeaders)
      .expect(200);
    const sets = audit.body.items.filter(
      (e: { userId: string }) => e.userId === userId,
    );
    expect(sets).toHaveLength(2);
    expect(sets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "wallet.set",
          amount: "-550",
          reason: "a bonus too many",
        }),
        expect.objectContaining({
          action: "wallet.set",
          amount: "750",
          reason: "season reset",
        }),
      ]),
    );
    const { rows } = await h.root.query(
      "select counter_account from wallet_tx where user_id = $1 order by wallet_version",
      [userId],
    );
    expect(rows.map((r) => r.counter_account)).toEqual([
      "issued_bonus",
      "adjust",
    ]);
    expect(await invariants(h)).toMatchObject({ drift: 0, total: 0n });
  });

  it("refuses a preview over the cap like the command, and counts as set", async () => {
    const userId = randomUUID();
    await setBalance(userId, {
      balance: "2000000",
      commandId: randomUUID(),
      preview: true,
    }).expect(400);
    const before = await h.metric("wallet_operations_total", {
      kind: "set",
      result: "ok",
    });
    await setBalance(userId, {
      balance: "10",
      commandId: randomUUID(),
    }).expect(200);
    expect(
      await h.metric("wallet_operations_total", { kind: "set", result: "ok" }),
    ).toBe(before + 1);
  });

  it("filters a journal by source and sums the day by source", async () => {
    const userId = randomUUID();
    await command("grant", userId, {
      amount: "100",
      commandId: randomUUID(),
    }).expect(200);
    for (const [source, amount] of [
      ["roulette", "30"],
      ["battleship-shop", "20"],
    ] as const)
      await h
        .http()
        .post("/v1/internal/debit")
        .set(h.service)
        .send({
          ref: `order:${randomUUID()}`,
          userId,
          unit: "GRM",
          amount,
          source,
        })
        .expect(200);
    const roulette = await h
      .http()
      .get(`/v1/admin/wallets/${userId}?source=roulette`)
      .set(ownerHeaders)
      .expect(200);
    expect(
      roulette.body.history.items.map((i: { source: string }) => i.source),
    ).toEqual(["roulette"]);
    await h
      .http()
      .get(`/v1/admin/wallets/${userId}?source=casino`)
      .set(ownerHeaders)
      .expect(400);
    const overview = await h
      .http()
      .get("/v1/admin/overview")
      .set(ownerHeaders)
      .expect(200);
    const bySource = Object.fromEntries(
      overview.body.turnover24h.map(
        (t: { source: string; debited: string; credited: string }) => [
          t.source,
          t,
        ],
      ),
    );
    expect(Number(bySource.roulette.debited)).toBeGreaterThanOrEqual(30);
    expect(Number(bySource["battleship-shop"].debited)).toBeGreaterThanOrEqual(
      20,
    );
    expect(Number(bySource.admin.credited)).toBeGreaterThanOrEqual(100);
  });
});

describe("permissions and fresh tokens (TC-W-03-03)", () => {
  it("keeps the wallet to owners and refuses stale tokens and suspended actors", async () => {
    const userId = randomUUID();
    const operator = randomUUID();
    const billing = await h.auth(operator, ["billing_operator"]);
    await h.http().get("/v1/admin/overview").set(billing).expect(403);
    await h.http().get(`/v1/admin/wallets/${userId}`).set(billing).expect(403);
    await command(
      "grant",
      userId,
      { amount: "1", commandId: randomUUID() },
      billing,
    ).expect(403);
    await h.http().get("/v1/admin/overview").expect(401);

    // The owner's role changed after the token was issued: refresh first.
    const actor = randomUUID();
    await h.identity().apply(h.roleEvent(actor, "owner", 3));
    const stale = await command(
      "grant",
      userId,
      { amount: "1", commandId: randomUUID() },
      await h.auth(actor, ["owner"], 2),
    ).expect(401);
    expect(stale.body.error.code).toBe("UNAUTHENTICATED");
    // Reading needs no fresh token.
    await h
      .http()
      .get("/v1/admin/overview")
      .set(await h.auth(actor, ["owner"], 2))
      .expect(200);
    await command(
      "grant",
      userId,
      { amount: "1", commandId: randomUUID() },
      await h.auth(actor, ["owner"], 3),
    ).expect(200);
    await h.identity().apply(h.statusEvent(actor, "suspended", 4));
    await command(
      "grant",
      userId,
      { amount: "1", commandId: randomUUID() },
      await h.auth(actor, ["owner"], 4),
    ).expect(403);
  });
});

describe("overview and lists", () => {
  it("shows grumbles on hand, operations of the day and the system accounts", async () => {
    const userId = randomUUID();
    await command("grant", userId, {
      amount: "70",
      commandId: randomUUID(),
    }).expect(200);
    const overview = await h
      .http()
      .get("/v1/admin/overview")
      .set(await asOwner())
      .expect(200);
    const { rows } = await h.root.query(
      "select sum(balance)::text as total, count(*)::int as n from wallets",
    );
    expect(overview.body).toMatchObject({
      unit: "GRM",
      onHand: rows[0].total,
      wallets: rows[0].n,
    });
    expect(overview.body.operations24h.grant).toBeGreaterThan(0);
    const accounts = Object.fromEntries(
      overview.body.systemAccounts.map(
        (a: { code: string; balance: string }) => [a.code, BigInt(a.balance)],
      ),
    );
    expect(
      Object.values(accounts).reduce(
        (sum, b) => sum + b,
        BigInt(rows[0].total),
      ),
    ).toBe(0n);

    const restricted = await h
      .http()
      .get("/v1/admin/wallets?state=restricted")
      .set(await asOwner())
      .expect(200);
    for (const wallet of restricted.body.items)
      expect(wallet.state).toBe("restricted");
    const one = await h
      .http()
      .get(`/v1/admin/wallets?userId=${userId}`)
      .set(await asOwner())
      .expect(200);
    expect(one.body.items).toMatchObject([{ userId, balance: "70" }]);
    // Pages walk the whole list once.
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const res: {
        body: { items: { userId: string }[]; nextCursor: string | null };
      } = await h
        .http()
        .get("/v1/admin/wallets")
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set(await asOwner())
        .expect(200);
      for (const item of res.body.items) {
        expect(seen.has(item.userId)).toBe(false);
        seen.add(item.userId);
      }
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(rows[0].n);
  });
});

describe("reconciliation and metrics (TC-W-03-01)", () => {
  it("opens an issue for a cache changed behind the ledger's back and resolves it when fixed", async () => {
    const userId = randomUUID();
    await command("grant", userId, {
      amount: "40",
      commandId: randomUUID(),
    }).expect(200);
    const clean = await h.reconciliation().pass("full");
    expect(clean.issues).toEqual([]);
    expect(
      await h.metric("wallet_reconciliation_issues", { type: "balance_drift" }),
    ).toBe(0);

    await h.root.query(
      "update wallets set balance = balance + 5 where user_id = $1",
      [userId],
    );
    const drifted = await h.reconciliation().pass("sample", {
      since: new Date(0),
      sampleSize: 0,
    });
    expect(drifted.issues.map((i) => i.kind).sort()).toEqual([
      "balance_drift",
      "zero_sum",
    ]);
    expect(drifted.issues).toContainEqual({
      kind: "balance_drift",
      subject: `wallet:${userId}:GRM`,
      details: { cached: "45", journal: "40" },
    });
    expect(
      await h.metric("wallet_reconciliation_issues", { type: "balance_drift" }),
    ).toBe(1);
    expect(
      await h.metric("wallet_reconciliation_issues", { type: "zero_sum" }),
    ).toBe(1);
    const view = await h
      .http()
      .get("/v1/admin/reconciliation")
      .set(await asOwner())
      .expect(200);
    expect(view.body.issues).toContainEqual(
      expect.objectContaining({
        kind: "balance_drift",
        subject: `wallet:${userId}:GRM`,
        state: "open",
      }),
    );
    const overview = await h
      .http()
      .get("/v1/admin/overview")
      .set(await asOwner())
      .expect(200);
    expect(overview.body.openIssues).toBe(2);

    // Seen again: still one issue, not two.
    await h.reconciliation().pass("full");
    const { rows } = await h.root.query(
      "select count(*)::int as n from reconciliation_issues where subject = $1",
      [`wallet:${userId}:GRM`],
    );
    expect(rows[0].n).toBe(1);

    await h.root.query(
      "update wallets set balance = balance - 5 where user_id = $1",
      [userId],
    );
    expect((await h.reconciliation().pass("full")).issues).toEqual([]);
    expect(
      await h.metric("wallet_reconciliation_issues", { type: "balance_drift" }),
    ).toBe(0);
    const resolved = await h
      .http()
      .get("/v1/admin/reconciliation")
      .set(await asOwner())
      .expect(200);
    expect(
      resolved.body.issues.filter((i: { state: string }) => i.state === "open"),
    ).toEqual([]);
  });

  it("finds a system account and a broken chain", async () => {
    const userId = randomUUID();
    await command("grant", userId, {
      amount: "10",
      commandId: randomUUID(),
    }).expect(200);
    await h.root.query(
      "update system_accounts set balance = balance - 1 where code = 'spent'",
    );
    const system = await h.reconciliation().pass("full");
    expect(system.issues.map((i) => i.subject).sort()).toEqual([
      "system:spent:GRM",
      "unit:GRM",
    ]);
    await h.root.query(
      "update system_accounts set balance = balance + 1 where code = 'spent'",
    );
    await h.root.query("update wallets set version = 5 where user_id = $1", [
      userId,
    ]);
    const chain = await h.reconciliation().pass("full");
    expect(chain.issues).toEqual([
      {
        kind: "chain_break",
        subject: `wallet:${userId}:GRM`,
        details: { breaks: 0, version: 5, operations: 1 },
      },
    ]);
    await h.root.query("update wallets set version = 1 where user_id = $1", [
      userId,
    ]);
    expect((await h.reconciliation().pass("full")).issues).toEqual([]);
  });

  it("runs a full pass once a day after the hour and samples otherwise", async () => {
    const worker = h.app.get(ReconciliationWorker);
    h.clock.set(new Date("2026-10-29T01:00:00.000Z"));
    await worker.tick();
    h.clock.set(new Date("2026-10-29T02:30:00.000Z"));
    await worker.tick();
    await worker.tick();
    const { rows } = await h.root.query(
      `select mode from reconciliation_runs where started_at >= '2026-10-29'
       order by started_at`,
    );
    expect(rows.map((r) => r.mode)).toEqual(["sample", "full", "sample"]);
    // Every pass finished, the samples included (they once failed in SQL).
    const runs = await h.root.query(
      `select mode, finished_at is not null as finished, failed, checked_wallets
       from reconciliation_runs where started_at >= '2026-10-29'
       order by started_at`,
    );
    for (const run of runs.rows) {
      expect(run).toMatchObject({ finished: true, failed: false });
      expect(run.checked_wallets).toBeGreaterThan(0);
    }
    expect(
      await h.metric("wallet_reconciliation_last_success_timestamp_seconds"),
    ).toBe(Date.parse("2026-10-29T02:30:00.000Z") / 1000);
    const view = await h
      .http()
      .get("/v1/admin/reconciliation")
      .set(ownerHeaders)
      .expect(200);
    for (const run of view.body.runs)
      expect(run).toMatchObject({ failed: false });
    h.clock.set(new Date("2026-10-28T10:00:00.000Z"));
  });

  it("counts operations, refusals and replays and sums the balances", async () => {
    const userId = randomUUID();
    const before = {
      ok: await h.metric("wallet_operations_total", {
        kind: "debit",
        result: "ok",
      }),
      refused: await h.metric("wallet_operations_total", {
        kind: "debit",
        result: "insufficient_funds",
      }),
      replays: await h.metric("wallet_idempotent_replays_total", {
        kind: "debit",
      }),
    };
    await command("grant", userId, {
      amount: "3",
      commandId: randomUUID(),
    }).expect(200);
    const body = {
      ref: `order:${randomUUID()}`,
      userId,
      unit: "GRM",
      amount: "2",
      source: "battleship-shop",
    };
    for (let i = 0; i < 2; i++)
      await h
        .http()
        .post("/v1/internal/debit")
        .set(h.service)
        .send(body)
        .expect(200);
    await h
      .http()
      .post("/v1/internal/debit")
      .set(h.service)
      .send({ ...body, ref: `order:${randomUUID()}` })
      .expect(402);
    expect(
      await h.metric("wallet_operations_total", {
        kind: "debit",
        result: "ok",
      }),
    ).toBe(before.ok + 1);
    expect(
      await h.metric("wallet_operations_total", {
        kind: "debit",
        result: "insufficient_funds",
      }),
    ).toBe(before.refused + 1);
    expect(
      await h.metric("wallet_idempotent_replays_total", { kind: "debit" }),
    ).toBe(before.replays + 1);
    const { rows } = await h.root.query(
      "select sum(balance)::text as total from wallets",
    );
    expect(await h.metric("wallet_balance_total", { unit: "GRM" })).toBe(
      Number(rows[0].total),
    );
    expect(
      await h.metric("wallet_operation_duration_seconds_count", {
        kind: "debit",
      }),
    ).toBeGreaterThanOrEqual(3);
  });
});
