import {
  Coordinate,
  classicRules,
  Fleet,
  OceanBoard,
  placementCells,
  type ShipPlacement,
} from "@outegro/battleship-engine";
import type {
  Leaderboard,
  matchReplaySchema,
  matchSummarySchema,
  PlayerStats,
} from "@outegro/contracts/battleship";
import { makeAutoObservable, runInAction } from "mobx";
import type { z } from "zod";
import { realTimers, type Timers } from "../transport/timers";
import {
  type CellState,
  type OwnShip,
  type ResultReason,
  resultReasonOf,
} from "./match-store";

export type Period = Leaderboard["period"];
export type MatchSummary = z.infer<typeof matchSummarySchema>;
export type MatchReplay = z.infer<typeof matchReplaySchema>;
export type HistoryPage = { items: MatchSummary[]; nextCursor: string | null };

/** Reads the stats pages need (BFF routes in the app, stubs in tests). */
export interface StatsApi {
  leaderboard(period: Period): Promise<Leaderboard>;
  matches(cursor: string | null): Promise<HistoryPage>;
}

type LoadState = "idle" | "loading" | "error";

/**
 * Leaderboard (all time / this week), personal stats, match history with a
 * cursor, and the replay viewer. Pages render the first data on the server;
 * the store takes over for tab switches, "load more" and stepping.
 */
export class StatsStore {
  period: Period;
  boards: Partial<Record<Period, Leaderboard>> = {};
  boardState: LoadState = "idle";
  stats: PlayerStats | null;
  history: MatchSummary[];
  nextCursor: string | null;
  historyState: LoadState = "idle";
  replay: ReplayCursor | null = null;

  constructor(
    private readonly api: StatsApi,
    initial: {
      period?: Period;
      board?: Leaderboard | null;
      stats?: PlayerStats | null;
      history?: HistoryPage | null;
    } = {},
  ) {
    this.period = initial.board?.period ?? initial.period ?? "all";
    if (initial.board) this.boards[initial.board.period] = initial.board;
    this.stats = initial.stats ?? null;
    this.history = initial.history?.items ?? [];
    this.nextCursor = initial.history?.nextCursor ?? null;
    makeAutoObservable<StatsStore, "api">(
      this,
      { api: false },
      { autoBind: true },
    );
  }

  get board(): Leaderboard | null {
    return this.boards[this.period] ?? null;
  }

  async selectPeriod(period: Period): Promise<void> {
    this.period = period;
    if (!this.boards[period]) await this.reloadBoard();
  }

  async reloadBoard(): Promise<void> {
    const period = this.period;
    this.boardState = "loading";
    try {
      const board = await this.api.leaderboard(period);
      runInAction(() => {
        this.boards[period] = board;
        this.boardState = "idle";
      });
    } catch {
      runInAction(() => {
        this.boardState = "error";
      });
    }
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.historyState === "loading") return;
    this.historyState = "loading";
    try {
      const page = await this.api.matches(this.nextCursor);
      runInAction(() => {
        const known = new Set(this.history.map((item) => item.matchId));
        this.history.push(
          ...page.items.filter((item) => !known.has(item.matchId)),
        );
        this.nextCursor = page.nextCursor;
        this.historyState = "idle";
      });
    } catch {
      runInAction(() => {
        this.historyState = "error";
      });
    }
  }

  openReplay(replay: MatchReplay, timers: Timers = realTimers): ReplayCursor {
    this.replay?.dispose();
    this.replay = new ReplayCursor(replay, timers);
    return this.replay;
  }
}

type BoardView = { ships: OwnShip[]; cells: CellState[][] };

/**
 * Steps through a finished match with both fleets revealed. Boards at any
 * step are rebuilt from the recorded shots with the engine's OceanBoard, so
 * sunk ships and their surrounding water look exactly as they did in play.
 */
export class ReplayCursor {
  step: number;
  playing = false;
  private timer: unknown = null;

  constructor(
    readonly replay: MatchReplay,
    private readonly timers: Timers = realTimers,
    private readonly intervalMs = 700,
  ) {
    this.step = 0;
    makeAutoObservable<ReplayCursor, "timer" | "timers" | "intervalMs">(
      this,
      { replay: false, timer: false, timers: false, intervalMs: false },
      { autoBind: true },
    );
  }

  get total(): number {
    return this.replay.moves.length;
  }

  get current(): MatchReplay["moves"][number] | null {
    return this.step > 0 ? (this.replay.moves[this.step - 1] ?? null) : null;
  }

  /** Why the match ended; a fleet never deployed is empty in the record. */
  get reason(): ResultReason {
    const { reason, fleets } = this.replay;
    return resultReasonOf(
      reason,
      fleets.you.length > 0 && fleets.opponent.length > 0,
    );
  }

  /** Your waters: your fleet and the opponent's shots so far. */
  get yours(): BoardView {
    return boardAt(
      this.replay.fleets.you,
      this.replay.moves
        .slice(0, this.step)
        .filter((move) => move.by === "opponent"),
    );
  }

  /** Their waters: their fleet (revealed) and your shots so far. */
  get theirs(): BoardView {
    return boardAt(
      this.replay.fleets.opponent,
      this.replay.moves.slice(0, this.step).filter((move) => move.by === "you"),
    );
  }

  seek(step: number): void {
    this.step = Math.max(0, Math.min(this.total, Math.round(step)));
    if (this.step === this.total) this.pause();
  }

  next(): void {
    this.seek(this.step + 1);
  }

  prev(): void {
    this.seek(this.step - 1);
  }

  first(): void {
    this.pause();
    this.seek(0);
  }

  last(): void {
    this.seek(this.total);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.step >= this.total) this.step = 0;
    this.playing = true;
    this.stopTimer();
    this.timer = this.timers.setInterval(() => this.next(), this.intervalMs);
  }

  pause(): void {
    this.playing = false;
    this.stopTimer();
  }

  dispose(): void {
    this.pause();
  }

  private stopTimer(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
  }
}

function boardAt(
  fleet: readonly ShipPlacement[],
  shots: readonly { x: number; y: number }[],
): BoardView {
  try {
    const board = new OceanBoard(
      Fleet.create(fleet, classicRules),
      classicRules,
    );
    for (const shot of shots) {
      const cell = Coordinate.of(shot.x, shot.y);
      if (board.canTarget(cell)) board.receive(cell);
    }
    const view = board.ownView();
    return {
      ships: view.ships.map((ship) => ({
        x: ship.x,
        y: ship.y,
        length: ship.length,
        orientation: ship.orientation,
        hits: ship.hits.map((hit) => ({ ...hit })),
        sunk: ship.sunk,
      })),
      cells: view.shots.map((row) => [...row]),
    };
  } catch {
    // A record the engine does not accept still shows its shots.
    const cells: CellState[][] = Array.from(
      { length: classicRules.boardSize },
      () =>
        Array.from(
          { length: classicRules.boardSize },
          () => "unknown" as CellState,
        ),
    );
    const occupied = new Set(
      fleet.flatMap((ship) => placementCells(ship).map((cell) => cell.key)),
    );
    for (const shot of shots) {
      const row = cells[shot.y];
      if (row)
        row[shot.x] = occupied.has(`${shot.x},${shot.y}`) ? "hit" : "miss";
    }
    return {
      ships: fleet.map((ship) => ({ ...ship, hits: [], sunk: false })),
      cells,
    };
  }
}
