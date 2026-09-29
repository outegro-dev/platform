import {
  type BotLevel,
  classicRules,
  createBot,
  FleetValidator,
  RandomPlacement,
  SeededRandom,
} from "@outegro/battleship-engine";
import {
  defaultCosmetics,
  nicknameSchema,
  roomCodeSchema,
} from "@outegro/contracts/battleship";
import { ManualClock } from "@outegro/nest-common";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeOutlet, FakeStore, silentLog } from "../test/fakes.js";
import { cellsOf, fleets, waterOf } from "../test/fixtures.js";
import { ManualScheduler } from "../test/manual-scheduler.js";
import { dayStart, weekStart } from "./calendar.js";
import { Entitlements, type GrantRecord } from "./entitlements.js";
import { GameError } from "./errors.js";
import { BotPlayer } from "./game/bot-player.js";
import { GameSession } from "./game/game-session.js";
import {
  defaultTimings,
  type MatchAction,
  type MatchRecord,
  type SessionEnd,
} from "./game/types.js";
import { PairingPlanner, SearchWindow } from "./matchmaking.js";
import { defaultNickname, generateRoomCode } from "./names.js";
import { RatingPolicy } from "./rating.js";
import { TokenBucket } from "./token-bucket.js";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";

describe("fixtures", () => {
  it("are legal fleets", () => {
    const validator = new FleetValidator(classicRules);
    expect(validator.validate(fleets.a)).toBeNull();
    expect(validator.validate(fleets.b)).toBeNull();
  });
});

describe("search window", () => {
  const window = new SearchWindow();

  it("starts at ±100 and grows by 50 every 5 seconds", () => {
    expect(window.width(0)).toBe(100);
    expect(window.width(4_999)).toBe(100);
    expect(window.width(5_000)).toBe(150);
    expect(window.width(20_000)).toBe(300);
    expect(window.width(29_999)).toBe(350);
  });

  it("accepts anyone after 30 seconds", () => {
    expect(window.width(30_000)).toBe(Number.POSITIVE_INFINITY);
  });

  it("never grows beyond its maximum", () => {
    const slow = new SearchWindow({
      initial: 100,
      step: 50,
      stepMs: 5_000,
      max: 500,
      anyoneAfterMs: Number.POSITIVE_INFINITY,
    });
    expect(slow.width(60_000)).toBe(500);
  });
});

describe("pairing planner", () => {
  const planner = new PairingPlanner();
  const entry = (userId: string, rating: number, since = 0) => ({
    userId,
    rating,
    since,
  });

  it("pairs the closest ratings inside the window, oldest first", () => {
    const pairs = planner.plan(
      [
        entry("a", 1000, 0),
        entry("b", 1090, 1),
        entry("c", 1020, 2),
        entry("d", 1500, 3),
      ],
      1_000,
    );
    expect(pairs.map(([x, y]) => [x.userId, y.userId])).toEqual([["a", "c"]]);
  });

  it("widens with the wait and pairs anyone after 30 seconds", () => {
    const players = [entry("a", 1000, 0), entry("b", 1300, 0)];
    expect(planner.plan(players, 10_000)).toHaveLength(0);
    expect(planner.plan(players, 20_000)).toHaveLength(1);
    expect(
      planner.plan([entry("a", 1000, 0), entry("b", 2400, 29_000)], 30_000),
    ).toHaveLength(1);
  });

  it("never puts a player in two pairs", () => {
    const players = Array.from({ length: 9 }, (_, i) =>
      entry(`p${i}`, 1000 + i * 10, i),
    );
    const ids = planner
      .plan(players, 60_000)
      .flat()
      .map((e) => e.userId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(8);
  });
});

describe("entitlements", () => {
  const now = new Date("2026-09-29T10:00:00.000Z");
  const grant = (over: Partial<GrantRecord>): GrantRecord => ({
    feature: "premium",
    state: "active",
    validFrom: new Date("2026-09-01T00:00:00.000Z"),
    validUntil: null,
    ...over,
  });

  it("counts only grants that are active, started and not ended", () => {
    expect(Entitlements.isActive(grant({}), now)).toBe(true);
    expect(Entitlements.isActive(grant({ state: "revoked" }), now)).toBe(false);
    expect(Entitlements.isActive(grant({ state: "expired" }), now)).toBe(false);
    expect(
      Entitlements.isActive(
        grant({ validFrom: new Date("2026-10-01T00:00:00Z") }),
        now,
      ),
    ).toBe(false);
    expect(Entitlements.isActive(grant({ validUntil: now }), now)).toBe(false);
    expect(
      Entitlements.isActive(
        grant({ validUntil: new Date(now.getTime() + 1) }),
        now,
      ),
    ).toBe(true);
  });

  it("premium unlocks hard and expert bots, extended stats and every skin", () => {
    const premium = Entitlements.from(
      [grant({ validUntil: new Date("2026-10-29T00:00:00Z") })],
      now,
    );
    const none = Entitlements.from([], now);
    for (const level of ["hard", "expert"] as BotLevel[]) {
      expect(premium.canPlayBot(level)).toBe(true);
      expect(none.canPlayBot(level)).toBe(false);
    }
    expect(none.canPlayBot("easy")).toBe(true);
    expect(premium.extendedStats).toBe(true);
    expect(none.extendedStats).toBe(false);
    expect(premium.premiumUntil?.toISOString()).toBe(
      "2026-10-29T00:00:00.000Z",
    );
    expect(premium.unlocked("ships", "silver")).toBe(true);
  });

  it("knows when the features next change by time alone", () => {
    const soon = new Date(now.getTime() + 60_000);
    const later = new Date(now.getTime() + 3600_000);
    expect(Entitlements.nextChange([grant({})], now)).toBeNull();
    expect(
      Entitlements.nextChange(
        [grant({ validUntil: later }), grant({ validFrom: soon })],
        now,
      ),
    ).toEqual(soon);
    expect(
      Entitlements.nextChange(
        [grant({ state: "revoked", validUntil: soon })],
        now,
      ),
    ).toBeNull();
  });

  it("the silver fleet unlocks the silver set only, and falls back when it ends", () => {
    const silver = Entitlements.from(
      [grant({ feature: "cosmetics.silver-fleet" })],
      now,
    );
    const chosen = {
      ships: "silver",
      hitEffect: "shards",
      theme: "night-sea",
    } as const;
    expect(silver.premium).toBe(false);
    expect(silver.effective(chosen)).toEqual(chosen);
    expect(Entitlements.from([], now).effective(chosen)).toEqual(
      defaultCosmetics,
    );
    expect(silver.canPlayBot("expert")).toBe(false);
  });
});

describe("rating policy", () => {
  const policy = new RatingPolicy();

  it("rates quick matches only", () => {
    expect(policy.isRated("quick")).toBe(true);
    expect(policy.isRated("private")).toBe(false);
    expect(policy.isRated("bot")).toBe(false);
  });

  it("is zero-sum (TC-BS-07)", () => {
    const settled = policy.settle(
      { rating: 1180, matches: 12 },
      { rating: 1010, matches: 40 },
    );
    expect(settled.winner.delta + settled.loser.delta).toBe(0);
    expect(settled.winner.after).toBe(1180 + settled.winner.delta);
    expect(settled.loser.after).toBe(1010 + settled.loser.delta);
    expect(policy.isProvisional(29)).toBe(true);
    expect(policy.isProvisional(30)).toBe(false);
  });
});

describe("token bucket", () => {
  it("allows a burst of 40, then 20 per second", () => {
    const clock = new ManualClock(new Date("2026-09-29T10:00:00.000Z"));
    const bucket = new TokenBucket(clock, 20, 40);
    for (let i = 0; i < 40; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    clock.advance(500);
    for (let i = 0; i < 10; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });
});

describe("calendar", () => {
  it("weeks start on Monday 00:00 UTC", () => {
    expect(weekStart(new Date("2026-09-29T10:00:00Z")).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    expect(weekStart(new Date("2026-09-28T00:00:00Z")).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    expect(weekStart(new Date("2026-10-04T23:59:59Z")).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    expect(weekStart(new Date("2026-10-05T00:00:00Z")).toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
    expect(dayStart(new Date("2026-09-29T23:00:00Z")).toISOString()).toBe(
      "2026-09-29T00:00:00.000Z",
    );
  });
});

describe("names", () => {
  it("room codes and default nicknames follow the contract", () => {
    for (let i = 0; i < 200; i++) {
      expect(roomCodeSchema.safeParse(generateRoomCode()).success).toBe(true);
      expect(nicknameSchema.safeParse(defaultNickname(i % 12)).success).toBe(
        true,
      );
    }
    expect(defaultNickname(0)).toMatch(/^Sailor \d{4}$/);
  });
});

describe("bot player", () => {
  it("pauses 600–1400 ms like a human", () => {
    const bot = BotPlayer.create("easy", new SeededRandom(1), {
      minMs: 600,
      maxMs: 1_400,
    });
    for (let i = 0; i < 500; i++) {
      const pause = bot.thinkingTime();
      expect(pause).toBeGreaterThanOrEqual(600);
      expect(pause).toBeLessThanOrEqual(1_400);
    }
  });
});

describe("game session", () => {
  let clock: ManualClock;
  let scheduler: ManualScheduler;
  let store: FakeStore;
  let outlet: FakeOutlet;
  let ends: SessionEnd[];

  beforeEach(() => {
    clock = new ManualClock(new Date("2026-09-29T10:00:00.000Z"));
    scheduler = new ManualScheduler(clock);
    store = new FakeStore();
    outlet = new FakeOutlet();
    outlet.online.add(ALICE);
    outlet.online.add(BOB);
    ends = [];
  });

  const online = (
    mode: "quick" | "private" = "private",
    firstTurn: "a" | "b" = "a",
  ): MatchRecord => ({
    id: "00000000-0000-4000-8000-000000000111",
    mode,
    rated: mode === "quick",
    seats: {
      a: {
        kind: "human",
        userId: ALICE,
        nickname: "Alice",
        rating: 1000,
        premium: false,
      },
      b: {
        kind: "human",
        userId: BOB,
        nickname: "Bob",
        rating: 1000,
        premium: true,
      },
    },
    firstTurn,
    createdAt: clock.now(),
  });

  const session = (record: MatchRecord, history: MatchAction[] = []) => {
    const created = new GameSession(
      record,
      {
        store,
        outlet,
        scheduler,
        clock,
        random: new SeededRandom(7),
        timings: defaultTimings,
        log: silentLog,
        onEnd: (_s, end) => ends.push(end),
      },
      history,
    );
    created.start();
    return created;
  };

  const rejects = async (action: Promise<unknown>, code: string) => {
    await expect(action).rejects.toSatisfy(
      (error) => error instanceof GameError && error.code === code,
    );
  };

  it("a player who does not place in 90 seconds loses on time", async () => {
    const game = session(online());
    await game.placeFleet(ALICE, fleets.a);
    await scheduler.advance(89_999);
    expect(ends).toHaveLength(0);
    await scheduler.advance(1);
    expect(ends).toEqual([
      expect.objectContaining({
        kind: "finished",
        winner: "a",
        reason: "timeout",
      }),
    ]);
    expect(outlet.last(BOB, "match.finished")?.payload).toMatchObject({
      winner: "opponent",
      reason: "timeout",
      opponentFleet: fleets.a,
    });
    expect(outlet.last(ALICE, "match.finished")?.payload.opponentFleet).toEqual(
      [],
    );
  });

  it("nobody placing in time aborts the match without a result", async () => {
    session(online("quick"));
    await scheduler.advance(90_000);
    expect(ends).toEqual([{ kind: "aborted", reason: "placement_timeout" }]);
    expect(store.aborted).toHaveLength(1);
    expect(store.finished).toHaveLength(0);
    expect(outlet.last(ALICE, "match.aborted")?.payload.reason).toBe(
      "placement_timeout",
    );
  });

  it("each turn has 30 seconds; three missed turns in a row lose", async () => {
    const game = session(online("private", "a"), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    const water = waterOf(fleets.a);
    for (let round = 1; round <= 2; round++) {
      await scheduler.advance(30_000);
      expect(outlet.last(ALICE, "turn.skipped")?.payload).toMatchObject({
        side: "you",
        missedInRow: round,
        nextTurn: "opponent",
      });
      const cell = water[round] as { x: number; y: number };
      await game.fire(BOB, cell.x, cell.y);
    }
    await scheduler.advance(30_000);
    expect(ends).toEqual([
      expect.objectContaining({ winner: "b", reason: "timeout" }),
    ]);
    expect(store.moves.filter((m) => m.outcome === "skip")).toHaveLength(3);
  });

  it("a failed write changes nothing and is reported as internal", async () => {
    const game = session(online(), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    const before = await game.snapshotFor(ALICE);
    outlet.clear();
    store.failNext = true;
    await rejects(game.fire(ALICE, 9, 0), "internal");
    expect(await game.snapshotFor(ALICE)).toEqual(before);
    expect(outlet.types(BOB)).toEqual([]);
    // The same shot works once the store is back.
    await game.fire(ALICE, 9, 0);
    expect(outlet.last(BOB, "shot.result")?.payload).toMatchObject({
      by: "opponent",
      outcome: "hit",
    });
  });

  it("rule violations never change state (TC-BS-04)", async () => {
    const game = session(online(), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    const before = await game.snapshotFor(ALICE);
    await rejects(game.fire(BOB, 0, 0), "not_your_turn");
    await rejects(
      game.fire("00000000-0000-4000-8000-0000000000cc", 0, 0),
      "not_a_player",
    );
    await game.fire(ALICE, 0, 9);
    await rejects(game.fire(ALICE, 0, 9), "already_shot");
    await rejects(game.placeFleet(ALICE, fleets.a), "wrong_phase");
    expect((await game.snapshotFor(ALICE)).type).toBe("match.state");
    expect(before.type).toBe("match.state");
  });

  it("a player who leaves has 60 seconds to come back", async () => {
    const game = session(online(), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    outlet.online.delete(BOB);
    game.userOffline(BOB);
    expect(outlet.last(ALICE, "opponent.presence")?.payload).toEqual({
      connected: false,
      graceUntil: "2026-09-29T10:01:00.000Z",
    });
    await scheduler.advance(20_000);
    outlet.online.add(BOB);
    game.userOnline(BOB);
    expect(outlet.last(ALICE, "opponent.presence")?.payload).toEqual({
      connected: true,
      graceUntil: null,
    });
    await scheduler.advance(60_000);
    expect(
      ends.filter((e) => e.kind === "finished" && e.reason === "disconnected"),
    ).toHaveLength(0);

    outlet.online.delete(BOB);
    game.userOffline(BOB);
    await scheduler.advance(60_000);
    expect(ends).toEqual([
      expect.objectContaining({ winner: "a", reason: "disconnected" }),
    ]);
  });

  it("when both players are away as the grace runs out, the match is cancelled without a result", async () => {
    // After a restart nobody is back yet: both graces end at the same instant.
    outlet.online.clear();
    session(online("quick"), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    await scheduler.advance(59_999);
    expect(ends).toHaveLength(0);
    await scheduler.advance(1);
    expect(ends).toEqual([{ kind: "aborted", reason: "abandoned" }]);
    expect(store.aborted).toEqual([{ reason: "abandoned", audit: null }]);
    // No result: no rating or statistics change.
    expect(store.finished).toHaveLength(0);
    for (const user of [ALICE, BOB])
      expect(outlet.last(user, "match.aborted")?.payload.reason).toBe(
        "abandoned",
      );
    expect(scheduler.pending).toBe(0);
  });

  /** Alice leaves at 0 s, Bob at 50 s: at 60 s her grace ends while his runs. */
  const staggered = async () => {
    const game = session(online("quick"), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    outlet.online.delete(ALICE);
    game.userOffline(ALICE);
    await scheduler.advance(50_000);
    outlet.online.delete(BOB);
    game.userOffline(BOB);
    await scheduler.advance(10_000);
    return game;
  };

  it("a forfeit waits while the opponent is away too; the opponent back in time wins at once", async () => {
    const game = await staggered();
    expect(ends).toHaveLength(0);
    await scheduler.advance(10_000);
    outlet.online.add(BOB);
    game.userOnline(BOB);
    await scheduler.advance(0);
    expect(ends).toEqual([
      expect.objectContaining({
        kind: "finished",
        winner: "b",
        reason: "disconnected",
      }),
    ]);
    expect(outlet.last(BOB, "match.finished")?.payload).toMatchObject({
      winner: "you",
      reason: "disconnected",
      rating: { delta: 16 },
    });
  });

  it("a waiting forfeit becomes a cancelled match when the opponent's grace runs out too", async () => {
    await staggered();
    await scheduler.advance(49_999);
    expect(ends).toHaveLength(0);
    await scheduler.advance(1);
    expect(ends).toEqual([{ kind: "aborted", reason: "abandoned" }]);
    expect(store.finished).toHaveLength(0);
  });

  it("a player back after its own grace ran out cannot play; the opponent's return decides", async () => {
    const game = await staggered();
    await scheduler.advance(5_000);
    outlet.online.add(ALICE);
    game.userOnline(ALICE);
    // Her turn (Bob's timed out at 60 s), but her forfeit is waiting.
    await rejects(game.fire(ALICE, 9, 9), "wrong_phase");
    await scheduler.advance(5_000);
    outlet.online.add(BOB);
    game.userOnline(BOB);
    await scheduler.advance(0);
    expect(ends).toEqual([
      expect.objectContaining({ winner: "b", reason: "disconnected" }),
    ]);
    expect(outlet.last(ALICE, "match.finished")?.payload).toMatchObject({
      winner: "opponent",
      reason: "disconnected",
    });
  });

  it("the player back in time gets the result right after the snapshot", async () => {
    const game = await staggered();
    await scheduler.advance(10_000);
    outlet.online.add(BOB);
    // A reconnect: presence first, then the snapshot.
    game.userOnline(BOB);
    expect(await game.stateFor(BOB)).toEqual([
      {
        type: "match.state",
        payload: {
          match: expect.objectContaining({ phase: "finished", winner: "you" }),
        },
      },
      {
        type: "match.finished",
        payload: expect.objectContaining({
          winner: "you",
          reason: "disconnected",
          rating: expect.objectContaining({ delta: 16 }),
        }),
      },
    ]);
  });

  it("if one of two absent players is back in time, the other loses as before", async () => {
    outlet.online.clear();
    const game = session(online("quick"), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    await scheduler.advance(20_000);
    outlet.online.add(BOB);
    game.userOnline(BOB);
    await scheduler.advance(40_000);
    expect(ends).toEqual([
      expect.objectContaining({
        kind: "finished",
        winner: "b",
        reason: "disconnected",
      }),
    ]);
    expect(store.aborted).toHaveLength(0);
    expect(
      outlet.last(BOB, "match.finished")?.payload.rating?.delta,
    ).toBeGreaterThan(0);
  });

  it("a snapshot asked for while the match is being cancelled ends with the cancellation", async () => {
    const game = await staggered();
    await scheduler.advance(49_999);
    const expiry = scheduler.advance(1);
    const late = game.stateFor(ALICE);
    await expiry;
    expect(await late).toEqual([
      expect.objectContaining({ type: "match.state" }),
      { type: "match.aborted", payload: { reason: "abandoned" } },
    ]);
  });

  it("the opponent's live ships never reach a player before the end (TC-BS-03)", async () => {
    const game = session(online(), [
      { kind: "place", side: "a", ships: fleets.a },
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    const shipsOfBob = fleets.b.map((ship) => JSON.stringify(ship));
    const water = waterOf(fleets.b);
    for (let i = 0; i < 5; i++) {
      const aim = water[i] as { x: number; y: number };
      await game.fire(ALICE, aim.x, aim.y);
      const back = waterOf(fleets.a)[i] as { x: number; y: number };
      await game.fire(BOB, back.x, back.y);
    }
    outlet.send(ALICE, await game.snapshotFor(ALICE));
    const seen = JSON.stringify(outlet.of(ALICE));
    for (const ship of shipsOfBob) expect(seen).not.toContain(ship);
    expect(seen).not.toContain(BOB);
    const state = await game.snapshotFor(ALICE);
    if (state.type !== "match.state") throw new Error("expected a snapshot");
    for (const cell of cellsOf(fleets.b))
      expect(state.payload.match.target?.cells[cell.y]?.[cell.x]).toBe(
        "unknown",
      );
    expect(state.payload.match.opponentFleet).toBeNull();
    await game.resign(BOB);
    expect(outlet.last(ALICE, "match.finished")?.payload.opponentFleet).toEqual(
      fleets.b,
    );
  });

  it("the bot answers after a human-like pause and closes idle matches", async () => {
    const record: MatchRecord = {
      ...online(),
      mode: "bot",
      rated: false,
      firstTurn: "b",
      seats: { a: online().seats.a, b: { kind: "bot", level: "expert" } },
    };
    const game = session(record, [
      { kind: "place", side: "b", ships: fleets.b },
    ]);
    await game.placeFleet(ALICE, fleets.a);
    const placedAt = clock.now().getTime();
    expect(outlet.last(ALICE, "match.started")?.payload).toEqual({
      turn: "opponent",
      deadline: null,
    });
    await scheduler.advance(599);
    expect(
      outlet.of(ALICE).filter((m) => m.type === "shot.result"),
    ).toHaveLength(0);
    await scheduler.advance(801);
    expect(
      outlet.of(ALICE).filter((m) => m.type === "shot.result").length,
    ).toBeGreaterThanOrEqual(1);
    // Waiting for the human never times out the turn; 15 idle minutes end it.
    while (outlet.last(ALICE, "shot.result")?.payload.nextTurn !== "you")
      await scheduler.advance(1_400);
    await scheduler.advance(placedAt + 15 * 60_000 - 1 - clock.now().getTime());
    expect(ends).toHaveLength(0);
    await scheduler.advance(1);
    expect(ends).toEqual([
      expect.objectContaining({ winner: "b", reason: "disconnected" }),
    ]);
    expect(store.finished[0]?.record.rated).toBe(false);
  });

  it("a bot match has no reconnect grace: an away human loses only after 15 idle minutes", async () => {
    outlet.online.clear();
    const game = session(
      {
        ...online(),
        mode: "bot",
        rated: false,
        seats: { a: online().seats.a, b: { kind: "bot", level: "easy" } },
      },
      [{ kind: "place", side: "b", ships: fleets.b }],
    );
    game.userOffline(ALICE);
    expect(game.inspect().graceUntil).toEqual({});
    await scheduler.advance(15 * 60_000 - 1);
    expect(ends).toHaveLength(0);
    await scheduler.advance(1);
    expect(ends).toEqual([
      expect.objectContaining({
        kind: "finished",
        winner: "b",
        reason: "disconnected",
      }),
    ]);
    expect(store.aborted).toHaveLength(0);
  });
});

describe("server bots (TC-BS-05)", () => {
  /** The engine's random shooter plays the server's bot through a session; true when the bot wins. */
  async function botWins(level: BotLevel, seed: number): Promise<boolean> {
    const clock = new ManualClock(new Date("2026-09-29T10:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const random = new SeededRandom(seed);
    let end: SessionEnd | null = null;
    const record: MatchRecord = {
      id: "00000000-0000-4000-8000-000000000222",
      mode: "bot",
      rated: false,
      seats: {
        a: {
          kind: "human",
          userId: ALICE,
          nickname: "Alice",
          rating: 1000,
          premium: true,
        },
        b: { kind: "bot", level },
      },
      firstTurn: seed % 2 === 0 ? "a" : "b",
      createdAt: clock.now(),
    };
    const game = new GameSession(
      record,
      {
        store: new FakeStore(),
        outlet: new FakeOutlet(),
        scheduler,
        clock,
        random,
        timings: defaultTimings,
        log: silentLog,
        onEnd: (_s, ended) => {
          end = ended;
        },
      },
      [{ kind: "place", side: "b", ships: BotPlayer.placeFleet(random) }],
    );
    game.start();
    await game.placeFleet(
      ALICE,
      new RandomPlacement(random).place(classicRules),
    );
    const human = createBot("easy", new SeededRandom(seed * 7919));
    for (let guard = 0; guard < 400 && !end; guard++) {
      const state = await game.snapshotFor(ALICE);
      if (state.type !== "match.state") throw new Error("expected a snapshot");
      const { turn, target } = state.payload.match;
      if (turn === "you" && target) {
        const cell = human.next(target);
        await game.fire(ALICE, cell.x, cell.y);
      } else {
        await scheduler.advance(1_400);
      }
    }
    const result = end as SessionEnd | null;
    if (!result) throw new Error("the match did not finish");
    return result.kind === "finished" && result.winner === "b";
  }

  async function winRate(level: BotLevel, games: number) {
    let wins = 0;
    for (let seed = 1; seed <= games; seed++)
      if (await botWins(level, seed)) wins++;
    return wins / games;
  }

  it("the expert bot beats a random shooter in at least 95% of 200 games", async () => {
    expect(await winRate("expert", 200)).toBeGreaterThanOrEqual(0.95);
  });

  it("the medium bot beats a random shooter in at least 70% of 200 games", async () => {
    expect(await winRate("medium", 200)).toBeGreaterThanOrEqual(0.7);
  });
});
