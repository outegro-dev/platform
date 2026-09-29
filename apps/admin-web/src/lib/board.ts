/**
 * Plain board state for the match viewer: a 10×10 grid of ships and shots
 * after the first `step` moves. Shots by side "a" land on board "b" and the
 * other way round; a ship is sunk once every one of its cells is hit.
 */

export type Placement = {
  x: number;
  y: number;
  length: number;
  orientation: "horizontal" | "vertical";
};
export type Shot = {
  n: number;
  side: "a" | "b";
  x: number | null;
  y: number | null;
  outcome: "miss" | "hit" | "sunk" | "skip";
};
export type CellShot = "miss" | "hit" | "sunk" | null;
/** `id` is the coordinate players use ("E5"). */
export type Cell = { id: string; ship: boolean; shot: CellShot; last: boolean };
export type Board = Cell[][];

export const BOARD_SIZE = 10;

export function shipCells(ship: Placement): { x: number; y: number }[] {
  return Array.from({ length: ship.length }, (_, index) =>
    ship.orientation === "horizontal"
      ? { x: ship.x + index, y: ship.y }
      : { x: ship.x, y: ship.y + index },
  );
}

const inside = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;

/** Board of `owner` after `step` moves: its fleet and the opponent's shots. */
export function boardAt(
  owner: "a" | "b",
  fleet: readonly Placement[] | null,
  moves: readonly Shot[],
  step: number,
): Board {
  const board: Board = Array.from({ length: BOARD_SIZE }, (_, y) =>
    Array.from({ length: BOARD_SIZE }, (_, x) => ({
      id: `${String.fromCharCode(65 + x)}${y + 1}`,
      ship: false,
      shot: null as CellShot,
      last: false,
    })),
  );
  for (const ship of fleet ?? []) {
    for (const { x, y } of shipCells(ship)) {
      const cell = board[y]?.[x];
      if (cell) cell.ship = true;
    }
  }
  const played = moves.slice(0, Math.max(0, step));
  const shooter = owner === "a" ? "b" : "a";
  for (const move of played) {
    if (move.side !== shooter || move.x === null || move.y === null) continue;
    if (!inside(move.x, move.y)) continue;
    const cell = board[move.y]?.[move.x];
    if (!cell) continue;
    // Without a fleet (not revealed) the recorded outcome is all we know.
    cell.shot = fleet
      ? cell.ship
        ? "hit"
        : "miss"
      : move.outcome === "miss"
        ? "miss"
        : "hit";
  }
  for (const ship of fleet ?? []) {
    const cells = shipCells(ship).filter(({ x, y }) => inside(x, y));
    if (
      cells.length > 0 &&
      cells.every(({ x, y }) => board[y]?.[x]?.shot === "hit")
    ) {
      for (const { x, y } of cells) {
        const cell = board[y]?.[x];
        if (cell) cell.shot = "sunk";
      }
    }
  }
  const last = played.at(-1);
  if (last && last.side === shooter && last.x !== null && last.y !== null) {
    const cell = board[last.y]?.[last.x];
    if (cell) cell.last = true;
  }
  return board;
}

/** Ships still afloat on a board, for the caption ("7 of 10 afloat"). */
export function afloat(
  fleet: readonly Placement[] | null,
  board: Board,
): number {
  return (fleet ?? []).filter(
    (ship) =>
      !shipCells(ship).every(({ x, y }) => board[y]?.[x]?.shot === "sunk"),
  ).length;
}
