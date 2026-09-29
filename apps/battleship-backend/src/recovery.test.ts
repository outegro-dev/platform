import type { MatchSnapshot } from "@outegro/contracts/battleship";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matches, moves, outbox, players, ratingHistory } from "./db/schema.js";
import { ConnectionRegistry } from "./realtime/connection.registry.js";
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

  /**
   * a leaves, b leaves 50 s later, and a's grace runs out while b's runs:
   * a's forfeit waits for b when the service restarts.
   */
  async function forfeitWaitingAtRestart() {
    const { a, b, matchId } = await room(h);
    await battle(a, b);
    await a.close();
    await b.next("opponent.presence", (m) => !m.payload.connected);
    await h.advance(50_000);
    await b.close();
    await expect
      .poll(() => h.get(ConnectionRegistry).socketsOf(b.userId))
      .toBe(0);
    await h.advance(10_000);
    const row = async () =>
      (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0];
    expect(await row()).toMatchObject({
      status: "battle",
      pendingForfeit: "a",
    });
    await h.restart();
    return { a, b, matchId, row };
  }

  it("a forfeit waiting at a restart still waits: the late player gets no new grace, and nobody wins if the opponent stays away", async () => {
    const { a, matchId, row } = await forfeitWaitingAtRestart();
    const late = await h.connect(a.userId);
    expect(late.ready.activeMatchId).toBe(matchId);
    // No clock runs while the forfeit waits; the opponent has its 60 seconds.
    const state = (await late.next("match.state")).payload.match;
    expect(state.deadline).toBeNull();
    expect((await late.next("opponent.presence")).payload).toEqual({
      connected: false,
      graceUntil: new Date(h.clock.now().getTime() + 60_000).toISOString(),
    });
    const shot = late.send("shot.fire", { x: 9, y: 9 });
    expect((await late.error(shot)).payload.code).toBe("wrong_phase");
    await h.advance(59_999);
    expect((await row())?.status).toBe("battle");
    await h.advance(1);
    expect((await late.next("match.aborted")).payload.reason).toBe("abandoned");
    expect(await row()).toMatchObject({
      status: "aborted",
      abortReason: "abandoned",
      winner: null,
      pendingForfeit: null,
    });
  });

  it("a forfeit waiting at a restart is decided as soon as the opponent is back", async () => {
    const { b, row } = await forfeitWaitingAtRestart();
    const back = await h.connect(b.userId);
    const state = (await back.next("match.state")).payload.match;
    expect(state).toMatchObject({ phase: "finished", winner: "you" });
    expect((await back.next("match.finished")).payload).toMatchObject({
      winner: "you",
      reason: "disconnected",
    });
    expect(await row()).toMatchObject({
      status: "finished",
      winner: "b",
      reason: "disconnected",
      pendingForfeit: null,
    });
  });

  it("when neither player is back within 60 seconds of a restart, the match is cancelled without a result", async () => {
    const a = await h.connect();
    const b = await h.connect();
    a.send("queue.join", { mode: "quick" });
    await a.next("queue.joined");
    b.send("queue.join", { mode: "quick" });
    const { matchId } = (await a.next("queue.matched")).payload;
    await a.next("match.state");
    await b.next("match.state");
    await battle(a, b);

    await h.restart();
    const row = async () =>
      (await h.db.select().from(matches).where(eq(matches.id, matchId)))[0];
    await h.advance(59_999);
    expect((await row())?.status).toBe("battle");
    // Both graces end at the same instant: no seat decides the result.
    await h.advance(1);
    expect(await row()).toMatchObject({
      status: "aborted",
      abortReason: "abandoned",
      winner: null,
      reason: null,
      ratingDelta: null,
    });
    const untouched = {
      rating: 1000,
      ratedMatches: 0,
      matches: 0,
      wins: 0,
      losses: 0,
    };
    expect(
      await h.db
        .select({
          rating: players.rating,
          ratedMatches: players.ratedMatches,
          matches: players.matches,
          wins: players.wins,
          losses: players.losses,
        })
        .from(players)
        .where(inArray(players.userId, [a.userId, b.userId])),
    ).toEqual([untouched, untouched]);
    expect(
      await h.db
        .select()
        .from(ratingHistory)
        .where(eq(ratingHistory.matchId, matchId)),
    ).toEqual([]);
    // Without a result there is nothing to announce.
    expect(
      await h.db
        .select()
        .from(outbox)
        .where(sql`${outbox.envelope}->>'aggregateId' = ${matchId}`),
    ).toEqual([]);

    // Back later: nothing to resume, nothing in the history, free to play.
    const back = await h.connect(a.userId);
    expect(back.ready.activeMatchId).toBeNull();
    const sync = back.send("match.sync", {});
    expect((await back.error(sync)).payload.code).toBe("no_active_match");
    const auth = await h.auth(a.userId);
    const history = await h.http().get("/v1/me/matches").set(auth).expect(200);
    expect(history.body.items).toEqual([]);
    const stats = await h.http().get("/v1/me/stats").set(auth).expect(200);
    expect(stats.body).toMatchObject({ matches: 0, wins: 0, losses: 0 });
    back.send("bot.start", { level: "easy" });
    expect((await back.next("match.state")).payload.match.matchId).not.toBe(
      matchId,
    );
  });
});
