import type { MatchSnapshot } from "@outegro/contracts/battleship";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moves } from "./db/schema.js";
import { fleets, type Harness, startHarness } from "./test/harness.js";
import {
  battle,
  type Cell,
  farWater,
  fire,
  room,
  snapshot,
} from "./test/play.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

/** Some cell of the target board not fired at yet. */
function unknownCell(state: MatchSnapshot): Cell {
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++)
      if (state.target?.cells[y]?.[x] === "unknown") return { x, y };
  throw new Error("no unknown cell left");
}

describe("restart recovery", () => {
  it("rebuilds live matches from stored fleets and moves and restarts their clocks", async () => {
    // A bot match waiting for the human (the bot has no turn clock).
    const human = await h.connect();
    human.send("bot.start", { level: "medium" });
    const botMatch = (await human.next("match.state")).payload.match.matchId;
    human.send("fleet.place", { ships: fleets.a });
    let turn = (await human.next("match.started")).payload.turn;
    while (turn !== "you") {
      if (!human.pending("shot.result").length) await h.advance(1_400);
      turn = (await human.next("shot.result")).payload.nextTurn ?? "you";
    }
    const beforeHuman = await snapshot(human);

    // An online match in battle: a hit, misses and a skipped turn.
    const { a, b, matchId } = await room(h);
    const { first, second, firstTargets } = await battle(a, b);
    const ship = firstTargets[0] as Cell;
    await fire(first, second, { x: ship.x, y: ship.y });
    await fire(first, second, farWater(firstTargets)[0] as Cell);
    await h.advance(30_000);
    await first.next("turn.skipped");
    await fire(first, second, farWater(firstTargets)[1] as Cell);
    const beforeA = await snapshot(a);
    const beforeB = await snapshot(b);
    expect(beforeA.moves).toBe(3);

    // Someone waiting in the quick queue.
    const waiting = await h.connect();
    waiting.send("queue.join", { mode: "quick" });
    await waiting.next("queue.joined");

    await h.restart();
    expect((await a.closed).code).toBe(1012);
    expect((await human.closed).code).toBe(1012);

    const a2 = await h.connect(a.userId);
    expect(a2.ready.activeMatchId).toBe(matchId);
    const stateA = (await a2.next("match.state")).payload.match;
    expect({ ...stateA, deadline: null, opponentConnected: true }).toEqual({
      ...beforeA,
      deadline: null,
      opponentConnected: true,
    });
    // A fresh turn window; the opponent is not back yet and has 60 seconds.
    expect(stateA.deadline).toBe(
      new Date(h.clock.now().getTime() + 30_000).toISOString(),
    );
    expect(stateA.opponentConnected).toBe(false);
    expect((await a2.next("opponent.presence")).payload).toEqual({
      connected: false,
      graceUntil: new Date(h.clock.now().getTime() + 60_000).toISOString(),
    });
    expect(a2.received.map((m) => m.type)).toEqual([
      "session.ready",
      "match.state",
      "opponent.presence",
    ]);

    const b2 = await h.connect(b.userId);
    const stateB = (await b2.next("match.state")).payload.match;
    expect({ ...stateB, deadline: null }).toEqual({
      ...beforeB,
      deadline: null,
    });
    expect((await a2.next("opponent.presence")).payload).toEqual({
      connected: true,
      graceUntil: null,
    });

    // Play goes on exactly where it stopped.
    const [shooter, other, view, targets] =
      stateA.turn === "you"
        ? [a2, b2, stateA, fleets.b]
        : [b2, a2, stateB, fleets.a];
    const aim = farWater(targets).find(
      (cell) => view.target?.cells[cell.y]?.[cell.x] === "unknown",
    ) as Cell;
    await fire(shooter, other, aim);
    expect((await snapshot(a2)).moves).toBe(4);
    const stored = await h.db
      .select()
      .from(moves)
      .where(eq(moves.matchId, matchId))
      .orderBy(asc(moves.n));
    expect(stored.map((m) => m.n)).toEqual([1, 2, 3, 4, 5]);
    expect(stored.map((m) => m.outcome)).toEqual([
      "hit",
      "miss",
      "skip",
      "miss",
      "miss",
    ]);

    // The bot match continues, and the bot still answers.
    const human2 = await h.connect(human.userId);
    expect(human2.ready.activeMatchId).toBe(botMatch);
    expect((await human2.next("match.state")).payload.match).toEqual(
      beforeHuman,
    );
    let botView = beforeHuman;
    let next: "you" | "opponent" | null = "you";
    while (next === "you") {
      human2.send("shot.fire", unknownCell(botView));
      next = (await human2.next("shot.result", (m) => m.payload.by === "you"))
        .payload.nextTurn;
      if (next === "you") botView = await snapshot(human2);
    }
    expect(next).toBe("opponent");
    await h.advance(1_400);
    await human2.next("shot.result", (m) => m.payload.by === "opponent");

    // Queue membership belonged to the old process.
    expect((await h.connect(waiting.userId)).ready.queuedSince).toBeNull();
  });

  it("a player who does not come back within 60 seconds of a restart loses", async () => {
    const { a, b } = await room(h);
    await battle(a, b);
    await h.restart();
    const back = await h.connect(a.userId);
    await back.next("match.state");
    await h.advance(60_000);
    expect((await back.next("match.finished")).payload).toMatchObject({
      winner: "you",
      reason: "disconnected",
    });
  });
});
