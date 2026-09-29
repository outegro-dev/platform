import type { CellState, TargetView } from "../board.js";
import { Coordinate } from "../coordinate.js";

export const botLevels = ["easy", "medium", "hard", "expert"] as const;
export type BotLevel = (typeof botLevels)[number];

/**
 * Chooses the next shot. A bot sees exactly what a human would: the opponent's
 * TargetView, never the hidden fleet.
 */
export interface ShotStrategy {
  readonly level: BotLevel;
  next(view: TargetView): Coordinate;
}

export function stateAt(view: TargetView, cell: Coordinate): CellState | null {
  if (!cell.inside(view.size)) return null;
  return view.cells[cell.y]?.[cell.x] ?? null;
}

export function cellsWhere(view: TargetView, state: CellState): Coordinate[] {
  const cells: Coordinate[] = [];
  for (let y = 0; y < view.size; y++) {
    for (let x = 0; x < view.size; x++) {
      if (view.cells[y]?.[x] === state) cells.push(Coordinate.of(x, y));
    }
  }
  return cells;
}

export function unknownCells(view: TargetView): Coordinate[] {
  return cellsWhere(view, "unknown");
}

/** Hit cells whose ship is not sunk yet. */
export function openHits(view: TargetView): Coordinate[] {
  return cellsWhere(view, "hit");
}
