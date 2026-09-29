import { describe, expect, it } from "vitest";
import {
  type BotLevel,
  Coordinate,
  classicRules,
  createBot,
  EloRating,
  FleetValidator,
  Match,
  MatchError,
  RandomPlacement,
  SeededRandom,
  type ShipPlacement,
  type ShotStrategy,
} from "./index.js";

const validFleet: ShipPlacement[] = [
  { x: 0, y: 0, length: 4, orientation: "horizontal" },
  { x: 0, y: 2, length: 3, orientation: "horizontal" },
  { x: 5, y: 0, length: 3, orientation: "vertical" },
  { x: 0, y: 4, length: 2, orientation: "horizontal" },
  { x: 3, y: 4, length: 2, orientation: "vertical" },
  { x: 7, y: 0, length: 2, orientation: "horizontal" },
  { x: 9, y: 9, length: 1, orientation: "horizontal" },
  { x: 7, y: 9, length: 1, orientation: "horizontal" },
  { x: 5, y: 9, length: 1, orientation: "horizontal" },
  { x: 3, y: 9, length: 1, orientation: "horizontal" },
];

function newMatch(first = "alice") {
  const match = new Match("m1", ["alice", "bob"], classicRules, first);
  match.placeFleet("alice", validFleet);
  match.placeFleet("bob", validFleet);
  return match;
}

function rejects(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MatchError);
    expect((error as MatchError).code).toBe(code);
    return;
  }
  throw new Error(`expected MatchError ${code}`);
}

describe("coordinates", () => {
  it("parses and prints labels", () => {
    expect(Coordinate.parse("A1").toJSON()).toEqual({ x: 0, y: 0 });
    expect(Coordinate.parse("j10").label).toBe("J10");
    expect(() => Coordinate.parse("K0Z")).toThrow(RangeError);
  });
});

describe("fleet rules (TC-BS-01)", () => {
  const validator = new FleetValidator(classicRules);

  it("accepts the classic fleet", () => {
    expect(validator.validate(validFleet)).toBeNull();
  });

  it("rejects a missing or extra ship", () => {
    expect(validator.validate(validFleet.slice(1))).toBe("wrong_composition");
    expect(
      validator.validate([
        ...validFleet,
        { x: 9, y: 5, length: 1, orientation: "horizontal" },
      ]),
    ).toBe("wrong_composition");
  });

  it("rejects ships outside the board", () => {
    const fleet = [...validFleet];
    fleet[0] = { x: 7, y: 0, length: 4, orientation: "horizontal" };
    expect(validator.validate(fleet)).toBe("out_of_bounds");
  });

  it("rejects overlapping ships", () => {
    const fleet = [...validFleet];
    fleet[9] = { x: 1, y: 0, length: 1, orientation: "horizontal" };
    expect(validator.validate(fleet)).toBe("overlap");
  });

  it("rejects ships touching, even diagonally", () => {
    const fleet = [...validFleet];
    fleet[9] = { x: 4, y: 1, length: 1, orientation: "horizontal" };
    expect(validator.validate(fleet)).toBe("touching");
  });

  it("random placement always produces a legal fleet", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const fleet = new RandomPlacement(new SeededRandom(seed)).place(
        classicRules,
      );
      expect(validator.validate(fleet)).toBeNull();
    }
  });
});

describe("turns and shots (TC-BS-02)", () => {
  it("starts the battle only when both fleets are placed", () => {
    const match = new Match("m1", ["alice", "bob"]);
    expect(match.placeFleet("alice", validFleet).map((e) => e.type)).toEqual([
      "fleet_placed",
    ]);
    const events = match.placeFleet("bob", validFleet);
    expect(events.map((e) => e.type)).toEqual([
      "fleet_placed",
      "battle_started",
    ]);
    expect(match.currentTurn).toBe("alice");
  });

  it("a hit keeps the turn, a miss passes it", () => {
    const match = newMatch();
    const hit = match.fire("alice", 0, 0);
    expect(hit[0]).toMatchObject({
      type: "shot",
      report: { outcome: "hit" },
      nextTurn: "alice",
    });
    const miss = match.fire("alice", 9, 5);
    expect(miss[0]).toMatchObject({
      report: { outcome: "miss" },
      nextTurn: "bob",
    });
  });

  it("sinking reveals the ship and marks the water around it", () => {
    const match = newMatch();
    const events = match.fire("alice", 9, 9);
    expect(events[0]).toMatchObject({
      report: { outcome: "sunk", ship: { x: 9, y: 9, length: 1 } },
      nextTurn: "alice",
    });
    const shot = events[0];
    if (shot?.type !== "shot") throw new Error("expected a shot event");
    expect(shot.report.revealed).toHaveLength(3);
    const target = match.viewFor("alice").target;
    expect(target?.cells[8]?.[8]).toBe("miss");
    rejects(() => match.fire("alice", 8, 8), "already_shot");
  });

  it("sinking the last ship wins", () => {
    const match = newMatch();
    let last: ReturnType<Match["fire"]> = [];
    for (const ship of validFleet) {
      for (let i = 0; i < ship.length; i++) {
        const x = ship.orientation === "horizontal" ? ship.x + i : ship.x;
        const y = ship.orientation === "vertical" ? ship.y + i : ship.y;
        last = match.fire("alice", x, y);
      }
    }
    expect(last.at(-1)).toMatchObject({
      type: "finished",
      winner: "alice",
      reason: "fleet_destroyed",
    });
    expect(match.currentPhase).toBe("finished");
  });
});

describe("hidden information (TC-BS-03)", () => {
  it("the opponent's view never contains live ships", () => {
    const match = newMatch();
    match.fire("alice", 0, 0);
    const view = match.viewFor("alice");
    const serialized = JSON.stringify(view.target);
    expect(view.target?.sunkShips).toEqual([]);
    expect(view.target?.cells[0]?.[1]).toBe("unknown");
    expect(serialized).not.toContain("orientation");
    expect(view.target?.remaining).toEqual([4, 3, 3, 2, 2, 2, 1, 1, 1, 1]);
  });
});

describe("rejected actions change nothing (TC-BS-04)", () => {
  it("rejects shots out of turn, repeated, outside the board or by strangers", () => {
    const match = newMatch();
    rejects(() => match.fire("bob", 0, 0), "not_your_turn");
    rejects(() => match.fire("carol", 0, 0), "not_a_player");
    rejects(() => match.fire("alice", 10, 0), "out_of_bounds");
    match.fire("alice", 9, 5);
    rejects(() => match.fire("bob", 20, 20), "out_of_bounds");
    match.fire("bob", 9, 5);
    rejects(() => match.fire("alice", 9, 5), "already_shot");
    expect(match.currentTurn).toBe("alice");
    expect(match.moveCount).toBe(2);
  });

  it("rejects actions in the wrong phase and a second fleet", () => {
    const match = new Match("m1", ["alice", "bob"]);
    rejects(() => match.fire("alice", 0, 0), "wrong_phase");
    match.placeFleet("alice", validFleet);
    rejects(
      () => match.placeFleet("alice", validFleet),
      "fleet_already_placed",
    );
    rejects(
      () => match.placeFleet("bob", validFleet.slice(2)),
      "wrong_composition",
    );
    expect(match.hasPlacedFleet("bob")).toBe(false);
  });
});

describe("timeouts and resignation", () => {
  it("three missed turns in a row forfeit", () => {
    const match = newMatch();
    expect(match.skipTurn("alice")[0]).toMatchObject({
      type: "turn_skipped",
      nextTurn: "bob",
    });
    match.skipTurn("bob");
    match.skipTurn("alice");
    match.fire("bob", 9, 5);
    const events = match.skipTurn("alice");
    expect(events[0]).toMatchObject({
      type: "finished",
      winner: "bob",
      reason: "timeout",
    });
  });

  it("a shot resets the missed-turn counter", () => {
    const match = newMatch();
    match.skipTurn("alice");
    match.fire("bob", 9, 5);
    match.fire("alice", 9, 5);
    match.skipTurn("bob");
    match.skipTurn("alice");
    match.skipTurn("bob");
    expect(match.currentPhase).toBe("battle");
  });

  it("running out of placement time forfeits on time", () => {
    const match = new Match("m1", ["alice", "bob"]);
    match.placeFleet("alice", validFleet);
    expect(match.timeOut("bob")[0]).toMatchObject({
      type: "finished",
      winner: "alice",
      loser: "bob",
      reason: "timeout",
    });
    expect(match.currentPhase).toBe("finished");
    rejects(() => match.timeOut("alice"), "wrong_phase");
    rejects(() => match.timeOut("carol"), "not_a_player");
  });

  it("only a player still without a fleet runs out of placement time", () => {
    const placing = new Match("m1", ["alice", "bob"]);
    placing.placeFleet("alice", validFleet);
    rejects(() => placing.timeOut("alice"), "fleet_already_placed");
    expect(placing.currentPhase).toBe("placement");
    // In battle the turn clock skips turns instead.
    const battle = newMatch();
    rejects(() => battle.timeOut("alice"), "wrong_phase");
    expect(battle.currentPhase).toBe("battle");
  });

  it("a fleet left missing tells a placement time-out from missed turns", () => {
    // Both end with reason "timeout"; the result screen words them apart by this.
    const placing = new Match("m1", ["alice", "bob"]);
    placing.placeFleet("alice", validFleet);
    placing.timeOut("bob");
    expect(placing.viewFor("bob")).toMatchObject({
      reason: "timeout",
      yourFleetPlaced: false,
    });
    expect(placing.viewFor("alice")).toMatchObject({
      reason: "timeout",
      opponentFleetPlaced: false,
    });
    const battle = newMatch();
    for (const player of ["alice", "bob", "alice", "bob", "alice"])
      battle.skipTurn(player);
    expect(battle.viewFor("alice")).toMatchObject({
      reason: "timeout",
      yourFleetPlaced: true,
      opponentFleetPlaced: true,
    });
  });

  it("resigning hands the win to the opponent", () => {
    const match = newMatch();
    expect(match.resign("bob")[0]).toMatchObject({
      winner: "alice",
      reason: "resigned",
    });
    rejects(() => match.resign("alice"), "wrong_phase");
  });
});

/** Plays one game between two bots on random fleets; returns the winner's name. */
function playOut(a: ShotStrategy, b: ShotStrategy, seed: number): "a" | "b" {
  const random = new SeededRandom(seed);
  const match = new Match(
    `sim-${seed}`,
    ["a", "b"],
    classicRules,
    seed % 2 === 0 ? "a" : "b",
  );
  match.placeFleet("a", new RandomPlacement(random).place(classicRules));
  match.placeFleet("b", new RandomPlacement(random).place(classicRules));
  for (let guard = 0; guard < 400 && match.currentPhase === "battle"; guard++) {
    const player = match.currentTurn as "a" | "b";
    const view = match.viewFor(player).target;
    if (!view) throw new Error("no target view in battle");
    const shot = (player === "a" ? a : b).next(view);
    expect(view.cells[shot.y]?.[shot.x]).toBe("unknown");
    match.fire(player, shot.x, shot.y);
  }
  const result = match.result;
  if (!result) throw new Error("game did not finish");
  return result.winner as "a" | "b";
}

function winRate(level: BotLevel, against: BotLevel, games: number): number {
  let wins = 0;
  for (let seed = 1; seed <= games; seed++) {
    const a = createBot(level, new SeededRandom(seed * 7919));
    const b = createBot(against, new SeededRandom(seed * 104729));
    if (playOut(a, b, seed) === "a") wins++;
  }
  return wins / games;
}

// Hundreds of full games: seconds locally, much longer on a busy CI runner.
describe("bot strength (TC-BS-05)", { timeout: 180_000 }, () => {
  it("expert beats easy in at least 95% of 200 games", () => {
    expect(winRate("expert", "easy", 200)).toBeGreaterThanOrEqual(0.95);
  });

  it("medium beats easy in at least 70% of 200 games", () => {
    expect(winRate("medium", "easy", 200)).toBeGreaterThanOrEqual(0.7);
  });

  it("hard beats medium more often than not", () => {
    expect(winRate("hard", "medium", 200)).toBeGreaterThan(0.5);
  });
});

describe("rating (TC-BS-07)", () => {
  const elo = new EloRating();

  it("is zero-sum and rewards upsets more", () => {
    const even = elo.exchange(
      { rating: 1000, matches: 5 },
      { rating: 1000, matches: 5 },
    );
    expect(even).toBe(16);
    const upset = elo.exchange(
      { rating: 900, matches: 50 },
      { rating: 1300, matches: 50 },
    );
    const expected = elo.exchange(
      { rating: 1300, matches: 50 },
      { rating: 900, matches: 50 },
    );
    expect(upset).toBeGreaterThan(expected);
    expect(upset).toBeLessThanOrEqual(16);
  });

  it("uses the provisional K while either player is new", () => {
    expect(
      elo.exchange(
        { rating: 1000, matches: 100 },
        { rating: 1000, matches: 3 },
      ),
    ).toBe(16);
    expect(
      elo.exchange(
        { rating: 1000, matches: 100 },
        { rating: 1000, matches: 100 },
      ),
    ).toBe(8);
  });
});
