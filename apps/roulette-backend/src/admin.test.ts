import { randomUUID } from "node:crypto";
import { colorOf } from "@outegro/roulette-engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminAudit, bets, rounds } from "./db/schema.js";
import {
  type Harness,
  type Instance,
  OPENING_BALANCE,
  startHarness,
} from "./test/harness.js";

let h: Harness;
let a: Instance;
const owner = randomUUID();
const support = randomUUID();

beforeAll(async () => {
  h = await startHarness();
  a = await h.boot("a");
  await h.advance(0);
});

afterAll(async () => {
  await h?.stop();
});

const as = async (userId: string, roles: string[], accessVersion = 0) =>
  h.auth(userId, roles, accessVersion);

async function table() {
  return (
    await a
      .http()
      .get("/v1/admin/table")
      .set(await as(owner, ["owner"]))
      .expect(200)
  ).body;
}

async function changeTable(
  change: Record<string, unknown>,
  options: { preview?: boolean; version?: number } = {},
) {
  const current = await table();
  return a
    .http()
    .post("/v1/admin/table")
    .set(await as(owner, ["owner"]))
    .send({
      minBet: current.minBet,
      maxBet: current.maxBet,
      betsPerRound: current.betsPerRound,
      payoutLimitPerColor: current.payoutLimitPerColor,
      paused: current.paused,
      maintenance: current.maintenance,
      ...change,
      expectedVersion: options.version ?? current.version,
      reason: "test change",
      ...(options.preview ? { preview: true } : {}),
    });
}

/** Runs the current round out and waits for the next one to take bets. */
async function nextBettingRound() {
  const current = await a.round(() => true);
  for (;;) {
    await h.advance(1000);
    const view = await a.round(() => true);
    if (view.round > current.round && view.phase === "betting") return view;
  }
}

describe("admin", () => {
  it("lets support look and only the owner act", async () => {
    await a
      .http()
      .get("/v1/admin/live")
      .set(await as(randomUUID(), []))
      .expect(403);
    await a
      .http()
      .get("/v1/admin/live")
      .set(await as(support, ["support"]))
      .expect(200);
    const current = await table();
    await a
      .http()
      .post("/v1/admin/table")
      .set(await as(support, ["support"]))
      .send({ ...current, expectedVersion: current.version, reason: "nope" })
      .expect(403);
    const round = await a.round(() => true);
    await a
      .http()
      .post(`/v1/admin/rounds/${round.round}/void`)
      .set(await as(support, ["support"]))
      .send({ reason: "nope" })
      .expect(403);
  });

  it("changes the table with a preview, the version and the audit", async () => {
    const before = await table();
    const preview = await changeTable({ maxBet: 50_000 }, { preview: true });
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.after.maxBet).toBe(50_000);
    expect((await table()).maxBet).toBe(before.maxBet);

    const done = await changeTable({ maxBet: 50_000 });
    expect(done.status).toBe(200);
    expect(done.body.after).toMatchObject({
      maxBet: 50_000,
      version: before.version + 1,
    });
    // A second change against the old version loses.
    expect(
      (await changeTable({ maxBet: 60_000 }, { version: before.version }))
        .status,
    ).toBe(409);
    const audit = await h.db(a).select().from(adminAudit);
    expect(audit.map((entry) => entry.action)).toContain("table.update");

    // A token older than the actor's latest role change must be refreshed.
    h.identity.set(owner, { status: "active", accessVersion: 3 });
    const current = await table();
    const stale = await a
      .http()
      .post("/v1/admin/table")
      .set(await as(owner, ["owner"], 2))
      .send({ ...current, expectedVersion: current.version, reason: "stale" });
    expect(stale.status).toBe(401);
    h.identity.set(owner, { status: "active", accessVersion: 0 });
    expect((await changeTable({ maxBet: 100_000 })).status).toBe(200);
  });

  it("pauses bets while rounds keep spinning", async () => {
    await nextBettingRound();
    const player = await a.connect();
    expect((await changeTable({ paused: true })).status).toBe(200);
    expect(await player.bet("red", 10)).toEqual({
      ok: false,
      code: "bets_paused",
    });
    await h.advance(250);
    await a.round((view) => view.table.paused);
    expect((await changeTable({ paused: false })).status).toBe(200);
    expect((await player.bet("red", 10)).ok).toBe(true);
    await player.close();
  });

  it("opens no new round in maintenance", async () => {
    const round = await nextBettingRound();
    expect((await changeTable({ maintenance: true })).status).toBe(200);
    for (let i = 0; i < 40; i++) await h.advance(1000);
    const view = await a.round((v) => v.table.maintenance);
    expect(view.round).toBe(round.round);
    expect(view.phase).toBe("settled");
    expect((await changeTable({ maintenance: false })).status).toBe(200);
    await nextBettingRound();
  });

  it("voids a round and returns every bet", async () => {
    const round = await nextBettingRound();
    const players = await Promise.all([a.connect(), a.connect()]);
    for (const [i, player] of players.entries())
      expect((await player.bet(i ? "green" : "black", 100 + i)).ok).toBe(true);

    const url = `/v1/admin/rounds/${round.round}/void`;
    const preview = await a
      .http()
      .post(url)
      .set(await as(owner, ["owner"]))
      .send({ reason: "test void", preview: true })
      .expect(200);
    expect(preview.body).toMatchObject({
      preview: true,
      bets: 2,
      refunded: 201,
    });

    const done = await a
      .http()
      .post(url)
      .set(await as(owner, ["owner"]))
      .send({ reason: "test void" })
      .expect(200);
    expect(done.body).toMatchObject({ preview: false, bets: 2, refunded: 201 });
    for (const player of players)
      expect(await h.wallet.balance(player.userId)).toBe(OPENING_BALANCE);
    const recorded = await h
      .db(a)
      .select()
      .from(bets)
      .where(eq(bets.roundId, round.round));
    expect(recorded.map((bet) => bet.status)).toEqual(["refunded", "refunded"]);
    const [row] = await h
      .db(a)
      .select()
      .from(rounds)
      .where(eq(rounds.id, round.round));
    expect(row?.status).toBe("voided");
    // The chain stays in order: the voided round still spent its seed.
    expect(row?.seed).toBe(h.fair.seedOf(round.round));

    await h.advance(250);
    await a.round(
      (v) =>
        v.round === round.round && v.phase === "voided" && v.result === null,
    );
    // The engine moves on after the pause.
    await nextBettingRound();
    await a
      .http()
      .post(url)
      .set(await as(owner, ["owner"]))
      .send({ reason: "again" })
      .expect(200);
    for (const player of players) await player.close();
  });

  it("shows the live table, rounds with their chain check, players and services", async () => {
    const round = await a.round((view) => view.phase === "betting");
    const player = await a.connect();
    const number = await h.fair.numberOf(round.round);
    expect((await player.bet(colorOf(number), 1000)).ok).toBe(true);
    // The presence report runs each second in real time.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const live = await a
      .http()
      .get("/v1/admin/live")
      .set(await as(support, ["support"]))
      .expect(200);
    expect(live.body.online).toBeGreaterThanOrEqual(1);
    const color = colorOf(number);
    expect(live.body.exposure[color]).toBe(1000 * (color === "green" ? 14 : 2));

    await nextBettingRound();
    const list = await a
      .http()
      .get("/v1/admin/rounds?limit=5")
      .set(await as(support, ["support"]))
      .expect(200);
    const settled = list.body.items.find(
      (item: { round: number }) => item.round === round.round,
    );
    expect(settled).toMatchObject({
      phase: "settled",
      number,
      bets: 1,
      staked: 1000,
    });
    expect(settled.result).toBe(1000 - 1000 * (color === "green" ? 14 : 2));
    const detail = await a
      .http()
      .get(`/v1/admin/rounds/${round.round}`)
      .set(await as(support, ["support"]))
      .expect(200);
    expect(detail.body.linkVerified).toBe(true);
    expect(detail.body.topBets[0]).toMatchObject({
      userId: player.userId,
      status: "won",
    });

    const players = await a
      .http()
      .get(
        `/v1/admin/players?q=${encodeURIComponent(player.ready.player.nickname)}`,
      )
      .set(await as(support, ["support"]))
      .expect(200);
    expect(players.body.items[0]).toMatchObject({
      userId: player.userId,
      bets: 1,
      staked: 1000,
    });
    await a
      .http()
      .get(`/v1/admin/players/${player.userId}`)
      .set(await as(support, ["support"]))
      .expect(200);

    const services = await a
      .http()
      .get("/v1/admin/services")
      .set(await as(support, ["support"]))
      .expect(200);
    expect(services.body.wallet).toBe("memory");
    expect(services.body.leader?.instance).toBe(a.driver.instanceId);
    const fair = services.body.services.find(
      (s: { name: string }) => s.name === "fair-roll",
    );
    expect(fair.status).toBe("down");
    await player.close();
  });
});
