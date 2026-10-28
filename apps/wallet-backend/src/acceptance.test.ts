import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, invariants, startHarness } from "./test/harness.js";

/**
 * W-06: a thousand random commands with a fixed seed against real
 * PostgreSQL — debits, credit batches, grants, adjustments, rollbacks
 * before and after their debits, repeats, conflicting refs and account
 * suspensions. A model in memory predicts every answer; after every
 * command the ledger's invariants hold. Then reconciliation finds nothing
 * and repeating every applied command changes nothing.
 */

const SEED = 20_261_028;
const COMMANDS = 1000;
const PLAYERS = 12;

/** mulberry32: small, fast, and the same sequence for the same seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const random = rng(SEED);
const int = (min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => {
  const item = items[int(0, items.length - 1)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
};
const uuid = () => {
  const hex = Array.from({ length: 32 }, () => int(0, 15).toString(16));
  hex[12] = "4";
  hex[16] = "8";
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

type Applied = {
  path: string;
  body: Record<string, unknown>;
  admin: boolean;
  response: Record<string, unknown>;
};
type Model = {
  balance: Map<string, bigint>;
  restricted: Set<string>;
  accessVersion: Map<string, number>;
  /** Successful debits by ref, and whether they were rolled back. */
  debits: Map<string, { userId: string; amount: bigint; reversed: boolean }>;
  credits: Set<string>;
  tombstones: Set<string>;
  applied: Applied[];
};

let h: Harness;
let ownerHeaders: Record<string, string>;
const players = Array.from({ length: PLAYERS }, uuid);
const owner = uuid();
const model: Model = {
  balance: new Map(players.map((p) => [p, 0n])),
  restricted: new Set(),
  accessVersion: new Map(),
  debits: new Map(),
  credits: new Set(),
  tombstones: new Set(),
  applied: [],
};
const counts: Record<string, number> = {};
let refNo = 0;
const newRef = (prefix: string) => `${prefix}:${SEED}-${++refNo}`;
const balanceOf = (userId: string) => model.balance.get(userId) ?? 0n;

beforeAll(async () => {
  h = await startHarness();
  ownerHeaders = await h.auth(owner, ["owner"]);
});
afterAll(() => h?.close());

async function send(
  path: string,
  body: Record<string, unknown>,
  admin = false,
) {
  return h
    .http()
    .post(path)
    .set(admin ? ownerHeaders : h.service)
    .send(body);
}

function remember(
  path: string,
  body: Record<string, unknown>,
  response: Record<string, unknown>,
  admin = false,
) {
  model.applied.push({ path, body, admin, response });
}

/** One random command; returns its label for the tally. */
async function step(): Promise<string> {
  const roll = random();
  const userId = pick(players);
  const amount = BigInt(int(1, 60));

  if (roll < 0.3) {
    // A debit: a purchase or a stake, sometimes on a tombstoned ref.
    const ref =
      model.tombstones.size > 0 && random() < 0.1
        ? pick([...model.tombstones])
        : newRef("order");
    const body = {
      ref,
      userId,
      unit: "GRM",
      amount: amount.toString(),
      source: pick(["roulette", "battleship-shop"] as const),
      objectRef: `round:${refNo}`,
      meta: { step: refNo },
    };
    const res = await send("/v1/internal/debit", body);
    if (model.tombstones.has(ref)) {
      expect(res.status).toBe(409);
      expect(res.body.error.fieldErrors).toEqual({ ref: ["rolled_back"] });
      return "debit:rolled_back";
    }
    if (model.restricted.has(userId)) {
      expect(res.status).toBe(423);
      return "debit:restricted";
    }
    if (balanceOf(userId) < amount) {
      expect(res.status).toBe(402);
      return "debit:insufficient";
    }
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      balanceBefore: balanceOf(userId).toString(),
      balanceAfter: (balanceOf(userId) - amount).toString(),
      replayed: false,
    });
    model.balance.set(userId, balanceOf(userId) - amount);
    model.debits.set(ref, { userId, amount, reversed: false });
    remember("/v1/internal/debit", body, res.body);
    return "debit:ok";
  }

  if (roll < 0.45) {
    // A batch of payouts.
    const items = Array.from({ length: int(1, 6) }, () => ({
      ref: newRef("payout"),
      userId: pick(players),
      amount: String(int(1, 80)),
    }));
    const body = {
      unit: "GRM",
      source: pick(["roulette", "daily-bonus"] as const),
      items,
    };
    const res = await send("/v1/internal/credit-batch", body);
    expect(res.status).toBe(200);
    for (const [i, item] of items.entries()) {
      const before = balanceOf(item.userId);
      const after = before + BigInt(item.amount);
      expect(res.body.items[i]).toMatchObject({
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
      });
      model.balance.set(item.userId, after);
      model.credits.add(item.ref);
    }
    remember("/v1/internal/credit-batch", body, res.body);
    return "credit:ok";
  }

  if (roll < 0.55 && random() < 0.25) {
    // An operator sets the balance: the wallet grants or takes the difference.
    const target = BigInt(int(0, 400));
    const body = {
      unit: "GRM",
      balance: target.toString(),
      reason: `acceptance step ${refNo}`,
      commandId: uuid(),
    };
    const path = `/v1/admin/wallets/${userId}/set-balance`;
    const res = await send(path, body, true);
    if (target === balanceOf(userId)) {
      expect(res.status).toBe(422);
      return "set:unchanged";
    }
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: target > balanceOf(userId) ? "grant" : "adjust",
      balanceBefore: balanceOf(userId).toString(),
      balanceAfter: target.toString(),
    });
    model.balance.set(userId, target);
    remember(path, body, res.body, true);
    ++refNo;
    return "set:ok";
  }

  if (roll < 0.55) {
    // An operator's grant or adjustment.
    const kind = random() < 0.6 ? "grant" : "adjust";
    const body = {
      unit: "GRM",
      amount: amount.toString(),
      reason: `acceptance step ${refNo}`,
      commandId: uuid(),
    };
    const path = `/v1/admin/wallets/${userId}/${kind}`;
    const res = await send(path, body, true);
    if (kind === "adjust" && balanceOf(userId) < amount) {
      expect(res.status).toBe(402);
      return "adjust:insufficient";
    }
    expect(res.status).toBe(200);
    const after = balanceOf(userId) + (kind === "grant" ? amount : -amount);
    expect(res.body.balanceAfter).toBe(after.toString());
    model.balance.set(userId, after);
    remember(path, body, res.body, true);
    return `${kind}:ok`;
  }

  if (roll < 0.63) {
    // Identity suspends or restores an account.
    const version = (model.accessVersion.get(userId) ?? 0) + 1;
    model.accessVersion.set(userId, version);
    const suspend = !model.restricted.has(userId);
    await h
      .identity()
      .apply(h.statusEvent(userId, suspend ? "suspended" : "active", version));
    if (suspend) model.restricted.add(userId);
    else model.restricted.delete(userId);
    return suspend ? "identity:suspend" : "identity:restore";
  }

  if (roll < 0.8) {
    // A rollback: of a debit (maybe again), of nothing yet, or of a payout.
    const choice = random();
    let ref: string;
    if (choice < 0.55 && model.debits.size > 0)
      ref = pick([...model.debits.keys()]);
    else if (choice < 0.65 && model.credits.size > 0)
      ref = pick([...model.credits]);
    else if (choice < 0.75 && model.tombstones.size > 0)
      ref = pick([...model.tombstones]);
    else ref = newRef("order");
    const res = await send("/v1/internal/rollback", { ref });
    if (model.credits.has(ref)) {
      expect(res.status).toBe(422);
      return "rollback:not_debit";
    }
    expect(res.status).toBe(200);
    const debit = model.debits.get(ref);
    if (debit) {
      expect(res.body).toMatchObject({
        state: "reversed",
        replayed: debit.reversed,
      });
      if (!debit.reversed) {
        const after = balanceOf(debit.userId) + debit.amount;
        expect(res.body.reversal.balanceAfter).toBe(after.toString());
        model.balance.set(debit.userId, after);
        debit.reversed = true;
        return "rollback:reversed";
      }
      return "rollback:replayed";
    }
    expect(res.body).toMatchObject({
      state: "tombstoned",
      replayed: model.tombstones.has(ref),
    });
    model.tombstones.add(ref);
    return "rollback:tombstone";
  }

  // A repeat of an applied command, or its ref with other data.
  if (model.applied.length === 0) return "noop";
  const past = pick(model.applied);
  if (random() < 0.6) {
    const res = await send(past.path, past.body, past.admin);
    expect(res.status).toBe(200);
    if (past.path.endsWith("credit-batch"))
      expect(res.body.items).toEqual(
        (past.response.items as object[]).map((o) => ({
          ...o,
          replayed: true,
        })),
      );
    else expect(res.body).toEqual({ ...past.response, replayed: true });
    return "repeat:same";
  }
  const changed = past.path.endsWith("credit-batch")
    ? {
        ...past.body,
        items: (past.body.items as { amount: string }[]).map((item, i) =>
          i === 0 ? { ...item, amount: String(Number(item.amount) + 1) } : item,
        ),
      }
    : "balance" in past.body
      ? { ...past.body, balance: String(Number(past.body.balance) + 1) }
      : { ...past.body, amount: String(Number(past.body.amount) + 1) };
  const res = await send(past.path, changed, past.admin);
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  return "repeat:conflict";
}

describe("phase 1 acceptance (W-06)", () => {
  it(`keeps every invariant over ${COMMANDS} random commands, seed ${SEED} (TC-W-06-01)`, async () => {
    for (let i = 0; i < COMMANDS; i++) {
      const label = await step();
      counts[label] = (counts[label] ?? 0) + 1;
      const state = await invariants(h);
      expect(state, `after command ${i + 1} (${label})`).toEqual({
        drift: 0,
        chain: 0,
        system: 0,
        total: 0n,
        negative: 0,
      });
    }
    const { rows } = await h.root.query(
      "select user_id, balance::text as balance from wallets",
    );
    const stored = new Map(
      rows.map((r) => [r.user_id as string, BigInt(r.balance)]),
    );
    for (const player of players)
      expect(stored.get(player) ?? 0n, player).toBe(balanceOf(player));
    // The run went through every path, not just the happy one.
    for (const label of [
      "debit:ok",
      "debit:insufficient",
      "debit:restricted",
      "debit:rolled_back",
      "credit:ok",
      "grant:ok",
      "adjust:ok",
      "set:ok",
      "rollback:reversed",
      "rollback:replayed",
      "rollback:tombstone",
      "rollback:not_debit",
      "repeat:same",
      "repeat:conflict",
    ])
      expect(counts[label] ?? 0, label).toBeGreaterThan(0);
  });

  it("leaves nothing for a full reconciliation pass (TC-W-06-02)", async () => {
    const pass = await h.reconciliation().pass("full");
    expect(pass.issues).toEqual([]);
    expect(pass.checkedWallets).toBe(PLAYERS);
    const { rows } = await h.root.query(
      "select count(*)::int as n from reconciliation_runs where mode = 'full' and finished_at is not null",
    );
    expect(rows[0].n).toBe(1);
  });

  it("answers every applied command again without a change (TC-W-06-03)", async () => {
    const before = await h.root.query(
      "select (select count(*) from wallet_tx)::int as tx, (select sum(balance) from wallets)::text as total",
    );
    for (const past of model.applied) {
      const res = await send(past.path, past.body, past.admin);
      expect(res.status, past.path).toBe(200);
      if (past.path.endsWith("credit-batch"))
        for (const item of res.body.items) expect(item.replayed).toBe(true);
      else expect(res.body.replayed).toBe(true);
    }
    const after = await h.root.query(
      "select (select count(*) from wallet_tx)::int as tx, (select sum(balance) from wallets)::text as total",
    );
    expect(after.rows).toEqual(before.rows);
    expect((await h.reconciliation().pass("full")).issues).toEqual([]);
  });
});
