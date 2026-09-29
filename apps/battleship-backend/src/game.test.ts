import { randomUUID } from "node:crypto";
import type { ShipPlacement } from "@outegro/battleship-engine";
import { battleshipMatchFinished } from "@outegro/contracts";
import { roomCodeSchema } from "@outegro/contracts/battleship";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matches, moves, players, ratingHistory } from "./db/schema.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { GameService } from "./game/game.service.js";
import { KeyedMutex } from "./game/keyed-mutex.js";
import { QueueStore } from "./game/queue.store.js";
import { ConnectionRegistry } from "./realtime/connection.registry.js";
import {
  cellsOf,
  fleets,
  type Harness,
  startHarness,
  waterOf,
} from "./test/harness.js";
import {
  battle,
  type Cell,
  farWater,
  fire,
  room as openRoom,
  snapshot,
} from "./test/play.js";

const room = () => openRoom(h);

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

async function premium(userId: string) {
  await h.get(GrantsConsumer).apply(h.grantEvent({ userId }));
}

describe("placement (TC-BS-01)", () => {
  it("the server rejects illegal fleets and changes nothing", async () => {
    const { a, b } = await room();
    const touching = [...fleets.a];
    touching[9] = { x: 4, y: 1, length: 1, orientation: "horizontal" };
    const outside = [...fleets.a];
    outside[0] = { x: 7, y: 0, length: 4, orientation: "horizontal" };
    const overlap = [...fleets.a];
    overlap[9] = { x: 1, y: 0, length: 1, orientation: "horizontal" };
    const cases: [ShipPlacement[], string][] = [
      [touching, "touching"],
      [outside, "out_of_bounds"],
      [overlap, "overlap"],
      [
        [...fleets.a, { x: 9, y: 5, length: 1, orientation: "horizontal" }],
        "wrong_composition",
      ],
      [fleets.a.slice(1), "wrong_composition"],
    ];
    for (const [ships, code] of cases) {
      const seq = a.send("fleet.place", { ships });
      expect((await a.error(seq)).payload.code).toBe(code);
    }
    expect((await snapshot(a)).yourFleetPlaced).toBe(false);
    expect((await snapshot(b)).opponentFleetPlaced).toBe(false);
    a.send("fleet.place", { ships: fleets.a });
    expect((await a.next("fleet.placed")).payload.side).toBe("you");
    expect((await b.next("fleet.placed")).payload.side).toBe("opponent");
    const again = a.send("fleet.place", { ships: fleets.a });
    expect((await a.error(again)).payload.code).toBe("fleet_already_placed");
  });
});

describe("shots (TC-BS-02)", () => {
  it("a hit shoots again, a miss passes the turn, a sunk ship reveals the water around it", async () => {
    const { a, b } = await room();
    const { first, second, firstTargets } = await battle(a, b);
    const long = firstTargets.find(
      (ship) => ship.length === 4,
    ) as ShipPlacement;
    const hit = await fire(first, second, { x: long.x, y: long.y });
    expect(hit.mine).toMatchObject({
      outcome: "hit",
      nextTurn: "you",
      revealed: [],
    });
    expect(hit.theirs).toMatchObject({
      by: "opponent",
      outcome: "hit",
      nextTurn: "opponent",
    });
    expect(Date.parse(hit.mine.deadline ?? "")).toBe(
      h.clock.now().getTime() + 30_000,
    );
    expect(hit.mine.ship).toBeUndefined();

    const single = firstTargets.find(
      (ship) => ship.length === 1,
    ) as ShipPlacement;
    const sunk = await fire(first, second, { x: single.x, y: single.y });
    expect(sunk.mine).toMatchObject({
      outcome: "sunk",
      ship: single,
      nextTurn: "you",
    });
    expect(sunk.mine.revealed.length).toBeGreaterThanOrEqual(3);

    const water = waterOf(firstTargets).find(
      (cell) =>
        !sunk.mine.revealed.some((r) => r.x === cell.x && r.y === cell.y),
    ) as Cell;
    const miss = await fire(first, second, water);
    expect(miss.mine).toMatchObject({ outcome: "miss", nextTurn: "opponent" });
    expect(miss.theirs.nextTurn).toBe("you");

    const view = await snapshot(first);
    expect(view.moves).toBe(3);
    expect(view.turn).toBe("opponent");
    expect(view.target?.sunkShips).toEqual([single]);
    for (const cell of sunk.mine.revealed)
      expect(view.target?.cells[cell.y]?.[cell.x]).toBe("miss");
    expect(view.target?.cells[long.y]?.[long.x]).toBe("hit");
  });
});

describe("hidden information (TC-BS-03)", () => {
  it("the opponent's live ships never reach a player; the fleet is revealed at the end", async () => {
    const { a, b } = await room();
    const order = await battle(a, b);
    // a only misses; b sinks a's fleet with a few misses in between.
    const aShots = farWater(fleets.b);
    const bMisses = farWater(fleets.a).slice(0, 6);
    const bShots: Cell[] = [];
    for (const [i, cell] of cellsOf(fleets.a).entries()) {
      bShots.push(cell);
      if (i % 4 === 1 && bMisses.length) bShots.push(bMisses.shift() as Cell);
    }
    let turn: "a" | "b" = order.first === a ? "a" : "b";
    let finished = false;
    let syncs = 0;
    while (!finished) {
      const shooter = turn === "a" ? a : b;
      const other = turn === "a" ? b : a;
      const cell = (turn === "a" ? aShots : bShots).shift() as Cell;
      const { mine } = await fire(shooter, other, cell);
      if (turn === "a" && syncs++ < 3) await snapshot(a);
      if (mine.nextTurn === null) finished = true;
      else if (mine.nextTurn === "opponent") turn = turn === "a" ? "b" : "a";
    }
    const end = await a.next("match.finished");
    expect(end.payload).toMatchObject({
      winner: "opponent",
      reason: "fleet_destroyed",
      rating: null,
    });
    expect(end.payload.opponentFleet).toEqual(fleets.b);

    const beforeEnd = a.received.slice(0, a.received.indexOf(end));
    expect(beforeEnd.length).toBeGreaterThan(20);
    const text = JSON.stringify(beforeEnd);
    for (const ship of fleets.b)
      expect(text).not.toContain(JSON.stringify(ship));
    expect(text).not.toContain(b.userId);
    for (const message of beforeEnd) {
      if (message.type === "match.state") {
        expect(message.payload.match.opponentFleet).toBeNull();
        for (const cell of cellsOf(fleets.b))
          expect(
            message.payload.match.target?.cells[cell.y]?.[cell.x] ?? "unknown",
          ).toBe("unknown");
      }
    }
    // Nor does the winner learn the loser's user id.
    expect(JSON.stringify(b.received)).not.toContain(a.userId);
  });
});

describe("rejected commands (TC-BS-04)", () => {
  it("out-of-turn shots, repeated cells and strangers change nothing", async () => {
    const { a, b, matchId } = await room();
    const { first, second, firstTargets, secondTargets } = await battle(a, b);
    const before = await snapshot(first);
    const early = second.send("shot.fire", { x: 0, y: 0 });
    expect((await second.error(early)).payload.code).toBe("not_your_turn");
    expect(await snapshot(first)).toEqual(before);

    const water = farWater(firstTargets)[0] as Cell;
    await fire(first, second, water);
    await fire(second, first, farWater(secondTargets)[0] as Cell);
    const repeat = first.send("shot.fire", water);
    expect((await first.error(repeat)).payload.code).toBe("already_shot");
    expect((await snapshot(first)).moves).toBe(2);

    const stranger = await h.connect();
    for (const [type, payload] of [
      ["shot.fire", { x: 1, y: 1 }],
      ["fleet.place", { ships: fleets.a }],
      ["match.resign", {}],
      ["match.sync", {}],
    ] as const) {
      const seq = stranger.send(type, payload);
      expect((await stranger.error(seq)).payload.code).toBe("no_active_match");
    }
    // Someone else's match looks like a missing one, even with Premium.
    await premium(stranger.userId);
    await h
      .http()
      .get(`/v1/matches/${matchId}/replay`)
      .set(await h.auth(stranger.userId))
      .expect(404);
    expect((await snapshot(first)).moves).toBe(2);
  });
});

describe("reconnect (TC-BS-06)", () => {
  it("coming back within 60 seconds restores the same state", async () => {
    const { a, b, matchId } = await room();
    const { first, second, firstTargets } = await battle(a, b);
    const ship = firstTargets[0] as ShipPlacement;
    await fire(first, second, { x: ship.x, y: ship.y });
    await fire(first, second, farWater(firstTargets)[0] as Cell);
    const before = await snapshot(a);

    await a.close();
    const gone = await b.next("opponent.presence");
    expect(gone.payload).toEqual({
      connected: false,
      graceUntil: new Date(h.clock.now().getTime() + 60_000).toISOString(),
    });
    await h.advance(20_000);
    const back = await h.connect(a.userId);
    expect(back.ready.activeMatchId).toBe(matchId);
    const state = (await back.next("match.state")).payload.match;
    expect(state).toEqual(before);
    expect(back.received.map((m) => m.type).slice(0, 2)).toEqual([
      "session.ready",
      "match.state",
    ]);
    expect((await b.next("opponent.presence")).payload).toEqual({
      connected: true,
      graceUntil: null,
    });
  });

  it("not coming back within 60 seconds loses the match", async () => {
    const { a, b, matchId } = await room();
    await b.close();
    await a.next("opponent.presence", (m) => !m.payload.connected);
    await h.advance(59_999);
    expect(a.pending("match.finished")).toHaveLength(0);
    await h.advance(1);
    const end = await a.next("match.finished");
    expect(end.payload).toMatchObject({
      winner: "you",
      reason: "disconnected",
      rating: null,
    });
    const [row] = await h.db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId));
    expect(row).toMatchObject({
      status: "finished",
      reason: "disconnected",
      winner: "a",
    });
  });

  it("a guest joining an absent owner's room sees the owner's deadline after the snapshot", async () => {
    const host = await h.connect();
    host.send("room.create", {});
    const { code } = (await host.next("room.created")).payload;
    await host.close();
    await expect
      .poll(() => h.get(ConnectionRegistry).socketsOf(host.userId))
      .toBe(0);
    const guest = await h.connect();
    guest.send("room.join", { code });
    const state = (await guest.next("match.state")).payload.match;
    expect(state.opponentConnected).toBe(false);
    expect((await guest.next("opponent.presence")).payload).toEqual({
      connected: false,
      graceUntil: new Date(h.clock.now().getTime() + 60_000).toISOString(),
    });
    expect(guest.received.map((m) => m.type)).toEqual([
      "session.ready",
      "match.state",
      "opponent.presence",
    ]);
    const back = await h.connect(host.userId);
    expect(back.ready.activeMatchId).toBe(state.matchId);
    expect((await guest.next("opponent.presence")).payload.connected).toBe(
      true,
    );
  });

  it("another open tab keeps the player present", async () => {
    const { a, b } = await room();
    const second = await h.connect(a.userId);
    await second.next("match.state");
    await a.close();
    await expect
      .poll(() => h.get(ConnectionRegistry).socketsOf(a.userId))
      .toBe(1);
    await b.sync();
    expect(b.pending("opponent.presence")).toHaveLength(0);
    await second.close();
    expect((await b.next("opponent.presence")).payload.connected).toBe(false);
  });
});

describe("clocks", () => {
  it("nobody placing a fleet in 90 seconds aborts the match without rating", async () => {
    const { a, b, matchId } = await room();
    await h.advance(90_000);
    for (const player of [a, b])
      expect((await player.next("match.aborted")).payload.reason).toBe(
        "placement_timeout",
      );
    const [row] = await h.db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId));
    expect(row).toMatchObject({
      status: "aborted",
      abortReason: "placement_timeout",
      winner: null,
    });
    a.send("bot.start", { level: "easy" });
    expect((await a.next("match.state")).payload.match.opponent.kind).toBe(
      "bot",
    );
  });

  it("a missing fleet after 90 seconds loses on time", async () => {
    const { a, b } = await room();
    a.send("fleet.place", { ships: fleets.a });
    await a.next("fleet.placed");
    await h.advance(90_000);
    expect((await a.next("match.finished")).payload).toMatchObject({
      winner: "you",
      reason: "timeout",
    });
    const lost = await b.next("match.finished");
    expect(lost.payload).toMatchObject({
      winner: "opponent",
      reason: "timeout",
    });
    expect(lost.payload.opponentFleet).toEqual(fleets.a);
  });

  it("a turn lasts 30 seconds and three missed turns in a row lose", async () => {
    const { a, b } = await room();
    const { first, second, secondTargets } = await battle(a, b);
    const misses = farWater(secondTargets);
    for (let round = 1; round <= 2; round++) {
      await h.advance(30_000);
      const skipped = await first.next("turn.skipped");
      expect(skipped.payload).toMatchObject({
        side: "you",
        missedInRow: round,
        nextTurn: "opponent",
      });
      expect(Date.parse(skipped.payload.deadline ?? "")).toBe(
        h.clock.now().getTime() + 30_000,
      );
      expect((await second.next("turn.skipped")).payload.side).toBe("opponent");
      await fire(second, first, misses[round] as Cell);
    }
    await h.advance(30_000);
    expect((await first.next("match.finished")).payload).toMatchObject({
      winner: "opponent",
      reason: "timeout",
    });
    expect((await second.next("match.finished")).payload.winner).toBe("you");
  });
});

describe("bots", () => {
  it("a full match against the bot, unrated, stored and announced", async () => {
    const events = await h.captureEvents(battleshipMatchFinished.type);
    const human = await h.connect();
    human.send("bot.start", { level: "easy" });
    const state = (await human.next("match.state")).payload.match;
    expect(state).toMatchObject({
      mode: "bot",
      rated: false,
      phase: "placement",
      opponent: { kind: "bot", level: "easy" },
      opponentFleetPlaced: true,
      deadline: null,
    });
    human.send("fleet.place", { ships: fleets.a });
    let turn = (await human.next("match.started")).payload.turn;
    const known = new Set<string>();
    const order = Array.from({ length: 100 }, (_, i) => ({
      x: i % 10,
      y: Math.floor(i / 10),
    }));
    for (;;) {
      if (turn === "you") {
        const cell = order.find((c) => !known.has(`${c.x},${c.y}`)) as Cell;
        human.send("shot.fire", cell);
        const result = (
          await human.next("shot.result", (m) => m.payload.by === "you")
        ).payload;
        known.add(`${cell.x},${cell.y}`);
        for (const r of result.revealed) known.add(`${r.x},${r.y}`);
        if (result.nextTurn === null) break;
        turn = result.nextTurn;
      } else {
        if (
          !human.pending("shot.result").some((m) => m.payload.by === "opponent")
        )
          await h.advance(1_400);
        const result = (
          await human.next("shot.result", (m) => m.payload.by === "opponent")
        ).payload;
        expect(result.deadline).toBeNull();
        if (result.nextTurn === null) break;
        turn = result.nextTurn;
      }
    }
    const end = (await human.next("match.finished")).payload;
    expect(end.reason).toBe("fleet_destroyed");
    expect(end.rating).toBeNull();
    const [row] = await h.db
      .select()
      .from(matches)
      .where(eq(matches.id, state.matchId));
    expect(row).toMatchObject({
      status: "finished",
      mode: "bot",
      botLevel: "easy",
      rated: false,
    });
    const stored = await h.db
      .select()
      .from(moves)
      .where(eq(moves.matchId, state.matchId));
    expect(stored.filter((m) => m.outcome !== "skip")).toHaveLength(
      row?.moves ?? -1,
    );
    const [player] = await h.db
      .select()
      .from(players)
      .where(eq(players.userId, human.userId));
    expect(player).toMatchObject({ matches: 1, rating: 1000, ratedMatches: 0 });
    await expect
      .poll(() => events.length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const event = events.find((e) => e.aggregateId === state.matchId);
    expect(battleshipMatchFinished.schema.parse(event).payload).toMatchObject({
      mode: "bot",
      botLevel: "easy",
      rated: false,
      ratingDelta: null,
      reason: "fleet_destroyed",
    });
  });

  it("hard and expert bots need Premium on the server (TC-BS-08)", async () => {
    const player = await h.connect();
    for (const level of ["hard", "expert"] as const) {
      const seq = player.send("bot.start", { level });
      expect((await player.error(seq)).payload.code).toBe("premium_required");
    }
    expect(player.pending("match.state")).toHaveLength(0);
    await premium(player.userId);
    player.send("bot.start", { level: "expert" });
    expect((await player.next("match.state")).payload.match.opponent).toEqual({
      kind: "bot",
      level: "expert",
    });
    const busy = player.send("bot.start", { level: "easy" });
    expect((await player.error(busy)).payload.code).toBe("already_in_match");
    player.send("match.resign", {});
    expect((await player.next("match.finished")).payload).toMatchObject({
      winner: "opponent",
      reason: "resigned",
    });
  });
});

describe("private rooms", () => {
  it("codes, own room, unknown code, cancel and expiry", async () => {
    const host = await h.connect();
    host.send("room.create", {});
    const created = (await host.next("room.created")).payload;
    expect(roomCodeSchema.safeParse(created.code).success).toBe(true);
    expect(Date.parse(created.expiresAt) - h.clock.now().getTime()).toBe(
      600_000,
    );
    const own = host.send("room.join", { code: created.code });
    expect((await host.error(own)).payload.code).toBe("own_room");
    const twice = host.send("room.create", {});
    expect((await host.error(twice)).payload.code).toBe("already_queued");
    const queue = host.send("queue.join", { mode: "quick" });
    expect((await host.error(queue)).payload.code).toBe("already_queued");
    const guest = await h.connect();
    const unknown = guest.send("room.join", { code: "ZZZZZZ" });
    expect((await guest.error(unknown)).payload.code).toBe("room_not_found");
    // A reload shows the room in session.ready.
    expect((await h.connect(host.userId)).ready.room).toEqual(created);
    host.send("room.cancel", {});
    expect((await host.next("room.cancelled")).payload.reason).toBe(
      "cancelled",
    );
    const late = guest.send("room.join", { code: created.code });
    expect((await guest.error(late)).payload.code).toBe("room_not_found");

    host.send("room.create", {});
    await host.next("room.created");
    await h.advance(600_000);
    expect((await host.next("room.cancelled")).payload.reason).toBe("expired");
  });

  it("a private match never changes ratings", async () => {
    const events = await h.captureEvents(battleshipMatchFinished.type);
    const { a, b, matchId, stateA } = await room();
    expect(stateA).toMatchObject({ mode: "private", rated: false });
    await battle(a, b);
    a.send("match.resign", {});
    expect((await a.next("match.finished")).payload).toMatchObject({
      winner: "opponent",
      rating: null,
    });
    expect((await b.next("match.finished")).payload).toMatchObject({
      winner: "you",
      rating: null,
    });
    const rows = await h.db
      .select()
      .from(players)
      .where(inArray(players.userId, [a.userId, b.userId]));
    expect(rows.map((p) => p.rating)).toEqual([1000, 1000]);
    expect(
      await h.db
        .select()
        .from(ratingHistory)
        .where(eq(ratingHistory.matchId, matchId)),
    ).toEqual([]);
    await expect
      .poll(() => events.some((e) => e.aggregateId === matchId), {
        timeout: 10_000,
      })
      .toBe(true);
    const event = events.find((e) => e.aggregateId === matchId);
    expect(event?.payload).toMatchObject({
      rated: false,
      ratingDelta: null,
      reason: "resigned",
    });
  });
});

describe("quick matches (TC-BS-07)", () => {
  it("pairs two waiting players and settles a zero-sum rating in one transaction", async () => {
    const events = await h.captureEvents(battleshipMatchFinished.type);
    const a = await h.connect();
    const b = await h.connect();
    a.send("queue.join", { mode: "quick" });
    await a.next("queue.joined");
    b.send("queue.join", { mode: "quick" });
    const matchedA = await a.next("queue.matched");
    const matchedB = await b.next("queue.matched");
    expect(matchedA.payload.matchId).toBe(matchedB.payload.matchId);
    const state = (await a.next("match.state")).payload.match;
    expect(state).toMatchObject({ mode: "quick", rated: true });
    expect(state.opponent).toMatchObject({
      kind: "human",
      rating: 1000,
      premium: false,
    });
    await b.next("match.state");
    await battle(a, b);
    b.send("match.resign", {});
    const won = (await a.next("match.finished")).payload;
    const lost = (await b.next("match.finished")).payload;
    expect(won.rating).toEqual({ before: 1000, after: 1016, delta: 16 });
    expect(lost.rating).toEqual({ before: 1000, after: 984, delta: -16 });
    expect((won.rating?.delta ?? 0) + (lost.rating?.delta ?? 0)).toBe(0);
    expect((await a.next("player.updated")).payload.player.rating).toBe(1016);
    expect((await b.next("player.updated")).payload.player.rating).toBe(984);

    const history = await h.db
      .select()
      .from(ratingHistory)
      .where(eq(ratingHistory.matchId, state.matchId));
    expect(history.map((r) => r.delta).sort()).toEqual([-16, 16]);
    const [{ total } = { total: -1 }] = await h.db
      .select({
        total: sql<number>`coalesce(sum(${ratingHistory.delta}), 0)::int`,
      })
      .from(ratingHistory);
    expect(total).toBe(0);
    const [row] = await h.db
      .select()
      .from(matches)
      .where(eq(matches.id, state.matchId));
    expect(row).toMatchObject({
      status: "finished",
      rated: true,
      ratingDelta: 16,
      reason: "resigned",
    });
    await expect
      .poll(() => events.some((e) => e.aggregateId === state.matchId), {
        timeout: 10_000,
      })
      .toBe(true);
    const event = battleshipMatchFinished.schema.parse(
      events.find((e) => e.aggregateId === state.matchId),
    );
    expect(event.payload).toMatchObject({
      mode: "quick",
      rated: true,
      ratingDelta: 16,
      winnerUserId: a.userId,
      loserUserId: b.userId,
      botLevel: null,
    });
    expect(event.aggregateVersion).toBe(row?.version);
  });

  it("widens the rating window while players wait", async () => {
    const low = randomUUID();
    const high = randomUUID();
    const a = await h.connect(low);
    const b = await h.connect(high);
    await h.db
      .update(players)
      .set({ rating: 1300 })
      .where(eq(players.userId, high));
    a.send("queue.join", { mode: "quick" });
    await a.next("queue.joined");
    b.send("queue.join", { mode: "quick" });
    await b.next("queue.joined");
    await h.advance(15_000);
    expect(a.pending("queue.matched")).toHaveLength(0);
    await h.advance(5_000);
    expect((await a.next("queue.matched")).payload.matchId).toBe(
      (await b.next("queue.matched")).payload.matchId,
    );
    const state = (await a.next("match.state")).payload.match;
    expect(state.opponent).toMatchObject({ kind: "human", rating: 1300 });
  });

  it("pairs concurrent joiners exactly once each", async () => {
    const sockets = await Promise.all(
      Array.from({ length: 6 }, () => h.connect()),
    );
    for (const socket of sockets) socket.send("queue.join", { mode: "quick" });
    const matched = await Promise.all(
      sockets.map((s) => s.next("queue.matched")),
    );
    const byMatch = new Map<string, number>();
    for (const m of matched)
      byMatch.set(m.payload.matchId, (byMatch.get(m.payload.matchId) ?? 0) + 1);
    expect([...byMatch.values()]).toEqual([2, 2, 2]);
    for (const socket of sockets) {
      const busy = socket.send("queue.join", { mode: "quick" });
      expect((await socket.error(busy)).payload.code).toBe("already_in_match");
    }
  });

  it("claims a pair at most once when passes race", async () => {
    const queue = h.get(QueueStore);
    const entries = Array.from({ length: 12 }, (_, i) => ({
      userId: randomUUID(),
      rating: 1000 + i,
      since: h.clock.now().getTime(),
    }));
    for (const entry of entries) await queue.join(entry);
    // Overlapping plans from several racing passes.
    const plans = [0, 1, 2, 3].map((shift) =>
      Array.from({ length: 6 }, (_, i) => {
        const x = entries[(2 * i + shift) % 12];
        const y = entries[(2 * i + 1 + shift) % 12];
        return [x, y] as [(typeof entries)[number], (typeof entries)[number]];
      }),
    );
    const results = await Promise.all(plans.map((plan) => queue.claim(plan)));
    const claimed = results.flat(2).map((e) => e.userId);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBe(12);
    expect(await queue.size()).toBe(0);
  });

  it("a player who leaves the queue while a pairing is in flight is not matched", async () => {
    // startPair locks both players in id order: while it waits for `low`,
    // `high` is free to leave the queue after the pass claimed the pair.
    const low = `0${randomUUID().slice(1)}`;
    const high = `f${randomUUID().slice(1)}`;
    const leaver = await h.connect(high);
    const stayer = await h.connect(low);
    await h.db
      .update(players)
      .set({ rating: 1600 })
      .where(eq(players.userId, low));
    leaver.send("queue.join", { mode: "quick" });
    await leaver.next("queue.joined");
    stayer.send("queue.join", { mode: "quick" });
    await stayer.next("queue.joined");
    // 600 points apart: no pair until anyone is acceptable after 30 s.
    let release: () => void = () => undefined;
    const busy = h
      .get(KeyedMutex)
      .run([low], () => new Promise<void>((resolve) => (release = resolve)));
    const advancing = h.advance(30_000);
    const queue = h.get(QueueStore);
    await expect
      .poll(async () => [await queue.since(low), await queue.since(high)])
      .toEqual([null, null]);
    leaver.send("queue.leave", {});
    await leaver.next("queue.left");
    release();
    await busy;
    await advancing;
    await leaver.sync();
    expect(leaver.pending("queue.matched")).toHaveLength(0);
    expect(h.get(GameService).active(high)).toBeUndefined();
    expect(h.get(GameService).active(low)).toBeUndefined();
    // The other player keeps the original place in the queue.
    expect(await queue.since(low)).toBe(h.clock.now().getTime() - 30_000);
    expect(await queue.since(high)).toBeNull();
    await Promise.all([leaver.close(), stayer.close()]);
  });
});
