import { randomUUID } from "node:crypto";
import { connect as tcpConnect } from "node:net";
import type { ShipPlacement } from "@outegro/battleship-engine";
import { billingGrantChanged, createEvent } from "@outegro/contracts";
import {
  defaultCosmetics,
  leaderboardSchema,
  type ServerMessage,
} from "@outegro/contracts/battleship";
import { eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matches, outbox, players, ratingHistory } from "./db/schema.js";
import { weekStart } from "./domain/calendar.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { GameService } from "./game/game.service.js";
import { KeyedMutex } from "./game/keyed-mutex.js";
import { LobbyService } from "./game/lobby.service.js";
import { MatchmakerService } from "./game/matchmaker.service.js";
import { QueueStore } from "./game/queue.store.js";
import { SessionRegistry } from "./game/session.registry.js";
import { EntitlementWatch } from "./players/entitlement.watch.js";
import { ConnectionRegistry } from "./realtime/connection.registry.js";
import {
  cellsOf,
  fleets,
  type Harness,
  ORIGIN,
  startHarness,
} from "./test/harness.js";
import {
  battle,
  type Cell,
  farWater,
  fire,
  type Player,
  snapshot,
} from "./test/play.js";
import { TestSocket } from "./test/socket-client.js";

/**
 * QA attacks on the game server: a crafted client, races between players,
 * timers and moderation, malformed input at the edges, and a final check
 * that nothing stays behind. Each test names the property it defends.
 */

let h: Harness;

beforeAll(async () => {
  h = await startHarness({ seed: 4242 });
});
afterAll(() => h?.close());

/** Every socket opened here; the last test closes them all. */
const opened: TestSocket[] = [];

async function connect(userId?: string): Promise<Player> {
  const socket = await h.connect(userId);
  opened.push(socket);
  return socket;
}

async function room() {
  const a = await connect();
  const b = await connect();
  a.send("room.create", {});
  const { code } = (await a.next("room.created")).payload;
  b.send("room.join", { code });
  const { matchId } = (await a.next("match.state")).payload.match;
  await b.next("match.state");
  return { a, b, matchId };
}

async function quickMatch() {
  const a = await connect();
  const b = await connect();
  a.send("queue.join", { mode: "quick" });
  await a.next("queue.joined");
  b.send("queue.join", { mode: "quick" });
  const { matchId } = (await a.next("queue.matched")).payload;
  await b.next("queue.matched");
  await a.next("match.state");
  await b.next("match.state");
  return { a, b, matchId };
}

async function patchMe(userId: string, body: object) {
  return h
    .http()
    .patch("/v1/me")
    .set(await h.auth(userId))
    .send(body);
}

/** Writes a raw upgrade request; resolves with all the server wrote. */
function rawUpgrade(path: string, headers: string[]): Promise<string> {
  const port = Number(new URL(h.socketUrl(null)).port);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = tcpConnect(port, "127.0.0.1", () =>
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          ...headers,
          "",
          "",
        ].join("\r\n"),
      ),
    );
    socket.on("data", (data) => chunks.push(data));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString()));
    socket.on("error", reject);
  });
}

/** Every ship-like object anywhere inside a value. */
function placementsIn(value: unknown, found: ShipPlacement[] = []) {
  if (Array.isArray(value)) for (const item of value) placementsIn(item, found);
  else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("orientation" in record && "length" in record)
      found.push({
        x: record.x as number,
        y: record.y as number,
        length: record.length as number,
        orientation: record.orientation as ShipPlacement["orientation"],
      });
    for (const inner of Object.values(record)) placementsIn(inner, found);
  }
  return found;
}

const samePlacement = (a: ShipPlacement, b: ShipPlacement) =>
  a.x === b.x &&
  a.y === b.y &&
  a.length === b.length &&
  a.orientation === b.orientation;

/** Messages a socket received before its match.finished. */
function beforeFinish(socket: TestSocket): ServerMessage[] {
  const end = socket.received.findIndex((m) => m.type === "match.finished");
  return end < 0 ? [...socket.received] : socket.received.slice(0, end);
}

/** How many times a socket was told its match ended. */
const endings = (socket: TestSocket) =>
  socket.received.filter(
    (m) => m.type === "match.finished" || m.type === "match.aborted",
  ).length;

describe("hidden information (TC-BS-03), crafted client", () => {
  it("tabs, a reconnect, syncs, probing shots and every HTTP route never reveal live ships or the opponent's id", async () => {
    const { a, b, matchId } = await room();
    // Premium opens the replay and heatmap paths too.
    await h.get(GrantsConsumer).apply(h.grantEvent({ userId: a.userId }));
    const tab = await connect(a.userId);
    await tab.next("match.state");
    tab.send("match.sync", {});
    await tab.next("match.state");
    const order = await battle(a, b);
    const aMisses = farWater(fleets.b);
    const bMisses = farWater(fleets.a);
    const sockets: TestSocket[] = [a, tab];
    const bodies: unknown[] = [];
    const probeHttp = async () => {
      const auth = await h.auth(a.userId);
      for (const path of [
        "/v1/me",
        "/v1/me/stats",
        "/v1/me/matches",
        "/v1/leaderboard",
        "/v1/leaderboard?period=week",
      ]) {
        const response = await h.http().get(path).set(auth);
        expect(response.status).toBe(200);
        bodies.push(response.body);
      }
      const replay = await h
        .http()
        .get(`/v1/matches/${matchId}/replay`)
        .set(auth);
      expect(replay.status).toBe(404);
      bodies.push(replay.body);
      for (const path of [
        `/v1/admin/matches/${matchId}`,
        `/v1/admin/matches?userId=${b.userId}`,
        `/v1/admin/players/${b.userId}`,
      ]) {
        const denied = await h.http().get(path).set(auth);
        expect(denied.status).toBe(403);
        bodies.push(denied.body);
      }
    };

    let aShoots = order.first === a;
    let current: Player = a;
    for (let round = 0; round < 6; round++) {
      if (aShoots) {
        // After a miss the turn has passed: firing again is out of turn.
        const { mine } = await fire(current, b, aMisses.shift() as Cell);
        expect(mine.outcome).toBe("miss");
        const again = current.send("shot.fire", { x: mine.x, y: mine.y });
        expect((await current.error(again)).payload.code).toBe("not_your_turn");
      } else {
        // While b aims, every one of the 100 cells answers the same.
        const probe = round % 2 === 0 ? tab : current;
        const codes = new Set<string>();
        for (let i = 0; i < 100; i++) {
          const seq = probe.send("shot.fire", { x: i % 10, y: (i / 10) | 0 });
          codes.add((await probe.error(seq)).payload.code);
          // Stay inside the budget of 20 commands per second.
          if (i % 20 === 19) await h.advance(2_000);
        }
        expect([...codes]).toEqual(["not_your_turn"]);
        await fire(b, current, bMisses.shift() as Cell);
      }
      aShoots = !aShoots;
      if (round === 2) {
        // A reconnect in the middle: a fresh socket, a fresh snapshot.
        await current.close();
        const back = await connect(a.userId);
        await back.next("match.state");
        sockets.push(back);
        current = back;
      }
      await snapshot(current);
      await probeHttp();
    }
    b.send("match.resign", {});
    await Promise.all([tab, current].map((s) => s.next("match.finished")));

    const seen = sockets.flatMap(beforeFinish);
    expect(seen.length).toBeGreaterThan(300);
    const everything = [...seen, ...bodies];
    expect(JSON.stringify(everything)).not.toContain(b.userId);
    // The only ships a ever saw before the end are its own.
    const ships = placementsIn(everything);
    expect(ships.length).toBeGreaterThan(0);
    for (const ship of ships)
      expect(fleets.a.some((own) => samePlacement(own, ship))).toBe(true);
    for (const message of seen)
      if (message.type === "match.state") {
        const { match } = message.payload;
        expect(match.opponentFleet).toBeNull();
        expect(match.target?.sunkShips ?? []).toEqual([]);
        for (const cell of cellsOf(fleets.b))
          expect(match.target?.cells[cell.y]?.[cell.x] ?? "unknown").toBe(
            "unknown",
          );
      }
  });
});

describe("rejected commands change nothing (TC-BS-04)", () => {
  it("two tabs firing at once: one shot lands, the other is out of turn, one row stored", async () => {
    const { a, b, matchId } = await room();
    const { first, second, firstTargets } = await battle(a, b);
    const tab = await connect(first.userId);
    await tab.next("match.state");
    const [one, two] = farWater(firstTargets) as [Cell, Cell];
    const seqOne = first.send("shot.fire", one);
    const seqTwo = tab.send("shot.fire", two);
    await second.next("shot.result", (m) => m.payload.by === "opponent");
    await Promise.all([first.sync(), tab.sync(), second.sync()]);
    const refused = [
      ...first.pending("error").filter((m) => m.payload.ref === seqOne),
      ...tab.pending("error").filter((m) => m.payload.ref === seqTwo),
    ];
    expect(refused.map((m) => m.payload.code)).toEqual(["not_your_turn"]);
    expect(second.pending("shot.result")).toHaveLength(0);
    expect((await snapshot(first)).moves).toBe(1);
    const [row] = await h.db
      .select({ moves: matches.moves })
      .from(matches)
      .where(eq(matches.id, matchId));
    expect(row?.moves).toBe(1);
  });

  it("the same hit from two tabs lands once; the repeat is already_shot", async () => {
    const { a, b } = await room();
    const { first, second, firstTargets } = await battle(a, b);
    const tab = await connect(first.userId);
    await tab.next("match.state");
    const ship = firstTargets.find((s) => s.length === 4) as ShipPlacement;
    const cell = { x: ship.x, y: ship.y };
    const seqOne = first.send("shot.fire", cell);
    const seqTwo = tab.send("shot.fire", cell);
    await second.next("shot.result", (m) => m.payload.by === "opponent");
    await Promise.all([first.sync(), tab.sync(), second.sync()]);
    const refused = [
      ...first.pending("error").filter((m) => m.payload.ref === seqOne),
      ...tab.pending("error").filter((m) => m.payload.ref === seqTwo),
    ];
    expect(refused.map((m) => m.payload.code)).toEqual(["already_shot"]);
    expect(second.pending("shot.result")).toHaveLength(0);
    expect((await snapshot(first)).moves).toBe(1);
  });
});

describe("socket handshake", () => {
  it("/ws without a ticket gives nothing but an empty 401", async () => {
    expect(await rawUpgrade("/ws", [`Origin: ${ORIGIN}`])).toBe(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    expect(await rawUpgrade("/ws?ticket=", [`Origin: ${ORIGIN}`])).toMatch(
      /^HTTP\/1\.1 401 /,
    );
  });

  it("refuses origin look-alikes and a doubled Origin without spending the ticket", async () => {
    const ticket = await h.ticketFor(randomUUID());
    for (const origin of [
      "HTTP://LOCALHOST:3005",
      "http://localhost:3005/",
      "null",
      "http://localhost:3005.evil.test",
      "http://localhost",
      "https://localhost:3005",
    ])
      await expect(
        TestSocket.open(h.socketUrl(ticket), origin),
      ).rejects.toThrow("HTTP 403");
    const doubled = await rawUpgrade(`/ws?ticket=${ticket}`, [
      `Origin: ${ORIGIN}`,
      `Origin: ${ORIGIN}`,
    ]);
    expect(doubled).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
    // Still unspent: the right origin opens it.
    const socket = await TestSocket.open(h.socketUrl(ticket), ORIGIN);
    opened.push(socket);
    await socket.next("session.ready");
  });

  it("a ticket taken before a suspension no longer opens a socket", async () => {
    const userId = randomUUID();
    const ticket = await h.ticketFor(userId);
    expect(
      await h
        .get(IdentityConsumer)
        .apply(h.statusEvent(userId, "suspended", 1)),
    ).toBe(true);
    await expect(TestSocket.open(h.socketUrl(ticket), ORIGIN)).rejects.toThrow(
      "HTTP 403",
    );
    await h
      .http()
      .post("/v1/ws-tickets")
      .set(await h.auth(userId))
      .expect(403);
    expect((await patchMe(userId, { nickname: "Back Again" })).status).toBe(
      403,
    );
  });
});

describe("lobby races", () => {
  it("crowds joining and leaving the queue at once: nobody is paired twice, with themselves, or after leaving", async () => {
    const game = h.get(GameService);
    const queue = h.get(QueueStore);
    for (let round = 0; round < 3; round++) {
      const crowd = await Promise.all(
        Array.from({ length: 16 }, () => connect()),
      );
      // Everyone joins at once; half leave right away, half of those rejoin.
      crowd.forEach((player, i) => {
        player.send("queue.join", { mode: "quick" });
        if (i % 4 < 2) player.send("queue.leave", {});
        if (i % 4 === 1) player.send("queue.join", { mode: "quick" });
      });
      await Promise.all(crowd.map((p) => p.sync()));
      await h.advance(1_000);
      await Promise.all(crowd.map((p) => p.sync()));

      const ids = crowd.map((p) => p.userId);
      const live = await h.db
        .select({ a: matches.playerA, b: matches.playerB })
        .from(matches)
        .where(
          sql`${matches.status} in ('placement', 'battle') and ${or(
            inArray(matches.playerA, ids),
            inArray(matches.playerB, ids),
          )}`,
        );
      const seats = live.flatMap((m) => [m.a, m.b]);
      for (const m of live) expect(m.a).not.toBe(m.b);
      expect(new Set(seats).size).toBe(seats.length);
      expect(live.length).toBeGreaterThan(0);
      for (const player of crowd) {
        const types = player.received.map((m) => m.type);
        const matched = types.filter((t) => t === "queue.matched").length;
        expect(matched).toBeLessThanOrEqual(1);
        const left = types.lastIndexOf("queue.left");
        if (left > types.lastIndexOf("queue.joined"))
          expect(types.lastIndexOf("queue.matched")).toBeLessThan(left);
        const playing = game.active(player.userId) !== undefined;
        expect(playing).toBe(matched === 1);
        // Never queued and playing at once.
        if (playing) expect(await queue.since(player.userId)).toBeNull();
      }
      for (const player of crowd)
        if (game.active(player.userId)) player.send("match.resign", {});
      await Promise.all(crowd.map((p) => p.sync()));
      await Promise.all(crowd.map((p) => p.close()));
    }
  });

  it("ten guests racing for one room while the host cancels: one outcome, at most one match", async () => {
    for (let round = 0; round < 3; round++) {
      const host = await connect();
      host.send("room.create", {});
      const { code } = (await host.next("room.created")).payload;
      const guests = await Promise.all(
        Array.from({ length: 10 }, () => connect()),
      );
      const seqs = guests.map((g) => g.send("room.join", { code }));
      const cancel = round === 0 ? null : host.send("room.cancel", {});
      await Promise.all([host, ...guests].map((s) => s.sync()));
      const winners = guests.filter((g) => g.pending("match.state").length);
      const refused = guests.flatMap((g, i) =>
        g
          .pending("error")
          .filter((m) => m.payload.ref === seqs[i])
          .map((m) => m.payload.code),
      );
      const cancelled = host.pending("room.cancelled").length;
      expect(winners.length + cancelled).toBe(1);
      if (round === 0) expect(winners).toHaveLength(1);
      expect(refused).toEqual(
        Array(10 - winners.length).fill("room_not_found"),
      );
      const live = await h.db
        .select({ id: matches.id })
        .from(matches)
        .where(
          sql`${matches.status} in ('placement', 'battle') and ${matches.playerA} = ${host.userId}`,
        );
      expect(live).toHaveLength(winners.length);
      const [winner] = winners;
      if (winner) {
        await host.next("match.state");
        if (cancel !== null)
          expect((await host.error(cancel)).payload.code).toBe(
            "room_not_found",
          );
        winner.send("match.resign", {});
        await host.next("match.finished");
      }
      await Promise.all([host, ...guests].map((s) => s.close()));
    }
  });
});

describe("one result per match", () => {
  /**
   * A quick match where `first` needs one more shot to win and has let the
   * clock run out twice in a row: the next timeout loses it the match.
   */
  async function brink() {
    const { a, b, matchId } = await quickMatch();
    const { first, second, firstTargets, secondTargets } = await battle(a, b);
    const targets = cellsOf(firstTargets);
    const last = targets.pop() as Cell;
    for (const cell of targets)
      expect((await fire(first, second, cell)).mine.nextTurn).toBe("you");
    const misses = farWater(secondTargets);
    for (const miss of misses.slice(0, 2)) {
      await h.advance(30_000);
      await first.next("turn.skipped");
      await fire(second, first, miss);
    }
    return { first, second, last, matchId };
  }

  const orders = {
    "the shot first": [0, 1, 2, 3, 4],
    "the resign first": [1, 3, 0, 4, 2],
    "the clock first": [2, 4, 1, 0, 3],
  } as const;

  for (const [name, order] of Object.entries(orders))
    it(`last shot, resign, turn clock, suspension and moderation at once (${name}): one result, one rating change, one event`, async () => {
      const { first, second, last, matchId } = await brink();
      const moderator = await h.auth(randomUUID(), ["support"]);
      const contenders: (() => Promise<unknown>)[] = [
        async () => first.send("shot.fire", last),
        async () => second.send("match.resign", {}),
        () => h.advance(30_000),
        () =>
          h
            .get(IdentityConsumer)
            .apply(h.statusEvent(second.userId, "suspended", 9)),
        async () =>
          h
            .http()
            .post(`/v1/admin/matches/${matchId}/abort`)
            .set(moderator)
            .send({ reason: "race under test" }),
      ];
      await Promise.all(order.map((i) => contenders[i]?.()));
      await expect.poll(() => endings(first)).toBe(1);
      await first.sync();
      expect(endings(first)).toBe(1);
      expect(endings(second)).toBe(1);

      const [row] = await h.db
        .select()
        .from(matches)
        .where(eq(matches.id, matchId));
      const history = await h.db
        .select()
        .from(ratingHistory)
        .where(eq(ratingHistory.matchId, matchId));
      const events = await h.db
        .select({ id: outbox.eventId })
        .from(outbox)
        .where(sql`${outbox.envelope}->>'aggregateId' = ${matchId}`);
      const people = await h.db
        .select()
        .from(players)
        .where(inArray(players.userId, [first.userId, second.userId]));
      if (row?.status === "aborted") {
        expect(history).toEqual([]);
        expect(events).toEqual([]);
        for (const person of people)
          expect(person).toMatchObject({ matches: 0, rating: 1000 });
        return;
      }
      expect(row?.status).toBe("finished");
      expect(events).toHaveLength(1);
      expect(history).toHaveLength(2);
      expect(history.reduce((sum, r) => sum + r.delta, 0)).toBe(0);
      for (const person of people) {
        const change = history.find((r) => r.userId === person.userId);
        expect(person).toMatchObject({
          matches: 1,
          ratedMatches: 1,
          rating: change?.after,
        });
      }
      const told = first.received.find((m) => m.type === "match.finished");
      const winnerSide = told?.payload.winner === "you" ? first : second;
      expect(
        history.find((r) => r.userId === winnerSide.userId)?.delta,
      ).toBeGreaterThan(0);
    });
});

describe("HTTP edges", () => {
  it("nicknames: letters, digits, space, - and _ in any script; unique ignoring case; one winner in a race", async () => {
    const user = randomUUID();
    for (const nickname of [
      "ab",
      "X".repeat(21),
      " -abc",
      "abc-",
      "a​bc",
      "abc‮def",
      "école",
      "\u{1F642}\u{1F642}\u{1F642}",
      "<b>x</b>",
      "a\tb",
    ])
      expect({
        nickname,
        status: (await patchMe(user, { nickname })).status,
      }).toEqual({ nickname, status: 400 });
    expect(
      (await patchMe(user, { nickname: " Жук Мореход " })).body,
    ).toMatchObject({ nickname: "Жук Мореход" });
    const other = randomUUID();
    for (const clash of ["жук мореход", "ЖУК МОРЕХОД"])
      expect((await patchMe(other, { nickname: clash })).status).toBe(409);
    expect((await patchMe(other, { nickname: "X".repeat(20) })).status).toBe(
      200,
    );

    const racers = Array.from({ length: 6 }, () => randomUUID());
    const spellings = ["Race Winner", "race winner", "RACE WINNER"];
    const results = await Promise.all(
      racers.map((id, i) =>
        patchMe(id, { nickname: spellings[i % spellings.length] }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      200, 409, 409, 409, 409, 409,
    ]);
  });

  it("the weekly board starts exactly at Monday 00:00:00.000 UTC", async () => {
    const monday = weekStart(h.clock.now()).getTime();
    const userId = randomUUID();
    const nickname = `Boundary ${userId.slice(0, 6)}`;
    const now = h.clock.now();
    await h.db.insert(players).values({
      userId,
      nickname,
      rating: 1057,
      ratedMatches: 2,
      ratedWins: 2,
      cosmetics: defaultCosmetics,
      createdAt: now,
      updatedAt: now,
    });
    for (const [delta, at] of [
      [50, monday - 1],
      [7, monday],
    ] as const) {
      const matchId = randomUUID();
      await h.db.insert(matches).values({
        id: matchId,
        mode: "quick",
        status: "finished",
        playerA: userId,
        firstTurn: "a",
        winner: "a",
        rated: true,
        createdAt: new Date(at - 60_000),
        finishedAt: new Date(at),
      });
      await h.db.insert(ratingHistory).values({
        userId,
        matchId,
        before: 1000,
        after: 1000 + delta,
        delta,
        at: new Date(at),
      });
    }
    const week = leaderboardSchema.parse(
      (await h.http().get("/v1/leaderboard?period=week")).body,
    );
    expect(week.since).toBe(new Date(monday).toISOString());
    expect(week.items.find((i) => i.nickname === nickname)).toMatchObject({
      gained: 7,
      wins: 1,
      matches: 1,
    });
  });

  it("a grant that starts later turns Premium on at validFrom, live on the socket", async () => {
    const socket = await connect();
    const now = h.clock.now().getTime();
    const grantId = randomUUID();
    await h.get(GrantsConsumer).apply(
      createEvent(billingGrantChanged, {
        aggregateId: grantId,
        aggregateVersion: 1,
        payload: {
          grantId,
          userId: socket.userId,
          service: "battleship",
          feature: "premium",
          sourceType: "subscription",
          sourceId: randomUUID(),
          state: "active",
          validFrom: new Date(now + 600_000).toISOString(),
          // A monthly subscription: the end is beyond setTimeout's limit.
          validUntil: new Date(now + 31 * 24 * 3600_000).toISOString(),
        },
      }),
    );
    expect((await socket.next("player.updated")).payload.player.premium).toBe(
      false,
    );
    const early = socket.send("bot.start", { level: "hard" });
    expect((await socket.error(early)).payload.code).toBe("premium_required");
    await h.advance(600_000);
    expect((await socket.next("player.updated")).payload.player.premium).toBe(
      true,
    );
    socket.send("bot.start", { level: "hard" });
    expect((await socket.next("match.state")).payload.match.opponent).toEqual({
      kind: "bot",
      level: "hard",
    });
    socket.send("match.resign", {});
    await socket.next("match.finished");
  });
});

describe("resources", () => {
  it("nothing stays behind once everyone has left and the clocks ran out", async () => {
    await Promise.all(opened.map((socket) => socket.close()));
    await expect.poll(() => h.get(ConnectionRegistry).stats().sockets).toBe(0);
    // Every live match ends by its clocks (60 s grace, 15 min bot idle).
    await h.advance(16 * 60_000);
    const field = (service: unknown, name: string) =>
      (service as Record<string, Map<unknown, unknown>>)[name]?.size;
    // Finishes write to the database under the players' locks after the
    // clocks fire; on a slow machine they are still running here.
    await expect
      .poll(() => field(h.get(KeyedMutex), "tails"), { timeout: 15_000 })
      .toBe(0);
    expect(h.get(SessionRegistry).all()).toHaveLength(0);
    expect(h.scheduler.pending).toBe(0);
    expect(field(h.get(EntitlementWatch), "timers")).toBe(0);
    expect(field(h.get(LobbyService), "roomTimers")).toBe(0);
    expect(field(h.get(MatchmakerService), "pairing")).toBe(0);
    expect(await h.get(QueueStore).size()).toBe(0);
    const keys = await h.valkey.keys("*");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith("battleship:")).toBe(true);
      expect(await h.valkey.pttl(key)).toBeGreaterThan(0);
    }
  });
});
