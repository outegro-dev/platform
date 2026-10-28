import type { AdminLive } from "@outegro/contracts/roulette";
import { describe, expect, it, vi } from "vitest";
import { type LiveAnswer, RouletteLiveStore } from "./roulette-live-store";

const AT = Date.parse("2026-10-28T10:00:00.000Z");
const iso = (at: number) => new Date(at).toISOString();
const colour = { count: 0, sum: 0, top: [] };
const house = { rounds: 0, bets: 0, staked: 0, paidOut: 0, result: 0 };

function liveAt(round: number, bettingEndsAt: number): AdminLive {
  return {
    round: {
      round,
      phase: "betting",
      bettingEndsAt: iso(bettingEndsAt),
      rollingAt: null,
      settleAt: null,
      nextRoundAt: null,
      result: null,
      totals: { red: colour, black: colour, green: colour },
      table: { paused: false, maintenance: false },
    },
    online: 3,
    table: {
      minBet: 10,
      maxBet: 100,
      betsPerRound: 5,
      payoutLimitPerColor: 1000,
      paused: false,
      maintenance: false,
      version: 1,
      updatedAt: iso(AT),
    },
    exposure: { red: 0, black: 0, green: 0 },
    house: { day: house, total: house },
  };
}

/** Timers run by hand: `fire()` runs the one pending callback. */
function manualTimers() {
  let pending: (() => void) | null = null;
  return {
    timers: {
      set: (callback: () => void) => {
        pending = callback;
        return 1;
      },
      clear: () => {
        pending = null;
      },
    },
    get pending() {
      return pending !== null;
    },
    fire() {
      const run = pending;
      pending = null;
      run?.();
    },
  };
}

function setup(answers: LiveAnswer[]) {
  const clock = manualTimers();
  const read = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error("no answer");
    return next;
  });
  const store = new RouletteLiveStore(
    { read, timers: clock.timers, intervalMs: 2500 },
    { data: liveAt(184, AT + 15_000), serverTime: iso(AT) },
    AT,
  );
  return { store, read, clock };
}

describe("the roulette's live table", () => {
  it("counts down on the server's clock, as rendered", () => {
    const { store } = setup([]);
    expect(store.secondsLeft).toBe(15);
    store.tick(AT + 3_200);
    expect(store.secondsLeft).toBe(12);
    store.tick(AT + 60_000);
    expect(store.secondsLeft).toBe(0);
  });

  it("reads again every interval while visible, and takes the server's offset", async () => {
    const { store, read, clock } = setup([
      // The server's clock runs two seconds ahead of the browser's.
      { ok: true, data: liveAt(185, AT + 30_000), serverTime: iso(AT + 7_000) },
    ]);
    store.start();
    expect(clock.pending).toBe(true);
    await store.poll(AT + 5_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.data.round?.round).toBe(185);
    store.tick(AT + 5_000);
    // 30 s on the server's clock, which reads 7 s now.
    expect(store.secondsLeft).toBe(23);
    expect(store.age).toBe(0);
    expect(clock.pending).toBe(true);
  });

  it("keeps the last numbers when a read fails, says how old they are, and tries again", async () => {
    const { store, clock } = setup([
      { ok: false, kind: "unavailable" },
      { ok: true, data: liveAt(186, AT), serverTime: iso(AT + 9_000) },
    ]);
    store.start();
    await store.poll(AT + 2_500);
    expect(store.failure).toBe("unavailable");
    expect(store.stopped).toBe(false);
    expect(store.data.round?.round).toBe(184);
    store.tick(AT + 4_000);
    expect(store.age).toBe(4);
    expect(clock.pending).toBe(true);
    await store.poll(AT + 9_000);
    expect(store.failure).toBeNull();
    expect(store.data.round?.round).toBe(186);
  });

  it("treats a lost answer as unavailable", async () => {
    const { store } = setup([]);
    store.start();
    await store.poll(AT + 2_500);
    expect(store.failure).toBe("unavailable");
  });

  it("stops asking once the session ended or the role no longer allows it", async () => {
    const { store, read, clock } = setup([
      { ok: false, kind: "unauthenticated" },
    ]);
    store.start();
    await store.poll(AT + 2_500);
    expect(store.stopped).toBe(true);
    expect(clock.pending).toBe(false);
    await store.poll(AT + 5_000);
    store.setVisible(true, AT + 6_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("asks nothing while hidden and catches up at once when shown", async () => {
    const answer: LiveAnswer = {
      ok: true,
      data: liveAt(190, AT),
      serverTime: iso(AT + 60_000),
    };
    const { store, read, clock } = setup([answer]);
    store.start();
    store.setVisible(false, AT + 1_000);
    expect(clock.pending).toBe(false);
    expect(read).not.toHaveBeenCalled();
    store.setVisible(true, AT + 60_000);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(store.data.round?.round).toBe(190));
    expect(clock.pending).toBe(true);
    store.stop();
    expect(clock.pending).toBe(false);
  });
});
