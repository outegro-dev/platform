import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEBIT_TIMEOUT_MS } from "./bets/bet.service.js";
import { bets } from "./db/schema.js";
import { betIdOf, betRef } from "./domain/ids.js";
import { CLOSE_GRACE_MS } from "./rounds/round.engine.js";
import {
  type Harness,
  type Instance,
  OPENING_BALANCE,
  startHarness,
} from "./test/harness.js";

let h: Harness;
let a: Instance;

beforeAll(async () => {
  // A low payout limit, so a few opening balances reach it.
  h = await startHarness({ env: { ROULETTE_PAYOUT_LIMIT_PER_COLOR: "20000" } });
  a = await h.boot("a");
  await h.advance(0);
});

afterAll(async () => {
  await h?.stop();
});

/** The round taking bets now, after moving on to a fresh one. */
async function freshRound() {
  const current = await a.round(() => true);
  if (
    current.phase === "betting" &&
    h.clock.now().getTime() < new Date(current.bettingEndsAt).getTime() - 15_000
  )
    return current;
  // Run the current round out and open the next one.
  for (;;) {
    await h.advance(1000);
    const view = await a.round(() => true);
    if (view.round > current.round && view.phase === "betting") return view;
  }
}

/** Moves time to the end of the current round's bets; the close runs inside. */
async function advanceToClose(round: { bettingEndsAt: string }) {
  await h.advance(
    new Date(round.bettingEndsAt).getTime() - h.clock.now().getTime(),
  );
}

async function recordedBets(roundId: number) {
  return h.db(a).select().from(bets).where(eq(bets.roundId, roundId));
}

describe("bets", () => {
  it("keeps the table limits", async () => {
    await freshRound();
    const player = await a.connect();
    expect(await player.bet("red", 9)).toEqual({
      ok: false,
      code: "bet_too_small",
    });
    expect(await player.bet("red", 100_001)).toEqual({
      ok: false,
      code: "bet_too_large",
    });
    for (const amount of [10, 20, 30])
      expect((await player.bet("black", amount)).ok).toBe(true);
    expect(await player.bet("black", 10)).toEqual({
      ok: false,
      code: "too_many_bets",
    });

    // Green pays ×14: 1 000 + 1 000 would owe 28 000 against a 20 000 limit.
    const first = await a.connect();
    const second = await a.connect();
    expect((await first.bet("green", 1000)).ok).toBe(true);
    expect(await second.bet("green", 1000)).toEqual({
      ok: false,
      code: "table_limit",
    });
    // The refusal gave nothing away and took nothing.
    expect(await h.wallet.balance(second.userId)).toBe(OPENING_BALANCE);
    expect(await second.bet("green", 400)).toMatchObject({ ok: true });

    expect(await second.bet("red", 1000)).toEqual({
      ok: false,
      code: "insufficient_funds",
    });
    for (const socket of [player, first, second]) await socket.close();
  });

  it("turns a double click into one bet and one debit", async () => {
    const round = await freshRound();
    const player = await a.connect();
    const clientBetId = randomUUID();
    const one = player.send("bet.place", {
      clientBetId,
      color: "red",
      amount: 100,
    });
    const two = player.send("bet.place", {
      clientBetId,
      color: "red",
      amount: 100,
    });
    const [first, second] = await Promise.all([
      player.answer(one),
      player.answer(two),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.message.payload.bet.betId).toBe(
      first.message.payload.bet.betId,
    );
    expect(second.message.payload.balance).toBe(OPENING_BALANCE - 100);
    expect(await h.wallet.balance(player.userId)).toBe(OPENING_BALANCE - 100);

    // The same click from a second tab while the first debit is still in flight.
    const tab = await a.connect(player.userId);
    const retryId = randomUUID();
    const gate = h.wallet.holdNextDebit();
    const fromFirst = player.send("bet.place", {
      clientBetId: retryId,
      color: "black",
      amount: 50,
    });
    await gate.reached;
    const fromTab = tab.send("bet.place", {
      clientBetId: retryId,
      color: "black",
      amount: 50,
    });
    setTimeout(gate.release, 100);
    const [a1, a2] = await Promise.all([
      player.answer(fromFirst),
      tab.answer(fromTab),
    ]);
    expect(a1.ok && a2.ok).toBe(true);
    expect(await h.wallet.balance(player.userId)).toBe(OPENING_BALANCE - 150);

    const rows = await recordedBets(round.round);
    expect(rows.filter((bet) => bet.userId === player.userId)).toHaveLength(2);
    await h.advance(250);
    const view = await a.round(
      (v) => v.round === round.round && v.totals.black.count >= 1,
    );
    expect(
      view.totals.red.count + view.totals.black.count,
    ).toBeGreaterThanOrEqual(2);
    await player.close();
    await tab.close();
  });

  it("accepts a bet whose debit finishes inside the close's grace", async () => {
    const round = await freshRound();
    const player = await a.connect();
    const gate = h.wallet.holdNextDebit();
    const ref = player.send("bet.place", {
      clientBetId: randomUUID(),
      color: "green",
      amount: 10,
    });
    await gate.reached;
    // The close stops new bets at once and waits for this one.
    setTimeout(gate.release, 150);
    await advanceToClose(round);
    const answer = await player.answer(ref);
    expect(answer.ok).toBe(true);
    expect(
      (await recordedBets(round.round)).map((bet) => bet.userId),
    ).toContain(player.userId);
    expect(await h.wallet.balance(player.userId)).toBe(OPENING_BALANCE - 10);

    // After the stop a bet is refused without touching the wallet.
    const late = await player.bet("red", 10);
    expect(late).toEqual({ ok: false, code: "round_closed" });
    expect(await h.wallet.balance(player.userId)).toBe(OPENING_BALANCE - 10);
    await player.close();
  });

  it("rolls back a debit that hangs past the close", async () => {
    const round = await freshRound();
    const player = await a.connect();
    const gate = h.wallet.holdNextDebit();
    const clientBetId = randomUUID();
    const ref = player.send("bet.place", {
      clientBetId,
      color: "red",
      amount: 300,
    });
    await gate.reached;
    const started = performance.now();
    await advanceToClose(round);
    // The close waited out its grace, closed the record and rolled the debit back.
    expect(performance.now() - started).toBeGreaterThanOrEqual(
      CLOSE_GRACE_MS - 50,
    );
    const betId = betIdOf(player.userId, clientBetId);
    expect(h.wallet.rollbacks).toContain(betRef(betId));

    // The wallet answers at last: the tombstone turns the late debit away.
    // On a loaded runner the close can outlast the debit timeout; then the
    // timeout refuses the bet first and rolls it back the same way.
    const heldMs = performance.now() - started;
    gate.release();
    const answer = await player.answer(ref);
    if (heldMs < DEBIT_TIMEOUT_MS - 200)
      expect(answer).toEqual({ ok: false, code: "round_closed" });
    else
      expect(answer).toEqual({
        ok: false,
        code: expect.stringMatching(/^(round_closed|wallet_unavailable)$/),
      });
    expect(await h.wallet.balance(player.userId)).toBe(OPENING_BALANCE);
    expect(
      (await recordedBets(round.round)).map((bet) => bet.id),
    ).not.toContain(betId);
    await player.close();
  });

  it("keeps bets, debits and the record in step when bets race the close", async () => {
    const round = await freshRound();
    const players = await Promise.all(
      Array.from({ length: 12 }, () => a.connect()),
    );
    // Move to just before the end, then fire every bet while the close runs.
    await h.advance(
      new Date(round.bettingEndsAt).getTime() - h.clock.now().getTime() - 1,
    );
    const refs = players.map((player, i) =>
      player.send("bet.place", {
        clientBetId: randomUUID(),
        color: i % 3 === 0 ? "green" : i % 2 ? "red" : "black",
        amount: 10 + i,
      }),
    );
    await h.advance(1);
    const answers = await Promise.all(
      players.map((player, i) => player.answer(refs[i] ?? 0)),
    );
    await h.advance(1500);

    const recorded = new Map(
      (await recordedBets(round.round)).map((bet) => [bet.userId, bet]),
    );
    for (const [i, player] of players.entries()) {
      const answer = answers[i];
      const balance = await h.wallet.balance(player.userId);
      if (answer?.ok) {
        expect(recorded.get(player.userId)?.amount).toBe(10 + i);
        expect(balance).toBe(OPENING_BALANCE - (10 + i));
      } else {
        expect(answer?.code).toBe("round_closed");
        expect(recorded.has(player.userId)).toBe(false);
        expect(balance).toBe(OPENING_BALANCE);
      }
    }
    for (const player of players) await player.close();
  });
});
