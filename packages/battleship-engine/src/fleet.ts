import type { Coordinate } from "./coordinate.js";
import { pick, type Random } from "./random.js";
import { fleetLengths, type GameRules } from "./rules.js";
import {
  type Orientation,
  outlineOf,
  placementCells,
  Ship,
  type ShipPlacement,
} from "./ship.js";

export type FleetError =
  | "wrong_composition"
  | "out_of_bounds"
  | "overlap"
  | "touching";

export class FleetValidationError extends Error {
  constructor(readonly code: FleetError) {
    super(`Invalid fleet: ${code}`);
  }
}

/** Checks a proposed fleet against the rules (TC-BS-01). */
export class FleetValidator {
  constructor(private readonly rules: GameRules) {}

  /** The first rule the fleet breaks, or null when it is valid. */
  validate(placements: readonly ShipPlacement[]): FleetError | null {
    const expected = fleetLengths(this.rules);
    const actual = placements.map((p) => p.length).sort((a, b) => b - a);
    if (
      expected.length !== actual.length ||
      expected.some((length, i) => length !== actual[i])
    ) {
      return "wrong_composition";
    }
    const size = this.rules.boardSize;
    const ships = placements.map((placement, i) => new Ship(i, placement));
    if (ships.some((ship) => ship.cells.some((cell) => !cell.inside(size)))) {
      return "out_of_bounds";
    }
    const owner = new Map<string, number>();
    for (const ship of ships) {
      for (const cell of ship.cells) {
        if (owner.has(cell.key)) return "overlap";
        owner.set(cell.key, ship.id);
      }
    }
    if (!this.rules.shipsMayTouch) {
      for (const ship of ships) {
        for (const cell of ship.outline(size)) {
          const other = owner.get(cell.key);
          if (other !== undefined && other !== ship.id) return "touching";
        }
      }
    }
    return null;
  }
}

/** A validated fleet on its owner's board. */
export class Fleet {
  private constructor(readonly ships: readonly Ship[]) {}

  /** Builds a fleet or throws FleetValidationError. */
  static create(placements: readonly ShipPlacement[], rules: GameRules): Fleet {
    const error = new FleetValidator(rules).validate(placements);
    if (error) throw new FleetValidationError(error);
    return new Fleet(placements.map((placement, i) => new Ship(i, placement)));
  }

  shipAt(cell: Coordinate): Ship | undefined {
    return this.ships.find((ship) => ship.occupies(cell));
  }

  get defeated(): boolean {
    return this.ships.every((ship) => ship.sunk);
  }

  /** Lengths of ships still afloat, longest first. */
  remainingLengths(): number[] {
    return this.ships
      .filter((ship) => !ship.sunk)
      .map((ship) => ship.length)
      .sort((a, b) => b - a);
  }

  placements(): ShipPlacement[] {
    return this.ships.map((ship) => ship.placement);
  }
}

/** How a fleet gets placed; the manual editor and "random" both end as placements. */
export interface PlacementStrategy {
  place(rules: GameRules): ShipPlacement[];
}

/**
 * Uniform random placement. For each ship (longest first) it enumerates every
 * legal position left and picks one, so it never loops on crowded boards.
 */
export class RandomPlacement implements PlacementStrategy {
  constructor(private readonly random: Random) {}

  place(rules: GameRules): ShipPlacement[] {
    for (let attempt = 0; attempt < 100; attempt++) {
      const fleet = this.tryPlace(rules);
      if (fleet) return fleet;
    }
    throw new Error("Could not place the fleet with these rules");
  }

  private tryPlace(rules: GameRules): ShipPlacement[] | null {
    const size = rules.boardSize;
    const blocked = new Set<string>();
    const placed: ShipPlacement[] = [];
    for (const length of fleetLengths(rules)) {
      const options = this.legalPlacements(length, size, blocked);
      if (options.length === 0) return null;
      const choice = pick(this.random, options);
      placed.push(choice);
      const cells = placementCells(choice);
      for (const cell of cells) blocked.add(cell.key);
      if (!rules.shipsMayTouch) {
        for (const cell of outlineOf(cells, size)) blocked.add(cell.key);
      }
    }
    return placed;
  }

  private legalPlacements(
    length: number,
    size: number,
    blocked: ReadonlySet<string>,
  ): ShipPlacement[] {
    const orientations: Orientation[] =
      length === 1 ? ["horizontal"] : ["horizontal", "vertical"];
    const options: ShipPlacement[] = [];
    for (const orientation of orientations) {
      const maxX = orientation === "horizontal" ? size - length : size - 1;
      const maxY = orientation === "vertical" ? size - length : size - 1;
      for (let x = 0; x <= maxX; x++) {
        for (let y = 0; y <= maxY; y++) {
          const placement = { x, y, length, orientation };
          if (
            placementCells(placement).every((cell) => !blocked.has(cell.key))
          ) {
            options.push(placement);
          }
        }
      }
    }
    return options;
  }
}
