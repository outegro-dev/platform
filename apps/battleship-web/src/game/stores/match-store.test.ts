import { matchAbortReasonSchema } from "@outegro/contracts/battleship";
import { autorun } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MATCH_ID, server, snapshot } from "../testing/fakes";
import type { MessageSender } from "../transport/game-socket";
import { AnimationQueue } from "./animation-queue";
import { Clock } from "./clock";
import { MatchStore, timing } from "./match-store";
import { PlacementStore } from "./placement-store";
import { PreferencesStore } from "./preferences-store";

function setup(options: { online?: boolean; reduced?: boolean } = {}) {
  const sent: { type: string; seq: number; payload: unknown }[] = [];
  let seq = 0;
  const sender: MessageSender = {
    send: vi.fn((type, payload) => {
      seq++;
      sent.push({ type, seq, payload });
      return seq;
    }),
  };
  const clock = new Clock();
  const queue = new AnimationQueue();
  const preferences = new PreferencesStore();
  preferences.setReducedMotion(options.reduced ?? false);
  const placement = new PlacementStore(sender);
  const connection = { online: options.online ?? true };
  const sound = { play: vi.fn() };
  const match = new MatchStore({
    sender,
    clock,
    queue,
    preferences,
    placement,
    connection,
    sound,
  });
  return { match, sent, clock, queue, placement, sound, connection };
}

const deadline = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MatchStore", () => {
  it("takes the whole match from a snapshot", () => {
    const { match, placement } = setup();
    match.handle(server("match.state", { match: snapshot({ moves: 4 }) }));
    expect(match.matchId).toBe(MATCH_ID);
    expect(match.phase).toBe("battle");
    expect(match.isYourTurn).toBe(true);
    expect(match.ownShips).toHaveLength(10);
    expect(match.moves).toBe(4);
    expect(placement.submitted).toBe(true);
  });

  it("marks a hit, keeps the turn, and animates before the next shot is allowed", async () => {
    const { match, sent } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    expect(match.fire(3, 4)).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      type: "shot.fire",
      payload: { x: 3, y: 4 },
    });
    expect(match.canFire).toBe(false);

    match.handle(
      server("shot.result", {
        by: "you",
        x: 3,
        y: 4,
        outcome: "hit",
        revealed: [],
        nextTurn: "you",
        deadline: null,
      }),
    );
    expect(match.pendingShot).toBeNull();
    // The tracer is still flying: the result lands after it.
    expect(match.targetCells[4]?.[3]).toBe("unknown");
    await vi.advanceTimersByTimeAsync(timing.tracer);
    expect(match.targetCells[4]?.[3]).toBe("hit");
    expect(match.canFire).toBe(false);
    await vi.advanceTimersByTimeAsync(timing.impact);
    expect(match.canFire).toBe(true);
    expect(match.turn).toBe("you");
  });

  it("refuses a second shot while the first is pending (no double fire)", () => {
    const { match, sent } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    expect(match.fire(0, 0)).toBe(true);
    expect(match.fire(1, 1)).toBe(false);
    expect(match.fire(0, 0)).toBe(false);
    expect(sent.filter((m) => m.type === "shot.fire")).toHaveLength(1);
  });

  it("refuses shots out of turn, offline and at known cells", () => {
    const { match, connection } = setup({ online: false });
    match.handle(server("match.state", { match: snapshot() }));
    expect(match.fire(0, 0)).toBe(false);
    connection.online = true;
    match.handle(
      server("match.state", {
        match: snapshot({
          target: {
            size: 10,
            cells: Array.from({ length: 10 }, (_, y) =>
              Array.from({ length: 10 }, (_, x) =>
                x === 0 && y === 0 ? "miss" : "unknown",
              ),
            ),
            sunkShips: [],
            remaining: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
          },
        }),
      }),
    );
    expect(match.fire(0, 0)).toBe(false);
    match.handle(
      server("match.state", { match: snapshot({ turn: "opponent" }) }),
    );
    expect(match.fire(5, 5)).toBe(false);
  });

  it("clears the guard and resyncs when the server rejects the shot", () => {
    const { match, sent } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    match.fire(2, 2);
    const seq = sent.at(-1)?.seq ?? 0;
    match.handle(server("error", { code: "not_your_turn", ref: seq }));
    expect(match.pendingShot).toBeNull();
    expect(match.notice).toEqual({ kind: "rejected", code: "not_your_turn" });
    expect(sent.at(-1)?.type).toBe("match.sync");
  });

  it("sinks a ship: reveals it, marks the water around it and updates the fleet left", async () => {
    const { match } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    match.handle(
      server("shot.result", {
        by: "you",
        x: 9,
        y: 9,
        outcome: "sunk",
        ship: { x: 9, y: 9, length: 1, orientation: "horizontal" },
        revealed: [
          { x: 8, y: 8 },
          { x: 9, y: 8 },
          { x: 8, y: 9 },
        ],
        nextTurn: "you",
        deadline: null,
      }),
    );
    await vi.runAllTimersAsync();
    expect(match.targetCells[9]?.[9]).toBe("sunk");
    expect(match.targetCells[8]?.[8]).toBe("miss");
    expect(match.sunkShips).toHaveLength(1);
    expect(match.remaining).toEqual([4, 3, 3, 2, 2, 2, 1, 1, 1]);
  });

  it("plays fast opponent shots one after another, in order", async () => {
    const { match } = setup();
    match.handle(
      server("match.state", { match: snapshot({ turn: "opponent" }) }),
    );
    const shot = (
      x: number,
      outcome: "hit" | "sunk" | "miss",
      nextTurn: "you" | "opponent",
    ) =>
      server("shot.result", {
        by: "opponent",
        x,
        y: 0,
        outcome,
        revealed: [],
        nextTurn,
        deadline: null,
      });
    match.handle(shot(0, "hit", "opponent"));
    match.handle(shot(1, "hit", "opponent"));
    match.handle(shot(5, "miss", "you"));

    const seen: string[] = [];
    const stop = autorun(() => {
      seen.push(match.ownShots[0]?.slice(0, 6).join(",") ?? "");
    });
    await vi.advanceTimersByTimeAsync(timing.tracer);
    expect(match.ownShots[0]?.[0]).toBe("hit");
    expect(match.ownShots[0]?.[1]).toBe("unknown");
    await vi.advanceTimersByTimeAsync(timing.impact + timing.tracer);
    expect(match.ownShots[0]?.[1]).toBe("hit");
    expect(match.turn).toBe("opponent");
    await vi.runAllTimersAsync();
    expect(match.ownShots[0]?.[5]).toBe("miss");
    expect(match.turn).toBe("you");
    expect(match.ownShips[0]?.hits).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    // Each shot became visible on its own.
    expect(new Set(seen).size).toBeGreaterThanOrEqual(4);
    stop();
  });

  it("a snapshot drops queued events and replaces the board", async () => {
    const { match } = setup();
    match.handle(
      server("match.state", { match: snapshot({ turn: "opponent" }) }),
    );
    match.handle(
      server("shot.result", {
        by: "opponent",
        x: 0,
        y: 0,
        outcome: "hit",
        revealed: [],
        nextTurn: "opponent",
        deadline: null,
      }),
    );
    match.handle(
      server("match.state", { match: snapshot({ turn: "you", moves: 9 }) }),
    );
    await vi.runAllTimersAsync();
    expect(match.ownShots[0]?.[0]).toBe("unknown");
    expect(match.turn).toBe("you");
    expect(match.moves).toBe(9);
  });

  it("counts down to the server deadline, corrected by the clock offset", () => {
    const { match, clock } = setup();
    // The server clock runs 5 s ahead of this browser.
    clock.sync(new Date(Date.now() + 5000).toISOString());
    match.handle(
      server("match.state", {
        match: snapshot({
          deadline: new Date(Date.now() + 5000 + 30_000).toISOString(),
        }),
      }),
    );
    const seconds: (number | null)[] = [];
    const stop = autorun(() => seconds.push(match.secondsLeft));
    expect(match.secondsLeft).toBe(30);
    vi.advanceTimersByTime(10_000);
    expect(match.secondsLeft).toBe(20);
    stop();
    expect(seconds).toContain(25);
  });

  it("shows the opponent's absence with the time they have left", () => {
    const { match } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    match.handle(
      server("opponent.presence", {
        connected: false,
        graceUntil: deadline(60_000),
      }),
    );
    expect(match.opponentConnected).toBe(false);
    expect(match.graceSecondsLeft).toBe(60);
    match.handle(
      server("opponent.presence", { connected: true, graceUntil: null }),
    );
    expect(match.opponentConnected).toBe(true);
    expect(match.graceSecondsLeft).toBeNull();
  });

  it("finishes with the winner, the rating change and the revealed fleet", async () => {
    const { match, sound } = setup();
    match.handle(
      server("match.state", {
        match: snapshot({ mode: "quick", rated: true }),
      }),
    );
    match.handle(
      server("match.finished", {
        winner: "you",
        reason: "fleet_destroyed",
        rating: { before: 1000, after: 1016, delta: 16 },
        opponentFleet: [{ x: 0, y: 0, length: 4, orientation: "horizontal" }],
      }),
    );
    await vi.runAllTimersAsync();
    expect(match.finished).toBe(true);
    expect(match.won).toBe(true);
    expect(match.rating?.delta).toBe(16);
    expect(match.opponentFleet).toHaveLength(1);
    expect(sound.play).toHaveBeenCalledWith("win");
  });

  describe("a fleet not deployed in time is not three missed turns", () => {
    const placing = () =>
      snapshot({
        mode: "quick",
        rated: true,
        phase: "placement",
        opponent: {
          kind: "human",
          nickname: "Nemo",
          rating: 1512,
          premium: true,
        },
        turn: null,
        deadline: deadline(90_000),
        own: null,
        target: null,
        yourFleetPlaced: false,
        opponentFleetPlaced: false,
      });
    const ended = (
      winner: "you" | "opponent",
      reason: "timeout" | "resigned" = "timeout",
    ) =>
      server("match.finished", {
        winner,
        reason,
        rating:
          winner === "you"
            ? { before: 1000, after: 1016, delta: 16 }
            : { before: 1000, after: 984, delta: -16 },
        opponentFleet: [],
      });

    it("the opponent's fleet is missing: they did not deploy in time", async () => {
      const { match } = setup();
      match.handle(server("match.state", { match: placing() }));
      match.handle(server("fleet.placed", { side: "you" }));
      match.handle(ended("you"));
      await vi.runAllTimersAsync();
      expect(match.reason).toBe("timeout");
      expect(match.resultReason).toBe("deploy_timeout");
    });

    it("your fleet is missing: you did not deploy in time", async () => {
      const { match } = setup();
      match.handle(server("match.state", { match: placing() }));
      match.handle(server("fleet.placed", { side: "opponent" }));
      match.handle(ended("opponent"));
      await vi.runAllTimersAsync();
      expect(match.won).toBe(false);
      expect(match.resultReason).toBe("deploy_timeout");
    });

    it("in battle both fleets are down: the turns ran out", async () => {
      const { match } = setup();
      match.handle(server("match.state", { match: snapshot() }));
      match.handle(ended("opponent"));
      await vi.runAllTimersAsync();
      expect(match.resultReason).toBe("timeout");
    });

    it("a finished snapshot (after a reconnect) tells them apart too", () => {
      const { match } = setup();
      const finished = {
        phase: "finished",
        turn: null,
        winner: "opponent",
        reason: "timeout",
      } as const;
      match.handle(
        server("match.state", {
          match: snapshot({ ...finished, own: null, yourFleetPlaced: false }),
        }),
      );
      expect(match.resultReason).toBe("deploy_timeout");
      match.handle(server("match.state", { match: snapshot(finished) }));
      expect(match.resultReason).toBe("timeout");
    });

    it("any other end while placing keeps its own reason", async () => {
      const { match } = setup();
      match.handle(server("match.state", { match: placing() }));
      expect(match.resultReason).toBeNull();
      match.handle(ended("opponent", "resigned"));
      await vi.runAllTimersAsync();
      expect(match.resultReason).toBe("resigned");
    });
  });

  it.each(matchAbortReasonSchema.options)(
    "ends without a result when the match is aborted (%s)",
    async (reason) => {
      const { match } = setup();
      match.handle(
        server("match.state", {
          match: snapshot({ phase: "placement", turn: null }),
        }),
      );
      match.handle(server("match.aborted", { reason }));
      await vi.runAllTimersAsync();
      expect(match.active).toBe(false);
      expect(match.finished).toBe(true);
      expect(match.aborted).toBe(reason);
      expect(match.won).toBeNull();
      expect(match.rating).toBeNull();
    },
  );

  it("a battle both players left ends cancelled, even right after a snapshot", async () => {
    const { match } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    match.handle(server("match.aborted", { reason: "abandoned" }));
    await vi.runAllTimersAsync();
    expect(match.phase).toBe("finished");
    expect(match.aborted).toBe("abandoned");
    expect(match.turn).toBeNull();
    expect(match.deadline).toBeNull();
    expect(match.canFire).toBe(false);
  });

  it("reads a finished snapshot without a winner as cancelled", () => {
    const { match } = setup();
    match.handle(
      server("match.state", {
        match: snapshot({
          phase: "finished",
          turn: null,
          winner: null,
          reason: null,
        }),
      }),
    );
    expect(match.aborted).toBe("unknown");
    expect(match.active).toBe(false);
  });

  it("shows the fleet the server accepted in your waters", async () => {
    const { match, placement } = setup();
    match.handle(
      server("match.state", {
        match: snapshot({
          phase: "placement",
          turn: null,
          own: null,
          target: null,
          yourFleetPlaced: false,
          opponentFleetPlaced: false,
        }),
      }),
    );
    placement.randomize();
    placement.submit();
    placement.handle(server("fleet.placed", { side: "you" }));
    match.handle(server("fleet.placed", { side: "you" }));
    await vi.runAllTimersAsync();
    expect(match.ownShips).toHaveLength(10);
    expect(match.ownShips.map((ship) => ship.length).sort()).toEqual(
      [...placement.fleet.map((ship) => ship.length)].sort(),
    );
    expect(match.yourFleetPlaced).toBe(true);
  });

  it("knows when the side on turn shoots again after a hit", async () => {
    const { match } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    expect(match.shootsAgain).toBe(false);
    const shot = (
      by: "you" | "opponent",
      x: number,
      outcome: "hit" | "sunk" | "miss",
      nextTurn: "you" | "opponent",
    ) =>
      server("shot.result", {
        by,
        x,
        y: 9,
        outcome,
        revealed: [],
        nextTurn,
        deadline: null,
      });

    match.handle(shot("you", 0, "hit", "you"));
    await vi.runAllTimersAsync();
    expect(match.shootsAgain).toBe(true);
    expect(match.lastShot).toMatchObject({ by: "you", outcome: "hit" });

    match.handle(shot("you", 1, "miss", "opponent"));
    await vi.runAllTimersAsync();
    expect(match.shootsAgain).toBe(false);

    match.handle(shot("opponent", 2, "hit", "opponent"));
    await vi.runAllTimersAsync();
    expect(match.shootsAgain).toBe(true);
    expect(match.turn).toBe("opponent");

    // Their clock ran out: the turn passed, no extra shot for anyone.
    match.handle(
      server("turn.skipped", {
        side: "opponent",
        missedInRow: 1,
        nextTurn: "you",
        deadline: deadline(30_000),
      }),
    );
    await vi.runAllTimersAsync();
    expect(match.shootsAgain).toBe(false);

    match.handle(shot("you", 3, "hit", "you"));
    await vi.runAllTimersAsync();
    expect(match.shootsAgain).toBe(true);
    // A snapshot (reconnect) does not tell how the turn came about.
    match.handle(server("match.state", { match: snapshot() }));
    expect(match.shootsAgain).toBe(false);
  });

  it("notes a skipped turn", async () => {
    const { match } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    match.handle(
      server("turn.skipped", {
        side: "you",
        missedInRow: 1,
        nextTurn: "opponent",
        deadline: deadline(30_000),
      }),
    );
    await vi.runAllTimersAsync();
    expect(match.notice).toEqual({
      kind: "turn_skipped",
      side: "you",
      missedInRow: 1,
    });
    expect(match.turn).toBe("opponent");
  });

  it("with reduced motion events land almost at once", async () => {
    const { match } = setup({ reduced: true });
    match.handle(
      server("match.state", { match: snapshot({ turn: "opponent" }) }),
    );
    match.handle(
      server("shot.result", {
        by: "opponent",
        x: 0,
        y: 0,
        outcome: "miss",
        revealed: [],
        nextTurn: "you",
        deadline: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(160);
    expect(match.ownShots[0]?.[0]).toBe("miss");
    await vi.advanceTimersByTimeAsync(160);
    expect(match.canFire).toBe(true);
  });

  it("knows when the match ended while this tab was away", () => {
    const { match, sent } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    match.sync();
    const seq = sent.at(-1)?.seq ?? 0;
    match.handle(server("error", { code: "no_active_match", ref: seq }));
    expect(match.endedWhileAway).toBe(true);
  });

  it("an answer to the sync of a match already left changes nothing", async () => {
    const { match, sent } = setup();
    match.handle(server("match.state", { match: snapshot() }));
    match.sync();
    const seq = sent.at(-1)?.seq ?? 0;
    match.handle(
      server("match.finished", {
        winner: "you",
        reason: "resigned",
        rating: null,
        opponentFleet: [],
      }),
    );
    await vi.runAllTimersAsync();
    match.leave();
    match.handle(server("error", { code: "no_active_match", ref: seq }));
    expect(match.endedWhileAway).toBe(false);
  });
});
