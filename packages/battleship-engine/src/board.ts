import { Coordinate } from "./coordinate.js";
import type { Fleet } from "./fleet.js";
import type { GameRules } from "./rules.js";
import type { ShipPlacement } from "./ship.js";

export type ShotOutcome = "miss" | "hit" | "sunk";

/** What a player knows about a cell of the opponent's board. */
export type CellState = "unknown" | "miss" | "hit" | "sunk";

export type ShotError = "out_of_bounds" | "already_shot";

export class ShotRejected extends Error {
  constructor(readonly code: ShotError) {
    super(`Shot rejected: ${code}`);
  }
}

/** Result of one shot. Ship positions appear only once a ship is sunk. */
export type ShotReport = {
  readonly x: number;
  readonly y: number;
  readonly outcome: ShotOutcome;
  /** The sunk ship, revealed. */
  readonly ship?: ShipPlacement;
  /** Cells around a sunk ship, now known to be empty. */
  readonly revealed: readonly { x: number; y: number }[];
};

/**
 * The opponent's view of a board: fired cells and sunk ships, never live ship
 * positions (TC-BS-03). Plain data: this is what goes over the wire.
 */
export type TargetView = {
  readonly size: number;
  /** cells[y][x] */
  readonly cells: readonly (readonly CellState[])[];
  readonly sunkShips: readonly ShipPlacement[];
  /** Lengths of ships still afloat, longest first. */
  readonly remaining: readonly number[];
};

/** The owner's view: own ships (with hits) and every shot received. */
export type OwnView = {
  readonly size: number;
  readonly ships: readonly (ShipPlacement & {
    readonly hits: readonly { x: number; y: number }[];
    readonly sunk: boolean;
  })[];
  readonly shots: readonly (readonly CellState[])[];
};

/** A player's own waters: the fleet plus every shot the opponent fired. */
export class OceanBoard {
  private readonly marks = new Map<string, CellState>();

  constructor(
    readonly fleet: Fleet,
    private readonly rules: GameRules,
  ) {}

  get defeated(): boolean {
    return this.fleet.defeated;
  }

  /** Whether a cell can still be fired at. */
  canTarget(cell: Coordinate): boolean {
    return cell.inside(this.rules.boardSize) && !this.marks.has(cell.key);
  }

  /** Resolves a shot or throws ShotRejected; a rejected shot changes nothing (TC-BS-04). */
  receive(cell: Coordinate): ShotReport {
    if (!cell.inside(this.rules.boardSize))
      throw new ShotRejected("out_of_bounds");
    if (this.marks.has(cell.key)) throw new ShotRejected("already_shot");

    const ship = this.fleet.shipAt(cell);
    if (!ship) {
      this.marks.set(cell.key, "miss");
      return { x: cell.x, y: cell.y, outcome: "miss", revealed: [] };
    }
    ship.hit(cell);
    if (!ship.sunk) {
      this.marks.set(cell.key, "hit");
      return { x: cell.x, y: cell.y, outcome: "hit", revealed: [] };
    }
    for (const own of ship.cells) this.marks.set(own.key, "sunk");
    // Ships never touch, so the outline of a sunk ship is known water (TC-BS-02).
    const revealed = this.rules.shipsMayTouch
      ? []
      : ship
          .outline(this.rules.boardSize)
          .filter((around) => !this.marks.has(around.key));
    for (const around of revealed) this.marks.set(around.key, "miss");
    return {
      x: cell.x,
      y: cell.y,
      outcome: "sunk",
      ship: ship.placement,
      revealed: revealed.map((around) => around.toJSON()),
    };
  }

  targetView(): TargetView {
    const size = this.rules.boardSize;
    return {
      size,
      cells: this.grid((cell) => this.marks.get(cell.key) ?? "unknown"),
      sunkShips: this.fleet.ships
        .filter((ship) => ship.sunk)
        .map((ship) => ship.placement),
      remaining: this.fleet.remainingLengths(),
    };
  }

  ownView(): OwnView {
    return {
      size: this.rules.boardSize,
      ships: this.fleet.ships.map((ship) => ({
        ...ship.placement,
        hits: ship.cells
          .filter((cell) => ship.isHitAt(cell))
          .map((cell) => cell.toJSON()),
        sunk: ship.sunk,
      })),
      shots: this.grid((cell) => this.marks.get(cell.key) ?? "unknown"),
    };
  }

  private grid(state: (cell: Coordinate) => CellState): CellState[][] {
    const size = this.rules.boardSize;
    return Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => state(Coordinate.of(x, y))),
    );
  }
}
