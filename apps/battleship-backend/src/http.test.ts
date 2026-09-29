import { randomUUID } from "node:crypto";
import { pageSchema } from "@outegro/contracts";
import {
  defaultCosmetics,
  leaderboardSchema,
  matchReplaySchema,
  matchSummarySchema,
  playerProfileSchema,
  playerStatsSchema,
} from "@outegro/contracts/battleship";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAudit,
  matches,
  moves,
  players,
  ratingHistory,
} from "./db/schema.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { fleets, type Harness, startHarness } from "./test/harness.js";
import { room as openRoom } from "./test/play.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

const silverSet = {
  ships: "silver",
  hitEffect: "shards",
  theme: "night-sea",
} as const;

async function get(path: string, userId?: string, roles: string[] = []) {
  const call = h.http().get(path);
  return userId ? call.set(await h.auth(userId, roles)) : call;
}

async function patch(userId: string, body: object) {
  return h
    .http()
    .patch("/v1/me")
    .set(await h.auth(userId))
    .send(body);
}

async function premium(userId: string, validUntil: string | null = null) {
  await h.get(GrantsConsumer).apply(h.grantEvent({ userId, validUntil }));
}

const room = () => openRoom(h);

let seeded = 0;
/** A player row with chosen numbers (for leaderboard and stats). */
async function seedPlayer(values: Partial<typeof players.$inferInsert> = {}) {
  const userId = values.userId ?? randomUUID();
  const now = h.clock.now();
  await h.db.insert(players).values({
    userId,
    nickname: `Seeded ${++seeded}`,
    cosmetics: defaultCosmetics,
    createdAt: new Date(now.getTime() - 100_000 + seeded),
    updatedAt: now,
    ...values,
  });
  return userId;
}

async function seedMatch(
  values: Partial<typeof matches.$inferInsert> & { playerA: string },
) {
  const id = randomUUID();
  const now = h.clock.now();
  await h.db.insert(matches).values({
    id,
    mode: "private",
    status: "finished",
    firstTurn: "a",
    rated: false,
    fleetA: fleets.a,
    fleetB: fleets.b,
    createdAt: new Date(now.getTime() - 600_000),
    finishedAt: now,
    ...values,
  });
  return id;
}

describe("profile", () => {
  it("is created on first access with a default nickname", async () => {
    const userId = randomUUID();
    const first = await get("/v1/me", userId);
    expect(first.status).toBe(200);
    expect(playerProfileSchema.parse(first.body)).toEqual({
      userId,
      nickname: expect.stringMatching(/^Sailor \d{4}$/),
      rating: 1000,
      provisional: true,
      matches: 0,
      wins: 0,
      premium: false,
      premiumUntil: null,
      features: [],
      cosmetics: { equipped: defaultCosmetics, effective: defaultCosmetics },
    });
    const again = await get("/v1/me", userId);
    expect(again.body.nickname).toBe(first.body.nickname);
    await h.http().get("/v1/me").expect(401);
  });

  it("renames; a nickname taken in any case is 409 CONFLICT", async () => {
    const one = randomUUID();
    const two = randomUUID();
    expect((await patch(one, { nickname: "Captain Nemo" })).body.nickname).toBe(
      "Captain Nemo",
    );
    const taken = await patch(two, { nickname: "captain NEMO" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({
      code: "CONFLICT",
      fieldErrors: { nickname: ["taken"] },
    });
    expect((await patch(one, { nickname: "  captain nemo " })).status).toBe(
      200,
    );
    expect((await patch(two, { nickname: "<script>" })).status).toBe(400);
    expect((await patch(two, {})).status).toBe(400);
    expect((await patch(two, { nickname: "Капитан Немо" })).status).toBe(200);
  });

  it("equipping a locked cosmetic is 403 FORBIDDEN", async () => {
    const userId = randomUUID();
    const locked = await patch(userId, { cosmetics: { ships: "silver" } });
    expect(locked.status).toBe(403);
    expect(locked.body.error).toMatchObject({
      code: "FORBIDDEN",
      fieldErrors: { "cosmetics.ships": ["locked"] },
    });
    expect((await patch(userId, { cosmetics: { theme: "day" } })).status).toBe(
      200,
    );
  });
});

describe("grants (TC-BS-09)", () => {
  it("a purchase lands on open sockets without re-login; a revoke removes the skin", async () => {
    const userId = randomUUID();
    const socket = await h.connect(userId);
    const grantId = randomUUID();
    await h.publish(
      h.grantEvent({
        userId,
        grantId,
        feature: "cosmetics.silver-fleet",
        version: 1,
      }),
    );
    expect(
      (await socket.next("player.updated", undefined, 15_000)).payload.player,
    ).toMatchObject({
      premium: false,
      cosmetics: defaultCosmetics,
    });
    const equipped = await patch(userId, { cosmetics: silverSet });
    expect(equipped.status).toBe(200);
    expect(equipped.body.cosmetics.effective).toEqual(silverSet);
    expect(equipped.body.features).toEqual(["cosmetics.silver-fleet"]);
    expect(
      (await socket.next("player.updated")).payload.player.cosmetics,
    ).toEqual(silverSet);

    await h.publish(
      h.grantEvent({
        userId,
        grantId,
        feature: "cosmetics.silver-fleet",
        version: 2,
        state: "revoked",
      }),
    );
    expect(
      (await socket.next("player.updated", undefined, 15_000)).payload.player
        .cosmetics,
    ).toEqual(defaultCosmetics);
    const me = (await get("/v1/me", userId)).body;
    expect(me.cosmetics).toEqual({
      equipped: silverSet,
      effective: defaultCosmetics,
    });
    expect(me.features).toEqual([]);
  });

  it("stale and repeated events change nothing; other services are ignored", async () => {
    const consumer = h.get(GrantsConsumer);
    const userId = randomUUID();
    const grantId = randomUUID();
    const revoked = h.grantEvent({
      userId,
      grantId,
      version: 2,
      state: "revoked",
    });
    const stale = h.grantEvent({
      userId,
      grantId,
      version: 1,
      state: "active",
    });
    expect(await consumer.apply(revoked)).toBe(true);
    expect(await consumer.apply(stale)).toBe(false);
    expect(await consumer.apply(revoked)).toBe(false);
    expect(
      await consumer.apply(h.grantEvent({ userId, service: "assistant" })),
    ).toBe(false);
    expect((await get("/v1/me", userId)).body.premium).toBe(false);
  });

  it("Premium ends at validUntil without any event, live on open sockets", async () => {
    const userId = randomUUID();
    const until = new Date(h.clock.now().getTime() + 3600_000).toISOString();
    const socket = await h.connect(userId);
    await premium(userId, until);
    expect((await socket.next("player.updated")).payload.player.premium).toBe(
      true,
    );
    const active = (await get("/v1/me", userId)).body;
    expect(active).toMatchObject({
      premium: true,
      premiumUntil: until,
      features: ["premium"],
    });
    await h.advance(3600_000 - 1);
    expect(socket.pending("player.updated")).toHaveLength(0);
    await h.advance(1);
    expect((await socket.next("player.updated")).payload.player.premium).toBe(
      false,
    );
    expect((await get("/v1/me", userId)).body).toMatchObject({
      premium: false,
      premiumUntil: null,
    });
  });
});

describe("account status", () => {
  it("a suspended player loses the sockets, the live match and the leaderboard", async () => {
    const { a, b, matchId } = await room();
    await h.db
      .update(players)
      .set({ ratedMatches: 3, rating: 1500 })
      .where(eq(players.userId, a.userId));
    await h.publish(h.statusEvent(a.userId, "suspended", 2));
    expect(
      (await b.next("match.finished", undefined, 15_000)).payload,
    ).toMatchObject({
      winner: "you",
      reason: "disconnected",
    });
    expect((await a.closed).code).toBe(4403);
    const [row] = await h.db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId));
    expect(row?.status).toBe("finished");
    await h
      .http()
      .post("/v1/ws-tickets")
      .set(await h.auth(a.userId))
      .expect(403);
    const board = leaderboardSchema.parse((await get("/v1/leaderboard")).body);
    expect(board.items.map((i) => i.rating)).not.toContain(1500);

    const identity = h.get(IdentityConsumer);
    expect(await identity.apply(h.statusEvent(a.userId, "active", 1))).toBe(
      false,
    );
    expect(await identity.apply(h.statusEvent(a.userId, "active", 3))).toBe(
      true,
    );
    await h
      .http()
      .post("/v1/ws-tickets")
      .set(await h.auth(a.userId))
      .expect(201);
  });

  it('a deleted player becomes "Deleted player"', async () => {
    const identity = h.get(IdentityConsumer);
    const one = await h.connect();
    const two = await h.connect();
    await identity.apply(h.statusEvent(one.userId, "deleted", 1));
    await identity.apply(h.statusEvent(two.userId, "deleted", 1));
    const rows = await h.db
      .select()
      .from(players)
      .where(eq(players.status, "deleted"));
    expect(
      rows
        .filter((r) => [one.userId, two.userId].includes(r.userId))
        .map((r) => r.nickname),
    ).toEqual(["Deleted player", "Deleted player"]);
    expect((await one.closed).code).toBe(4403);
  });
});

describe("leaderboard", () => {
  it("ranks rated players by rating, leaves out hidden, suspended and unrated ones, shows your place", async () => {
    const second = await seedPlayer({
      rating: 1200,
      ratedMatches: 9,
      ratedWins: 5,
    });
    const first = await seedPlayer({
      rating: 1200,
      ratedMatches: 9,
      ratedWins: 7,
    });
    const third = await seedPlayer({
      rating: 1100,
      ratedMatches: 2,
      ratedWins: 1,
    });
    await seedPlayer({
      rating: 1900,
      ratedMatches: 5,
      leaderboardHidden: true,
    });
    await seedPlayer({ rating: 1800, ratedMatches: 5, status: "suspended" });
    await seedPlayer({ rating: 1700, ratedMatches: 0 });
    await premium(first);

    const board = leaderboardSchema.parse((await get("/v1/leaderboard")).body);
    const mine = new Map([
      [first, "first"],
      [second, "second"],
      [third, "third"],
    ]);
    const nicknames = await h.db
      .select({ userId: players.userId, nickname: players.nickname })
      .from(players);
    const order = board.items
      .map((item) =>
        mine.get(
          nicknames.find((n) => n.nickname === item.nickname)?.userId ?? "",
        ),
      )
      .filter(Boolean);
    expect(order).toEqual(["first", "second", "third"]);
    expect(board).toMatchObject({ period: "all", since: null, you: null });
    expect(board.items.map((i) => i.rank)).toEqual(
      board.items.map((_, i) => i + 1),
    );
    expect(
      board.items.find((i) => i.rating === 1200 && i.wins === 7)?.premium,
    ).toBe(true);
    expect(board.items.some((i) => i.rating >= 1700)).toBe(false);

    const own = leaderboardSchema.parse(
      (await get("/v1/leaderboard", third)).body,
    ).you;
    const rankOfThird =
      board.items.findIndex((i) => i.rating === 1100 && i.matches === 2) + 1;
    expect(own).toEqual({
      rank: rankOfThird,
      rating: 1100,
      wins: 1,
      matches: 2,
    });
    const unranked = leaderboardSchema.parse(
      (await get("/v1/leaderboard", randomUUID())).body,
    ).you;
    expect(unranked).toEqual({ rank: null, rating: 1000, wins: 0, matches: 0 });
    await h
      .http()
      .get("/v1/leaderboard")
      .set("authorization", "Bearer nope")
      .expect(401);
    await h.http().get("/v1/leaderboard?period=month").expect(400);
  });

  it("the week counts points gained since Monday 00:00 UTC, ties broken by weekly wins", async () => {
    const now = h.clock.now().getTime();
    const monday = Date.parse("2026-09-28T00:00:00.000Z");
    const steady = await seedPlayer({
      rating: 1030,
      ratedMatches: 2,
      ratedWins: 2,
    });
    const lucky = await seedPlayer({
      rating: 1030,
      ratedMatches: 1,
      ratedWins: 1,
    });
    const slipping = await seedPlayer({
      rating: 1045,
      ratedMatches: 2,
      ratedWins: 1,
    });
    const history = async (userId: string, delta: number, at: number) => {
      const matchId = await seedMatch({
        playerA: userId,
        mode: "quick",
        rated: true,
        winner: "a",
      });
      await h.db.insert(ratingHistory).values({
        userId,
        matchId,
        before: 1000,
        after: 1000 + delta,
        delta,
        at: new Date(at),
      });
    };
    await history(steady, 20, now - 3600_000);
    await history(steady, 10, now - 1800_000);
    await history(lucky, 30, now - 600_000);
    await history(slipping, 50, monday - 60_000);
    await history(slipping, -5, now - 60_000);

    const week = leaderboardSchema.parse(
      (await get("/v1/leaderboard?period=week", lucky)).body,
    );
    expect(week.since).toBe("2026-09-28T00:00:00.000Z");
    const ours = week.items.filter((i) => [1030, 1045].includes(i.rating));
    expect(ours.map((i) => [i.gained, i.wins, i.matches])).toEqual([
      [30, 2, 2],
      [30, 1, 1],
      [-5, 0, 1],
    ]);
    expect(week.you).toMatchObject({
      rating: 1030,
      wins: 1,
      matches: 1,
      gained: 30,
    });
    expect(week.you?.rank).toBe(ours[1]?.rank ?? 0);
  });
});

describe("statistics", () => {
  it("counts matches, wins, accuracy and bot wins; the heatmap is Premium", async () => {
    const userId = await seedPlayer({
      matches: 2,
      wins: 1,
      losses: 1,
      longestStreak: 1,
    });
    const rival = await seedPlayer();
    const won = await seedMatch({
      playerA: userId,
      mode: "bot",
      botLevel: "medium",
      winner: "a",
      reason: "fleet_destroyed",
      moves: 5,
    });
    const lost = await seedMatch({
      playerA: rival,
      playerB: userId,
      winner: "a",
      reason: "resigned",
      moves: 3,
    });
    const at = h.clock.now();
    await h.db.insert(moves).values([
      { matchId: won, n: 1, side: "a", x: 0, y: 0, outcome: "hit", at },
      { matchId: won, n: 2, side: "a", x: 1, y: 0, outcome: "sunk", at },
      { matchId: won, n: 3, side: "a", x: 2, y: 0, outcome: "miss", at },
      { matchId: won, n: 4, side: "b", x: 5, y: 5, outcome: "miss", at },
      { matchId: won, n: 5, side: "a", x: null, y: null, outcome: "skip", at },
      { matchId: won, n: 6, side: "a", x: 3, y: 0, outcome: "sunk", at },
      { matchId: lost, n: 1, side: "b", x: 0, y: 0, outcome: "miss", at },
      { matchId: lost, n: 2, side: "a", x: 9, y: 9, outcome: "hit", at },
    ]);
    const stats = playerStatsSchema.parse(
      (await get("/v1/me/stats", userId)).body,
    );
    expect(stats).toEqual({
      matches: 2,
      wins: 1,
      losses: 1,
      winRate: 0.5,
      accuracy: 0.6,
      currentStreak: 0,
      longestStreak: 1,
      averageMovesToWin: 4,
      botWins: { easy: 0, medium: 1, hard: 0, expert: 0 },
      heatmap: null,
    });
    await premium(userId);
    const heatmap = playerStatsSchema.parse(
      (await get("/v1/me/stats", userId)).body,
    ).heatmap;
    expect(heatmap?.[0]?.[0]).toBe(2);
    expect(heatmap?.[0]?.[3]).toBe(1);
    expect(heatmap?.[5]?.[5]).toBe(0);
    expect(heatmap?.flat().reduce((sum, n) => sum + n, 0)).toBe(5);
  });

  it("history pages newest first with an opaque cursor", async () => {
    const userId = await seedPlayer();
    const rival = await seedPlayer({ nickname: "Rival One" });
    const older = await seedMatch({
      playerA: userId,
      mode: "bot",
      botLevel: "easy",
      winner: "b",
      reason: "fleet_destroyed",
      finishedAt: new Date(h.clock.now().getTime() - 60_000),
    });
    const newer = await seedMatch({
      playerA: rival,
      playerB: userId,
      mode: "quick",
      rated: true,
      winner: "b",
      reason: "resigned",
      ratingDelta: 16,
    });
    await seedMatch({
      playerA: userId,
      mode: "bot",
      botLevel: "easy",
      status: "aborted",
      abortReason: "placement_timeout",
    });
    const page = pageSchema(matchSummarySchema);
    const first = page.parse(
      (await get("/v1/me/matches?limit=1", userId)).body,
    );
    expect(first.items).toEqual([
      expect.objectContaining({
        matchId: newer,
        mode: "quick",
        result: "win",
        ratingDelta: 16,
        opponent: {
          kind: "human",
          nickname: "Rival One",
          rating: 1000,
          premium: false,
        },
      }),
    ]);
    const second = page.parse(
      (await get(`/v1/me/matches?limit=1&cursor=${first.nextCursor}`, userId))
        .body,
    );
    expect(second.items).toEqual([
      expect.objectContaining({
        matchId: older,
        result: "loss",
        opponent: { kind: "bot", level: "easy" },
        ratingDelta: null,
      }),
    ]);
    expect(second.nextCursor).toBeNull();
    expect((await get("/v1/me/matches?cursor=garbage", userId)).status).toBe(
      400,
    );
  });

  it("a tampered cursor is 400 on every paged route, never 500", async () => {
    const id = randomUUID();
    const cursor = (at: string) =>
      encodeURIComponent(Buffer.from(`${at}|${id}`).toString("base64url"));
    // Valid JavaScript dates that PostgreSQL cannot store.
    const outOfRange = [
      "-100000-01-01T00:00:00.000Z",
      "0000-01-01T00:00:00.000Z",
      "+010000-01-01T00:00:00.000Z",
      "+275760-09-13T00:00:00.000Z",
    ];
    const support = randomUUID();
    for (const at of outOfRange)
      for (const path of [
        "/v1/me/matches",
        "/v1/admin/matches",
        "/v1/admin/players",
        "/v1/admin/audit",
      ]) {
        const response = await get(`${path}?cursor=${cursor(at)}`, support, [
          "support",
        ]);
        expect({ at, path, status: response.status }).toEqual({
          at,
          path,
          status: 400,
        });
      }
    const fine = await get(
      `/v1/me/matches?cursor=${cursor("2026-09-29T10:00:00.000Z")}`,
      support,
    );
    expect(fine.status).toBe(200);
  });

  it("a replay needs Premium and shows only the player's own finished matches", async () => {
    const userId = await seedPlayer();
    const rival = await seedPlayer();
    const matchId = await seedMatch({
      playerA: rival,
      playerB: userId,
      winner: "b",
      reason: "fleet_destroyed",
    });
    const at = h.clock.now();
    await h.db.insert(moves).values([
      { matchId, n: 1, side: "a", x: 0, y: 0, outcome: "miss", at },
      { matchId, n: 2, side: "b", x: null, y: null, outcome: "skip", at },
      { matchId, n: 3, side: "b", x: 9, y: 0, outcome: "hit", at },
    ]);
    const live = await seedMatch({
      playerA: userId,
      playerB: rival,
      status: "battle",
      finishedAt: null,
    });
    expect((await get(`/v1/matches/${matchId}/replay`, userId)).status).toBe(
      403,
    );
    await premium(userId);
    const replay = matchReplaySchema.parse(
      (await get(`/v1/matches/${matchId}/replay`, userId)).body,
    );
    expect(replay).toMatchObject({
      matchId,
      winner: "you",
      reason: "fleet_destroyed",
      fleets: { you: fleets.b, opponent: fleets.a },
      moves: [
        { n: 1, by: "opponent", x: 0, y: 0, outcome: "miss" },
        { n: 2, by: "you", x: 9, y: 0, outcome: "hit" },
      ],
    });
    expect((await get(`/v1/matches/${live}/replay`, userId)).status).toBe(404);
    expect((await get("/v1/matches/not-a-uuid/replay", userId)).status).toBe(
      404,
    );
    const stranger = randomUUID();
    await premium(stranger);
    expect((await get(`/v1/matches/${matchId}/replay`, stranger)).status).toBe(
      404,
    );
  });
});

describe("admin", () => {
  const support = ["support"];

  it("every admin route needs its permission", async () => {
    const id = randomUUID();
    const routes: ["get" | "post", string][] = [
      ["get", "/v1/admin/overview"],
      ["get", "/v1/admin/matches"],
      ["get", `/v1/admin/matches/${id}`],
      ["post", `/v1/admin/matches/${id}/abort`],
      ["get", "/v1/admin/players"],
      ["get", `/v1/admin/players/${id}`],
      ["post", `/v1/admin/players/${id}/reset-nickname`],
      ["post", `/v1/admin/players/${id}/leaderboard`],
      ["get", "/v1/admin/audit"],
    ];
    for (const roles of [[], ["billing_operator"], ["auditor"], ["pro"]]) {
      const headers = await h.auth(randomUUID(), roles);
      for (const [method, path] of routes) {
        const response = await h
          .http()
          [method](path)
          .set(headers)
          .send({ reason: "because", hidden: true });
        expect([path, response.status]).toEqual([path, 403]);
      }
    }
    await h.http().get("/v1/admin/overview").expect(401);
  });

  it("support sees the overview, matches with fleets and moves, players and grants", async () => {
    const { a, b, matchId } = await room();
    a.send("fleet.place", { ships: fleets.a });
    await a.next("fleet.placed");
    const actor = randomUUID();
    const overview = (await get("/v1/admin/overview", actor, support)).body;
    expect(overview).toMatchObject({
      activeMatches: { private: expect.any(Number), quick: 0 },
      botWinRate: { easy: expect.any(Object), expert: expect.any(Object) },
    });
    expect(overview.socketsOnline).toBeGreaterThanOrEqual(2);
    expect(overview.playersOnline).toBeGreaterThanOrEqual(2);
    expect(overview.activeMatches.private).toBeGreaterThanOrEqual(1);
    expect(overview.matchesToday).toBeGreaterThanOrEqual(1);
    expect(overview.newPlayers7d).toBeGreaterThanOrEqual(2);

    const list = (
      await get(
        `/v1/admin/matches?userId=${b.userId}&status=placement`,
        actor,
        support,
      )
    ).body;
    expect(list.items.map((m: { matchId: string }) => m.matchId)).toEqual([
      matchId,
    ]);
    const detail = (await get(`/v1/admin/matches/${matchId}`, actor, support))
      .body;
    expect(detail).toMatchObject({
      matchId,
      status: "placement",
      fleets: { a: fleets.a, b: null },
      players: { a: { userId: a.userId }, b: { userId: b.userId } },
      live: { phase: "placement", connected: { a: true, b: true } },
    });
    expect(
      (await get(`/v1/admin/matches/${randomUUID()}`, actor, support)).status,
    ).toBe(404);

    await patch(a.userId, { nickname: "Admiral Findme" });
    const found = (await get("/v1/admin/players?query=findme", actor, support))
      .body;
    expect(found.items).toEqual([
      expect.objectContaining({
        userId: a.userId,
        nickname: "Admiral Findme",
        online: true,
      }),
    ]);
    const byId = (
      await get(`/v1/admin/players?query=${b.userId}`, actor, support)
    ).body;
    expect(byId.items).toHaveLength(1);
    await premium(a.userId);
    const player = (await get(`/v1/admin/players/${a.userId}`, actor, support))
      .body;
    expect(player.player).toMatchObject({
      userId: a.userId,
      activeMatchId: matchId,
    });
    expect(player.stats.heatmap).toHaveLength(10);
    expect(player.grants).toEqual([
      expect.objectContaining({ feature: "premium", active: true }),
    ]);
  });

  it("moderation is audited: abort a live match, reset a nickname, hide from the leaderboard", async () => {
    const actor = randomUUID();
    const moderator = await h.auth(actor, support);
    const { a, b, matchId } = await room();
    await h
      .http()
      .post(`/v1/admin/matches/${matchId}/abort`)
      .set(moderator)
      .send({ reason: "x" })
      .expect(400);
    const aborted = await h
      .http()
      .post(`/v1/admin/matches/${matchId}/abort`)
      .set(moderator)
      .send({ reason: "reported as abusive" })
      .expect(200);
    expect(aborted.body).toEqual({ matchId, status: "aborted" });
    for (const player of [a, b])
      expect((await player.next("match.aborted")).payload.reason).toBe(
        "moderation",
      );
    const [row] = await h.db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId));
    expect(row).toMatchObject({
      status: "aborted",
      abortReason: "moderation",
      winner: null,
      ratingDelta: null,
    });
    await h
      .http()
      .post(`/v1/admin/matches/${matchId}/abort`)
      .set(moderator)
      .send({ reason: "again please" })
      .expect(409);
    await h
      .http()
      .post(`/v1/admin/matches/${randomUUID()}/abort`)
      .set(moderator)
      .send({ reason: "nothing here" })
      .expect(404);
    a.send("bot.start", { level: "easy" });
    await a.next("match.state");

    await patch(b.userId, { nickname: "Rude Name" });
    b.drain();
    // Distinct audit timestamps keep the expected order stable.
    h.clock.advance(1_000);
    const reset = await h
      .http()
      .post(`/v1/admin/players/${b.userId}/reset-nickname`)
      .set(moderator)
      .send({ reason: "offensive nickname" })
      .expect(200);
    expect(reset.body.nickname).toMatch(/^Sailor \d{4}$/);
    expect((await b.next("player.updated")).payload.player.nickname).toBe(
      reset.body.nickname,
    );

    const ranked = await seedPlayer({ rating: 2500, ratedMatches: 3 });
    h.clock.advance(1_000);
    await h
      .http()
      .post(`/v1/admin/players/${ranked}/leaderboard`)
      .set(moderator)
      .send({ hidden: true, reason: "boosting" })
      .expect(200);
    expect(
      (await get("/v1/leaderboard")).body.items.some(
        (i: { rating: number }) => i.rating === 2500,
      ),
    ).toBe(false);
    h.clock.advance(1_000);
    await h
      .http()
      .post(`/v1/admin/players/${ranked}/leaderboard`)
      .set(moderator)
      .send({ hidden: false, reason: "cleared" })
      .expect(200);
    expect((await get("/v1/leaderboard")).body.items[0].rating).toBe(2500);

    const audit = (await get("/v1/admin/audit?limit=10", actor, support)).body
      .items;
    expect(audit.slice(0, 4).map((e: { action: string }) => e.action)).toEqual([
      "player.leaderboard.shown",
      "player.leaderboard.hidden",
      "player.nickname.reset",
      "match.aborted",
    ]);
    expect(audit[3]).toMatchObject({
      actorId: actor,
      targetType: "match",
      targetId: matchId,
      reason: "reported as abusive",
    });
    expect(audit[2].data).toEqual({
      previous: "Rude Name",
      next: reset.body.nickname,
    });
    const rows = await h.db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.actorId, actor));
    expect(rows).toHaveLength(4);
  });
});
