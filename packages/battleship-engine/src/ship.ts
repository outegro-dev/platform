import { Coordinate } from "./coordinate.js";

export type Orientation = "horizontal" | "vertical";

/** Where a ship lies: its first cell, length and direction. Plain data, safe to send. */
export type ShipPlacement = {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly orientation: Orientation;
};

/** Cells covered by a placement, in order from the first cell. */
export function placementCells(placement: ShipPlacement): Coordinate[] {
  return Array.from({ length: placement.length }, (_, i) =>
    placement.orientation === "horizontal"
      ? Coordinate.of(placement.x + i, placement.y)
      : Coordinate.of(placement.x, placement.y + i),
  );
}

/** Cells around a group of cells (for the no-touch rule and sunk outlines), inside the board. */
export function outlineOf(
  cells: readonly Coordinate[],
  size: number,
): Coordinate[] {
  const own = new Set(cells.map((cell) => cell.key));
  const around = new Map<string, Coordinate>();
  for (const cell of cells) {
    for (const neighbour of cell.around()) {
      if (neighbour.inside(size) && !own.has(neighbour.key)) {
        around.set(neighbour.key, neighbour);
      }
    }
  }
  return [...around.values()];
}

/** One ship of a fleet and the hits it has taken. */
export class Ship {
  readonly cells: readonly Coordinate[];
  private readonly hits = new Set<string>();

  constructor(
    readonly id: number,
    readonly placement: ShipPlacement,
  ) {
    this.cells = placementCells(placement);
  }

  get length(): number {
    return this.placement.length;
  }

  get sunk(): boolean {
    return this.hits.size === this.length;
  }

  occupies(cell: Coordinate): boolean {
    return this.cells.some((own) => own.equals(cell));
  }

  isHitAt(cell: Coordinate): boolean {
    return this.hits.has(cell.key);
  }

  /** Registers a hit; false when the cell is not part of this ship. */
  hit(cell: Coordinate): boolean {
    if (!this.occupies(cell)) return false;
    this.hits.add(cell.key);
    return true;
  }

  outline(size: number): Coordinate[] {
    return outlineOf(this.cells, size);
  }
}
