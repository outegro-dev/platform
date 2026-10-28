import { colorOf, roll, verifyLink } from "@outegro/roulette-engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bets, rounds } from "./db/schema.js";
import { betRef } from "./domain/ids.js";
import { RoundRepository } from "./rounds/round.repository.js";
import { SettlementService } from "./rounds/settlement.service.js";
import {
  type Harness,
  type Instance,
  OPENING_BALANCE,
  ORIGIN,
  startHarness,
} from "./test/harness.js";
import { TestSocket } from "./test/socket-client.js";

let h: Harness;
let a: Instance;

beforeAll(async () => {
  h = await startHarness();
  a = await h.boot("a");
});

afterAll(async () => {
  await h?.stop();
});

/** Moves time to the end of the current round's bets (and runs the close). */
async function toBettingEnd(instance: Instance) {
  const view = await instance.round((v) => v.phase === "betting");
  await h.advance(
    new Date(view.bettingEndsAt).getTime() - h.clock.now().getTime(),
  );
  return view.round;
}

describe("rounds", () => {
  it("spins a full round: bets, close, reveal, payouts, the next round", async () => {
    await h.advance(0);
    const first = await a.round((view) => view.phase === "betting");
    const player = await a.connect();
    expect(player.ready.player.balance).toBe(OPENING_BALANCE);
    expect(player.ready.table).toMatchObject({
      minBet: 10,
      maxBet: 100_000,
      betsPerRound: 3,
      payoutLimitPerColor: 1_000_000,
      multipliers: { red: 2, black: 2, green: 14 },
    });
    expect(player.ready.round?.round).toBe(first.round);

    const number = await h.fair.numberOf(first.round);
    const winning = colorOf(number);
    const losing = winning === "red" ? "black" : "red";
    const win = await player.bet(winning, 100);
    const lose = await player.bet(losing, 50);
    expect(win.ok && lose.ok).toBe(true);
    if (!win.ok || !lose.ok) return;
    expect(lose.message.payload.balance).toBe(OPENING_BALANCE - 150);

    // Everyone sees the bets in the next frames.
    await h.advance(250);
    const withBets = await a.round(
      (view) =>
        view.totals[winning].count === 1 && view.totals[losing].count === 1,
    );
    expect(withBets.totals[winning].top[0]).toMatchObject({
      amount: 100,
      nickname: player.ready.player.nickname,
    });

    await toBettingEnd(a);
    const rolling = await a.round(
      (view) => view.round === first.round && view.phase === "rolling",
    );
    expect(rolling.result?.number).toBe(number);
    expect(new Date(rolling.rollingAt ?? 0).getTime()).toBe(
      new Date(first.bettingEndsAt).getTime() + 1000,
    );

    await h.advance(7000);
    const paid = await player.next(
      "balance",
      (message) => message.payload.round === first.round,
    );
    const payout = 100 * (winning === "green" ? 14 : 2);
    expect(paid.payload).toEqual({
      round: first.round,
      payout,
      balance: OPENING_BALANCE - 150 + payout,
    });
    expect(await h.wallet.balance(player.userId)).toBe(
      OPENING_BALANCE - 150 + payout,
    );

    const recorded = await h
      .db(a)
      .select()
      .from(bets)
      .where(eq(bets.roundId, first.round));
    expect(
      recorded.map((bet) => [bet.color, bet.status, bet.payout]).sort(),
    ).toEqual(
      [
        [winning, "won", payout],
        [losing, "lost", 0],
      ].sort(),
    );

    await h.advance(3000);
    await a.round(
      (view) => view.round === first.round + 1 && view.phase === "betting",
    );
    await player.close();
  });

  it("opens the socket only with a fresh ticket from an allowed origin", async () => {
    const userId = crypto.randomUUID();
    const url = (ticket: string) =>
      `ws://127.0.0.1:${a.port}/ws?ticket=${encodeURIComponent(ticket)}`;
    await expect(TestSocket.open(url("x".repeat(43)), ORIGIN)).rejects.toThrow(
      "HTTP 401",
    );
    await expect(
      TestSocket.open(url(await a.ticketFor(userId)), "https://evil.test"),
    ).rejects.toThrow("HTTP 403");
    const ticket = await a.ticketFor(userId);
    const socket = await TestSocket.open(url(ticket), ORIGIN);
    await socket.next("session.ready");
    // Single use: the same ticket does not open a second socket.
    await expect(TestSocket.open(url(ticket), ORIGIN)).rejects.toThrow(
      "HTTP 401",
    );
    socket.sendRaw("not json");
    expect(
      (await socket.next("error", (m) => m.payload.code === "bad_message"))
        .payload.ref,
    ).toBeNull();
    const ref = socket.send("bet.place", { color: "blue", amount: 10 });
    expect((await socket.answer(ref)).ok).toBe(false);
    await socket.close();
  });

  it("publishes what /fair needs to check a round without trusting us", async () => {
    const history = await a.http().get("/v1/rounds").expect(200);
    const [last] = history.body.items as { round: number; number: number }[];
    expect(last).toBeDefined();
    if (!last) return;
    const fair = await a.http().get(`/v1/rounds/${last.round}`).expect(200);
    expect(fair.body.phase).toBe("settled");
    expect(fair.body.commit).toBe(h.fair.commit);
    expect(await verifyLink(fair.body.previousSeed, fair.body.seed)).toBe(true);
    expect(await roll(fair.body.seed, fair.body.publicSeed, last.round)).toBe(
      last.number,
    );
    const info = await a.http().get("/v1/fair").expect(200);
    expect(info.body).toMatchObject({
      commit: h.fair.commit,
      publicSeed: h.fair.publicSeed,
    });
    await a.http().get("/v1/rounds/999999").expect(404);
  });

  it("survives the leader dying mid-round, and the old leader changes nothing when it wakes", async () => {
    const b = await h.boot("b");
    expect(a.driver.isLeader).toBe(true);
    expect(b.driver.isLeader).toBe(false);
    const view = await a.round((v) => v.phase === "betting");
    const player = await b.connect();
    const before = await h.wallet.balance(player.userId);
    const number = await h.fair.numberOf(view.round);
    const color = colorOf(number);
    const placed = await player.bet(color, 200);
    expect(placed.ok).toBe(true);

    // Mid-round, A stops (a pause, a frozen VM): its timers stop, the lease runs out.
    await h.advance(5000);
    h.scheduler.freeze("a");
    await h.valkey.del("roulette:leader");
    await h.advance(1000);
    expect(b.driver.isLeader).toBe(true);

    // B finishes the round from the record: close, reveal, payouts.
    await toBettingEnd(b);
    await h.advance(7000);
    const settled = await b.round(
      (v) => v.round === view.round && v.phase === "settled",
    );
    expect(settled.result?.number).toBe(number);
    const payout = 200 * (color === "green" ? 14 : 2);
    expect(await h.wallet.balance(player.userId)).toBe(before - 200 + payout);

    // A wakes up with its old picture of the round and tries to settle it again.
    const stale = {
      ...(await a.app.get(RoundRepository).find(view.round)),
      status: "rolling",
    } as Parameters<SettlementService["settle"]>[0];
    const creditsBefore = h.wallet.creditCalls.length;
    expect(await a.app.get(SettlementService).settle(stale)).toBe(false);
    // The round is no longer rolling: nothing goes to the wallet again.
    expect(h.wallet.creditCalls.length).toBe(creditsBefore);
    expect(await h.wallet.balance(player.userId)).toBe(before - 200 + payout);
    const [row] = await h
      .db(b)
      .select()
      .from(rounds)
      .where(eq(rounds.id, view.round));
    expect(row?.status).toBe("settled");
    expect(row?.paidOut).toBe(payout);

    // Its next lease check finds B holding it: A stands down.
    await a.driver.renewLease();
    expect(a.driver.isLeader).toBe(false);
    // The bet B's player placed was never rolled back on the way.
    if (placed.ok)
      expect(h.wallet.rollbacks).not.toContain(
        betRef(placed.message.payload.bet.betId),
      );
    await player.close();
  });
});
