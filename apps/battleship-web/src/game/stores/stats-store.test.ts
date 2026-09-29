import type { Leaderboard } from "@outegro/contracts/battleship";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MatchReplay, type MatchSummary, StatsStore } from "./stats-store";

const board = (period: "all" | "week", names: string[]): Leaderboard => ({
  period,
  since: period === "week" ? "2026-09-28T00:00:00.000Z" : null,
  items: names.map((nickname, i) => ({
    rank: i + 1,
    nickname,
    rating: 1200 - i * 10,
    wins: 10 - i,
    matches: 12,
    premium: i === 0,
  })),
  you: null,
});

const summary = (n: number): MatchSummary => ({
  matchId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  mode: "bot",
  opponent: { kind: "bot", level: "easy" },
  result: n % 2 ? "win" : "loss",
  reason: "fleet_destroyed",
  moves: 40 + n,
  ratingDelta: null,
  finishedAt: "2026-09-29T10:00:00.000Z",
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("StatsStore", () => {
  it("loads the weekly board once, on first switch", async () => {
    const leaderboard = vi.fn(async () => board("week", ["Nemo"]));
    const stats = new StatsStore(
      { leaderboard, matches: vi.fn() },
      { board: board("all", ["Ahab", "Nemo"]) },
    );
    expect(stats.board?.items).toHaveLength(2);
    await stats.selectPeriod("week");
    expect(stats.board?.items.map((item) => item.nickname)).toEqual(["Nemo"]);
    await stats.selectPeriod("all");
    await stats.selectPeriod("week");
    expect(leaderboard).toHaveBeenCalledTimes(1);
  });

  it("shows an error state when the board cannot load", async () => {
    const stats = new StatsStore(
      {
        leaderboard: vi.fn(async () => Promise.reject(new Error("down"))),
        matches: vi.fn(),
      },
      { board: board("all", []) },
    );
    await stats.selectPeriod("week");
    expect(stats.boardState).toBe("error");
    expect(stats.board).toBeNull();
  });

  it("pages the match history with the cursor", async () => {
    const matches = vi.fn(async (cursor: string | null) =>
      cursor === "c2"
        ? { items: [summary(3), summary(4)], nextCursor: null }
        : { items: [], nextCursor: null },
    );
    const stats = new StatsStore(
      { leaderboard: vi.fn(), matches },
      { history: { items: [summary(1), summary(2)], nextCursor: "c2" } },
    );
    await stats.loadMore();
    expect(matches).toHaveBeenCalledWith("c2");
    expect(stats.history).toHaveLength(4);
    expect(stats.nextCursor).toBeNull();
    await stats.loadMore();
    expect(matches).toHaveBeenCalledTimes(1);
  });
});

describe("ReplayCursor", () => {
  const replay: MatchReplay = {
    matchId: "00000000-0000-4000-8000-000000000001",
    mode: "bot",
    opponent: { kind: "bot", level: "medium" },
    winner: "you",
    reason: "resigned",
    fleets: {
      you: [
        { x: 0, y: 0, length: 4, orientation: "horizontal" },
        { x: 0, y: 2, length: 3, orientation: "horizontal" },
        { x: 5, y: 2, length: 3, orientation: "horizontal" },
        { x: 0, y: 4, length: 2, orientation: "horizontal" },
        { x: 3, y: 4, length: 2, orientation: "horizontal" },
        { x: 6, y: 4, length: 2, orientation: "horizontal" },
        { x: 0, y: 6, length: 1, orientation: "horizontal" },
        { x: 2, y: 6, length: 1, orientation: "horizontal" },
        { x: 4, y: 6, length: 1, orientation: "horizontal" },
        { x: 6, y: 6, length: 1, orientation: "horizontal" },
      ],
      opponent: [
        { x: 9, y: 0, length: 4, orientation: "vertical" },
        { x: 0, y: 9, length: 3, orientation: "horizontal" },
        { x: 4, y: 9, length: 3, orientation: "horizontal" },
        { x: 0, y: 0, length: 2, orientation: "vertical" },
        { x: 2, y: 0, length: 2, orientation: "vertical" },
        { x: 4, y: 0, length: 2, orientation: "vertical" },
        { x: 9, y: 9, length: 1, orientation: "horizontal" },
        { x: 9, y: 7, length: 1, orientation: "horizontal" },
        { x: 6, y: 5, length: 1, orientation: "horizontal" },
        { x: 3, y: 5, length: 1, orientation: "horizontal" },
      ],
    },
    moves: [
      { n: 1, by: "you", x: 9, y: 9, outcome: "sunk" },
      { n: 2, by: "you", x: 5, y: 5, outcome: "miss" },
      { n: 3, by: "opponent", x: 0, y: 0, outcome: "hit" },
    ],
    startedAt: "2026-09-29T10:00:00.000Z",
    finishedAt: "2026-09-29T10:05:00.000Z",
  };

  it("rebuilds both boards at every step", () => {
    const stats = new StatsStore({ leaderboard: vi.fn(), matches: vi.fn() });
    const cursor = stats.openReplay(replay);
    expect(cursor.total).toBe(3);
    expect(cursor.theirs.cells[9]?.[9]).toBe("unknown");
    cursor.next();
    expect(cursor.current?.n).toBe(1);
    expect(cursor.theirs.cells[9]?.[9]).toBe("sunk");
    // Water around the sunk ship is known, as in play.
    expect(cursor.theirs.cells[8]?.[8]).toBe("miss");
    cursor.last();
    expect(cursor.yours.cells[0]?.[0]).toBe("hit");
    expect(cursor.yours.ships[0]?.hits).toEqual([{ x: 0, y: 0 }]);
    cursor.first();
    expect(cursor.step).toBe(0);
  });

  it("plays and stops at the last move", () => {
    const stats = new StatsStore({ leaderboard: vi.fn(), matches: vi.fn() });
    const cursor = stats.openReplay(replay);
    cursor.toggle();
    expect(cursor.playing).toBe(true);
    vi.advanceTimersByTime(700 * 3);
    expect(cursor.step).toBe(3);
    expect(cursor.playing).toBe(false);
  });

  it("tells a fleet never deployed from missed turns: its record is empty", () => {
    const stats = new StatsStore({ leaderboard: vi.fn(), matches: vi.fn() });
    const undeployed: MatchReplay = {
      ...replay,
      reason: "timeout",
      fleets: { you: replay.fleets.you, opponent: [] },
      moves: [],
    };
    expect(stats.openReplay(undeployed).reason).toBe("deploy_timeout");
    expect(stats.openReplay({ ...replay, reason: "timeout" }).reason).toBe(
      "timeout",
    );
    expect(stats.openReplay(replay).reason).toBe("resigned");
  });
});
