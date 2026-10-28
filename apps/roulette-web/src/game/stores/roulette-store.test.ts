import { describe, expect, it } from "vitest";
import {
  FakeSender,
  NICKNAME,
  ownBet,
  roundView,
  sessionReady,
} from "../testing/fakes";
import { DEFAULT_AMOUNT, RouletteStore } from "./roulette-store";

function readyStore() {
  const socket = new FakeSender();
  let n = 0;
  const store = new RouletteStore({
    socket,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  store.start();
  socket.setStatus("ready");
  socket.deliver(sessionReady());
  return { socket, store };
}

describe("RouletteStore", () => {
  it("takes the session: player, table, round and history", () => {
    const { store } = readyStore();
    expect(store.player).toEqual({ nickname: NICKNAME, balance: 1000 });
    expect(store.table?.minBet).toBe(10);
    expect(store.round?.round).toBe(7);
    expect(store.history.map((item) => item.round)).toEqual([6]);
    expect(store.amount).toBe(DEFAULT_AMOUNT);
    expect(store.canBet).toBe(true);
  });

  it("sends a bet with a fresh clientBetId per click and shows it once accepted", () => {
    const { socket, store } = readyStore();
    store.placeBet("red");
    store.placeBet("red");
    expect(socket.sent.map((message) => message.payload)).toEqual([
      {
        clientBetId: "00000000-0000-4000-8000-000000000001",
        color: "red",
        amount: 100,
      },
      {
        clientBetId: "00000000-0000-4000-8000-000000000002",
        color: "red",
        amount: 100,
      },
    ]);
    socket.deliver({
      type: "bet.accepted",
      ref: 1,
      payload: { bet: ownBet(), balance: 900 },
    });
    expect(store.balance).toBe(900);
    expect(store.betsOn("red")).toHaveLength(1);
    expect(store.notice).toEqual({
      kind: "accepted",
      color: "red",
      amount: 100,
    });
    expect(store.pending.has(1)).toBe(false);
    expect(store.pending.has(2)).toBe(true);
  });

  it("refuses locally what the server would refuse", () => {
    const { socket, store } = readyStore();
    store.setAmountText("5");
    store.placeBet("green");
    expect(store.notice).toEqual({ kind: "refused", code: "bet_too_small" });
    store.setAmountText("2 000");
    store.placeBet("green");
    expect(store.notice).toEqual({
      kind: "refused",
      code: "insufficient_funds",
    });
    expect(socket.sent).toHaveLength(0);
  });

  it("does not bet outside the betting phase or without a session", () => {
    const { socket, store } = readyStore();
    socket.deliver({
      type: "round.state",
      payload: { round: roundView({ phase: "locked" }) },
    });
    store.placeBet("black");
    expect(store.notice).toEqual({ kind: "refused", code: "round_closed" });
    socket.setStatus("reconnecting");
    store.placeBet("black");
    expect(store.notice).toEqual({ kind: "refused", code: "not_connected" });
    expect(socket.sent).toHaveLength(0);
  });

  it("stops at three bets a round, counting bets still in flight", () => {
    const { socket, store } = readyStore();
    store.placeBet("red");
    store.placeBet("black");
    store.placeBet("green");
    store.placeBet("red");
    expect(socket.sent).toHaveLength(3);
    expect(store.notice).toEqual({ kind: "refused", code: "too_many_bets" });
  });

  it("shows a server refusal and frees the place it held", () => {
    const { socket, store } = readyStore();
    store.placeBet("red");
    socket.deliver({
      type: "error",
      ref: 1,
      payload: { code: "table_limit", ref: 1 },
    });
    expect(store.notice).toEqual({ kind: "refused", code: "table_limit" });
    expect(store.pending.size).toBe(0);
  });

  it("adds a settled round to the history once, and forgets your bets on the next round", () => {
    const { socket, store } = readyStore();
    socket.deliver({
      type: "bet.accepted",
      ref: 1,
      payload: { bet: ownBet(), balance: 900 },
    });
    const settled = roundView({
      phase: "settled",
      result: { number: 3, color: "red", seed: "a".repeat(64) },
    });
    socket.deliver({ type: "round.state", payload: { round: settled } });
    socket.deliver({ type: "round.state", payload: { round: settled } });
    expect(store.history.map((item) => item.number)).toEqual([3, 8]);
    expect(store.betsOn("red")).toHaveLength(1);

    socket.deliver({
      type: "balance",
      payload: { balance: 1100, round: 7, payout: 200 },
    });
    expect(store.balance).toBe(1100);
    expect(store.notice).toEqual({ kind: "won", payout: 200 });

    socket.deliver({
      type: "round.state",
      payload: { round: roundView({ round: 8 }) },
    });
    expect(store.myBets).toEqual([]);
    expect(store.notice).toEqual({ kind: "hint" });
  });

  it("spins from the last result to the new one, then rests on it", () => {
    const { socket, store } = readyStore();
    expect(store.spin).toBeNull();
    expect(store.rest).toEqual({ number: 8, seed: undefined });
    const seed = "c".repeat(64);
    const rolling = roundView({
      phase: "rolling",
      rollingAt: "2026-10-28T10:00:21.000Z",
      result: { number: 0, color: "green", seed },
    });
    socket.deliver({ type: "round.state", payload: { round: rolling } });
    expect(store.spin).toEqual({
      from: { number: 8, seed: undefined },
      to: { number: 0, seed },
      startAt: Date.parse("2026-10-28T10:00:21.000Z"),
      durationMs: 6000,
      mega: false,
    });
    socket.deliver({
      type: "round.state",
      payload: { round: { ...rolling, phase: "settled" } },
    });
    socket.deliver({
      type: "round.state",
      payload: { round: roundView({ round: 8 }) },
    });
    expect(store.spin).toBeNull();
    expect(store.rest).toEqual({ number: 0, seed });
  });

  it("keeps the known balance when the game cannot say, and asks the wallet", async () => {
    const socket = new FakeSender();
    let reads = 0;
    const store = new RouletteStore({
      socket,
      player: { nickname: NICKNAME, balance: 500 },
      readWallet: async () => {
        reads += 1;
        return reads === 1 ? null : 730;
      },
    });
    store.start();
    socket.setStatus("ready");
    socket.deliver(
      sessionReady({ player: { nickname: NICKNAME, balance: null } }),
    );
    expect(store.balance).toBe(500);
    await Promise.resolve();
    // The wallet had no figure either: still 500.
    expect(store.balance).toBe(500);
    socket.deliver({
      type: "balance",
      payload: { balance: null, round: 7, payout: 140 },
    });
    expect(store.notice).toEqual({ kind: "won", payout: 140 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.balance).toBe(730);
    expect(reads).toBe(2);
  });

  it("lets the server judge a bet while the balance is unknown", () => {
    const socket = new FakeSender();
    const store = new RouletteStore({ socket });
    store.start();
    socket.setStatus("ready");
    socket.deliver(
      sessionReady({ player: { nickname: NICKNAME, balance: null } }),
    );
    store.setAmountText("5000");
    store.placeBet("black");
    expect(socket.sent).toHaveLength(1);
  });

  it("does not bet while the operator pauses bets, and a voided round never spins", () => {
    const { socket, store } = readyStore();
    socket.deliver({
      type: "round.state",
      payload: {
        round: roundView({ table: { paused: true, maintenance: false } }),
      },
    });
    expect(store.canBet).toBe(false);
    store.placeBet("red");
    expect(store.notice).toEqual({ kind: "refused", code: "bets_paused" });
    expect(socket.sent).toHaveLength(0);
    socket.deliver({
      type: "round.state",
      payload: {
        round: roundView({
          phase: "voided",
          rollingAt: "2026-10-28T10:00:21.000Z",
          result: { number: 0, color: "green", seed: "d".repeat(64) },
        }),
      },
    });
    expect(store.spin).toBeNull();
    expect(store.history.map((item) => item.round)).toEqual([6]);
  });

  it("never steps back to an older round", () => {
    const { socket, store } = readyStore();
    socket.deliver({
      type: "round.state",
      payload: { round: roundView({ round: 8 }) },
    });
    socket.deliver({
      type: "round.state",
      payload: { round: roundView({ round: 7, phase: "settled" }) },
    });
    expect(store.round?.round).toBe(8);
  });

  it("drives the amount with the quick buttons", () => {
    const { store } = readyStore();
    store.quick("clear");
    store.quick("add1000");
    store.quick("add100");
    store.quick("half");
    expect(store.amount).toBe(550);
    store.quick("max");
    expect(store.amount).toBe(1000);
  });

  it("keeps the clock offset from the best pong", () => {
    const { store } = readyStore();
    store.clock.syncPong(1000, new Date(5_000).toISOString(), 1100);
    expect(store.clock.offsetMs).toBe(5_000 - 1050);
    // A slower round trip is a worse estimate and is ignored.
    store.clock.syncPong(2000, new Date(9_000).toISOString(), 2500);
    expect(store.clock.offsetMs).toBe(5_000 - 1050);
  });
});
