import {
  classicRules,
  fleetLengths,
  placementCells,
  type ShipPlacement,
} from "@outegro/battleship-engine";
import type {
  GameErrorCode,
  MatchSnapshot,
  ServerMessage,
  ServerPayload,
} from "@outegro/contracts/battleship";
import { makeAutoObservable } from "mobx";
import type { MessageSender } from "../transport/game-socket";
import { realTimers, type Timers } from "../transport/timers";
import type { AnimationQueue } from "./animation-queue";
import type { Clock } from "./clock";
import type { PlacementStore } from "./placement-store";
import type { PreferencesStore } from "./preferences-store";
import { type SoundPlayer, silence } from "./sound";

export type Side = "you" | "opponent";
export type CellState = "unknown" | "miss" | "hit" | "sunk";
export type Opponent = MatchSnapshot["opponent"];
export type MatchMode = MatchSnapshot["mode"];
export type MatchPhase = MatchSnapshot["phase"];
export type FinishReason = NonNullable<MatchSnapshot["reason"]>;
export type AbortReason = ServerPayload<"match.aborted">["reason"];
export type RatingChange = NonNullable<
  ServerPayload<"match.finished">["rating"]
>;
export type OwnShip = ShipPlacement & {
  hits: { x: number; y: number }[];
  sunk: boolean;
};

export type EffectKind = "fire" | "miss" | "hit" | "sunk";
export type Effect = {
  id: number;
  board: "own" | "target";
  kind: EffectKind;
  x: number;
  y: number;
  ship?: ShipPlacement;
};

export type LastShot = {
  by: Side;
  x: number;
  y: number;
  outcome: "miss" | "hit" | "sunk";
};

export type Notice =
  | { kind: "turn_skipped"; side: Side; missedInRow: number }
  | { kind: "rejected"; code: GameErrorCode };

/** Animation lengths at full motion, in ms. */
export const timing = {
  tracer: 320,
  impact: 460,
  sink: 950,
  start: 520,
  turn: 380,
  finish: 700,
} as const;

/** Standard clocks (§16.6), for the countdown ring's full circle. */
export const clocks = { placementMs: 90_000, turnMs: 30_000 } as const;

const SIZE = classicRules.boardSize;
const emptyGrid = (): CellState[][] =>
  Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => "unknown" as CellState),
  );

export type MatchStoreDeps = {
  sender: MessageSender;
  clock: Clock;
  queue: AnimationQueue;
  preferences: PreferencesStore;
  placement: PlacementStore;
  connection: { readonly online: boolean };
  sound?: SoundPlayer;
  timers?: Timers;
};

/**
 * One match as this player sees it. A snapshot (`match.state`) replaces
 * everything; events apply incrementally through the animation queue, so
 * fast sequences animate in order. Shots are intents: the result is
 * whatever the server says, and a second shot waits for the first
 * (pending-shot guard).
 */
export class MatchStore {
  matchId: string | null = null;
  mode: MatchMode | null = null;
  rated = false;
  phase: MatchPhase | null = null;
  opponent: Opponent | null = null;
  turn: Side | null = null;
  deadline: string | null = null;
  winner: Side | null = null;
  reason: FinishReason | null = null;
  /**
   * The match ended without a result (no winner, no rating change): why,
   * or "unknown" when only a finished snapshot without a winner told us.
   */
  aborted: AbortReason | "unknown" | null = null;
  moves = 0;
  yourFleetPlaced = false;
  opponentFleetPlaced = false;
  opponentConnected = true;
  opponentGraceUntil: string | null = null;
  ownShips: OwnShip[] = [];
  ownShots: CellState[][] = emptyGrid();
  targetCells: CellState[][] = emptyGrid();
  sunkShips: ShipPlacement[] = [];
  remaining: number[] = fleetLengths(classicRules);
  opponentFleet: ShipPlacement[] | null = null;
  rating: RatingChange | null = null;
  pendingShot: { x: number; y: number; seq: number } | null = null;
  resignSeq: number | null = null;
  syncSeq: number | null = null;
  effects: Effect[] = [];
  lastShot: LastShot | null = null;
  /**
   * The side on turn shoots again: its latest shot hit or sank a ship (a
   * miss, a skipped turn or a fresh snapshot ends that).
   */
  shootsAgain = false;
  notice: Notice | null = null;
  /** The server no longer has the match we were playing (lost while away). */
  endedWhileAway = false;
  private effectId = 0;
  private shotTimer: unknown = null;
  private readonly timers: Timers;
  private readonly sound: SoundPlayer;

  constructor(private readonly deps: MatchStoreDeps) {
    this.timers = deps.timers ?? realTimers;
    this.sound = deps.sound ?? silence;
    makeAutoObservable<
      MatchStore,
      "deps" | "effectId" | "shotTimer" | "timers" | "sound"
    >(
      this,
      {
        deps: false,
        effectId: false,
        shotTimer: false,
        timers: false,
        sound: false,
      },
      { autoBind: true },
    );
  }

  get active(): boolean {
    return this.matchId !== null && this.phase !== "finished";
  }

  get finished(): boolean {
    return this.phase === "finished";
  }

  get isYourTurn(): boolean {
    return this.phase === "battle" && this.turn === "you";
  }

  get animating(): boolean {
    return this.deps.queue.busy;
  }

  get canFire(): boolean {
    return (
      this.isYourTurn &&
      this.pendingShot === null &&
      !this.deps.queue.busy &&
      this.deps.connection.online
    );
  }

  /** Remaining time of the current clock, ticking while observed. */
  get msLeft(): number | null {
    return this.deps.clock.msUntil(this.deadline);
  }

  get secondsLeft(): number | null {
    const ms = this.msLeft;
    return ms === null ? null : Math.ceil(ms / 1000);
  }

  /** Full length of the running clock, for the ring. */
  get clockTotalMs(): number {
    return this.phase === "placement" ? clocks.placementMs : clocks.turnMs;
  }

  get graceSecondsLeft(): number | null {
    const ms = this.deps.clock.msUntil(this.opponentGraceUntil);
    return ms === null ? null : Math.ceil(ms / 1000);
  }

  get won(): boolean | null {
    return this.winner === null ? null : this.winner === "you";
  }

  get shipsSunkByYou(): number {
    return this.sunkShips.length;
  }

  get shipsLost(): number {
    return this.ownShips.filter((ship) => ship.sunk).length;
  }

  get hitsByYou(): number {
    let hits = 0;
    for (const row of this.targetCells)
      for (const cell of row) if (cell === "hit" || cell === "sunk") hits++;
    return hits;
  }

  /** The bot level to offer again after the match. */
  get botLevel(): "easy" | "medium" | "hard" | "expert" | null {
    return this.opponent?.kind === "bot" ? this.opponent.level : null;
  }

  canTarget(x: number, y: number): boolean {
    return this.canFire && this.targetCells[y]?.[x] === "unknown";
  }

  /** Fires at a cell of the target board; false when the guard refuses. */
  fire(x: number, y: number): boolean {
    if (!this.canTarget(x, y)) return false;
    const seq = this.deps.sender.send("shot.fire", { x, y });
    if (seq === null) return false;
    this.pendingShot = { x, y, seq };
    this.notice = null;
    this.sound.play("fire");
    // The tracer flies while the server answers; the result plays after it.
    this.deps.queue.push({
      duration: this.deps.preferences.duration(timing.tracer),
      run: () => this.addEffect("target", "fire", x, y),
    });
    // A lost answer must not freeze the board: ask for a fresh snapshot.
    this.clearShotTimer();
    this.shotTimer = this.timers.setTimeout(() => {
      this.shotTimer = null;
      if (this.pendingShot?.seq === seq) this.sync();
    }, 8000);
    return true;
  }

  resign(): void {
    if (!this.active || this.resignSeq !== null) return;
    this.resignSeq = this.deps.sender.send("match.resign", {});
  }

  /** Asks the server for a full snapshot of the active match. */
  sync(): void {
    this.syncSeq = this.deps.sender.send("match.sync", {});
  }

  dismissNotice(): void {
    this.notice = null;
  }

  /** Clears a finished match (back to the lobby). */
  leave(): void {
    if (this.active) return;
    this.deps.queue.clear();
    this.clearShotTimer();
    this.matchId = null;
    this.phase = null;
    this.aborted = null;
    this.endedWhileAway = false;
    this.syncSeq = null;
    this.effects = [];
    this.notice = null;
  }

  /**
   * The session came back without the match we were in, or the match ended
   * before this tab got its first snapshot.
   */
  markEndedWhileAway(): void {
    if (this.finished) return;
    this.deps.queue.clear();
    this.clearShotTimer();
    this.pendingShot = null;
    this.endedWhileAway = true;
  }

  handle(message: ServerMessage): void {
    switch (message.type) {
      case "match.state":
        this.applySnapshot(message.payload.match);
        return;
      case "fleet.placed": {
        const { side } = message.payload;
        this.enqueue(0, () => {
          if (side === "opponent") {
            this.opponentFleetPlaced = true;
            return;
          }
          this.yourFleetPlaced = true;
          // The server accepted exactly the fleet we sent: show it in our waters.
          if (this.ownShips.length === 0) {
            this.ownShips = this.deps.placement.fleet.map((ship) => ({
              x: ship.x,
              y: ship.y,
              length: ship.length,
              orientation: ship.orientation,
              hits: [],
              sunk: false,
            }));
            this.ownShots = emptyGrid();
          }
        });
        return;
      }
      case "match.started": {
        const { turn, deadline } = message.payload;
        this.enqueue(timing.start, () => {
          this.phase = "battle";
          this.yourFleetPlaced = true;
          this.opponentFleetPlaced = true;
          this.turn = turn;
          this.deadline = deadline;
          this.shootsAgain = false;
          if (turn === "you") this.sound.play("turn");
        });
        return;
      }
      case "shot.result":
        this.receiveShot(message.payload);
        return;
      case "turn.skipped": {
        const { side, missedInRow, nextTurn, deadline } = message.payload;
        this.enqueue(timing.turn, () => {
          this.notice = { kind: "turn_skipped", side, missedInRow };
          this.turn = nextTurn;
          this.deadline = deadline;
          this.shootsAgain = false;
          if (nextTurn === "you") this.sound.play("turn");
        });
        return;
      }
      case "opponent.presence":
        this.opponentConnected = message.payload.connected;
        this.opponentGraceUntil = message.payload.connected
          ? null
          : message.payload.graceUntil;
        return;
      case "match.finished": {
        const payload = message.payload;
        this.clearShotTimer();
        this.pendingShot = null;
        this.enqueue(timing.finish, () => {
          this.phase = "finished";
          this.turn = null;
          this.deadline = null;
          this.shootsAgain = false;
          this.winner = payload.winner;
          this.reason = payload.reason;
          this.rating = payload.rating;
          this.opponentFleet = payload.opponentFleet;
          this.opponentConnected = true;
          this.opponentGraceUntil = null;
          this.resignSeq = null;
          this.sound.play(payload.winner === "you" ? "win" : "lose");
        });
        return;
      }
      case "match.aborted": {
        const { reason } = message.payload;
        this.clearShotTimer();
        this.pendingShot = null;
        this.enqueue(timing.finish, () => {
          this.phase = "finished";
          this.turn = null;
          this.deadline = null;
          this.shootsAgain = false;
          this.winner = null;
          this.reason = null;
          this.rating = null;
          this.aborted = reason;
          this.opponentConnected = true;
          this.opponentGraceUntil = null;
          this.resignSeq = null;
        });
        return;
      }
      case "error":
        this.receiveError(message.payload.code, message.payload.ref);
        return;
      default:
        return;
    }
  }

  private receiveShot(payload: ServerPayload<"shot.result">): void {
    const { by, x, y, outcome, ship, revealed, nextTurn, deadline } = payload;
    if (by === "you") {
      if (this.pendingShot?.x === x && this.pendingShot.y === y) {
        this.pendingShot = null;
        this.clearShotTimer();
      }
    } else {
      // The opponent's shell flies in before it lands.
      this.enqueue(timing.tracer, () => this.addEffect("own", "fire", x, y));
    }
    this.enqueue(outcome === "sunk" ? timing.sink : timing.impact, () => {
      if (by === "you") this.markTarget(x, y, outcome, ship, revealed);
      else this.markOwn(x, y, outcome, revealed);
      this.addEffect(by === "you" ? "target" : "own", outcome, x, y, ship);
      this.lastShot = { by, x, y, outcome };
      this.moves++;
      const turnChanged = nextTurn !== this.turn;
      this.shootsAgain = outcome !== "miss" && nextTurn === by;
      this.turn = nextTurn;
      this.deadline = deadline;
      this.sound.play(outcome);
      if (turnChanged && nextTurn === "you") this.sound.play("turn");
    });
  }

  private receiveError(code: GameErrorCode, ref: number | null): void {
    if (ref !== null && ref === this.pendingShot?.seq) {
      this.pendingShot = null;
      this.clearShotTimer();
      this.notice = { kind: "rejected", code };
      // Our picture of the match was off: take the server's.
      if (code !== "rate_limited") this.sync();
      return;
    }
    if (ref !== null && ref === this.resignSeq) {
      this.resignSeq = null;
      this.notice = { kind: "rejected", code };
      return;
    }
    if (ref !== null && ref === this.syncSeq) {
      this.syncSeq = null;
      if (code === "no_active_match") this.markEndedWhileAway();
    }
  }

  private applySnapshot(match: MatchSnapshot): void {
    const isNew = match.matchId !== this.matchId;
    this.deps.queue.clear();
    this.clearShotTimer();
    this.effects = [];
    this.pendingShot = null;
    this.resignSeq = null;
    this.syncSeq = null;
    this.endedWhileAway = false;
    // A snapshot does not say how the turn came about.
    this.shootsAgain = false;
    if (isNew) {
      this.deps.placement.reset();
      this.rating = null;
      this.lastShot = null;
      this.notice = null;
    }
    this.matchId = match.matchId;
    this.mode = match.mode;
    this.rated = match.rated;
    this.phase = match.phase;
    this.opponent = match.opponent;
    this.turn = match.turn;
    this.deadline = match.deadline;
    this.winner = match.winner;
    this.reason = match.reason;
    this.aborted =
      match.phase === "finished" && match.winner === null ? "unknown" : null;
    this.moves = match.moves;
    this.yourFleetPlaced = match.yourFleetPlaced;
    this.opponentFleetPlaced = match.opponentFleetPlaced;
    this.opponentConnected = match.opponentConnected;
    if (match.opponentConnected) this.opponentGraceUntil = null;
    this.ownShips = (match.own?.ships ?? []).map((ship) => ({
      x: ship.x,
      y: ship.y,
      length: ship.length,
      orientation: ship.orientation,
      hits: ship.hits.map((hit) => ({ ...hit })),
      sunk: ship.sunk,
    }));
    this.ownShots = match.own
      ? match.own.shots.map((row) => [...row])
      : emptyGrid();
    this.targetCells = match.target
      ? match.target.cells.map((row) => [...row])
      : emptyGrid();
    this.sunkShips = (match.target?.sunkShips ?? []).map((ship) => ({
      ...ship,
    }));
    this.remaining = match.target
      ? [...match.target.remaining]
      : fleetLengths(classicRules);
    this.opponentFleet = match.opponentFleet;
    this.deps.placement.syncFromSnapshot(match);
  }

  private markTarget(
    x: number,
    y: number,
    outcome: LastShot["outcome"],
    ship: ShipPlacement | undefined,
    revealed: { x: number; y: number }[],
  ): void {
    const row = this.targetCells[y];
    if (row) row[x] = outcome === "sunk" ? "sunk" : outcome;
    if (outcome === "sunk" && ship) {
      for (const cell of placementCells(ship)) {
        const cells = this.targetCells[cell.y];
        if (cells) cells[cell.x] = "sunk";
      }
      this.sunkShips.push({ ...ship });
      const index = this.remaining.indexOf(ship.length);
      if (index >= 0) this.remaining.splice(index, 1);
    }
    for (const cell of revealed) {
      const cells = this.targetCells[cell.y];
      if (cells && cells[cell.x] === "unknown") cells[cell.x] = "miss";
    }
  }

  private markOwn(
    x: number,
    y: number,
    outcome: LastShot["outcome"],
    revealed: { x: number; y: number }[],
  ): void {
    const row = this.ownShots[y];
    if (outcome === "miss") {
      if (row) row[x] = "miss";
    } else {
      const ship = this.ownShips.find((item) =>
        placementCells(item).some((cell) => cell.x === x && cell.y === y),
      );
      if (ship && !ship.hits.some((hit) => hit.x === x && hit.y === y)) {
        ship.hits.push({ x, y });
      }
      if (outcome === "sunk" && ship) {
        ship.sunk = true;
        for (const cell of placementCells(ship)) {
          const cells = this.ownShots[cell.y];
          if (cells) cells[cell.x] = "sunk";
        }
      } else if (row) {
        row[x] = "hit";
      }
    }
    for (const cell of revealed) {
      const cells = this.ownShots[cell.y];
      if (cells && cells[cell.x] === "unknown") cells[cell.x] = "miss";
    }
  }

  private enqueue(fullMs: number, run: () => void): void {
    this.deps.queue.push({
      duration: this.deps.preferences.duration(fullMs),
      run,
    });
  }

  private addEffect(
    board: Effect["board"],
    kind: EffectKind,
    x: number,
    y: number,
    ship?: ShipPlacement,
  ): void {
    const id = ++this.effectId;
    this.effects.push({ id, board, kind, x, y, ...(ship ? { ship } : {}) });
    const lifetime =
      kind === "fire"
        ? timing.tracer
        : kind === "sunk"
          ? timing.sink + 400
          : timing.impact + 500;
    this.timers.setTimeout(
      () => this.removeEffect(id),
      this.deps.preferences.duration(lifetime) + 50,
    );
  }

  removeEffect(id: number): void {
    const index = this.effects.findIndex((effect) => effect.id === id);
    if (index >= 0) this.effects.splice(index, 1);
  }

  private clearShotTimer(): void {
    if (this.shotTimer !== null) this.timers.clearTimeout(this.shotTimer);
    this.shotTimer = null;
  }
}
