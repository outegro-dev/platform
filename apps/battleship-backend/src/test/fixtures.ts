import type { ShipPlacement } from "@outegro/battleship-engine";

/** Two legal classic fleets that share no ship cells. */
export const fleets = {
  a: [
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
  ],
  b: [
    { x: 9, y: 0, length: 4, orientation: "vertical" },
    { x: 7, y: 0, length: 3, orientation: "vertical" },
    { x: 0, y: 9, length: 3, orientation: "horizontal" },
    { x: 4, y: 9, length: 2, orientation: "horizontal" },
    { x: 7, y: 8, length: 2, orientation: "horizontal" },
    { x: 0, y: 6, length: 2, orientation: "vertical" },
    { x: 2, y: 2, length: 1, orientation: "horizontal" },
    { x: 4, y: 2, length: 1, orientation: "horizontal" },
    { x: 2, y: 4, length: 1, orientation: "horizontal" },
    { x: 4, y: 5, length: 1, orientation: "horizontal" },
  ],
} satisfies Record<string, ShipPlacement[]>;

/** Every cell a fleet covers. */
export function cellsOf(fleet: readonly ShipPlacement[]) {
  return fleet.flatMap((ship) =>
    Array.from({ length: ship.length }, (_, i) =>
      ship.orientation === "horizontal"
        ? { x: ship.x + i, y: ship.y }
        : { x: ship.x, y: ship.y + i },
    ),
  );
}

/** Cells a fleet does not cover: guaranteed misses. */
export function waterOf(fleet: readonly ShipPlacement[]) {
  const taken = new Set(cellsOf(fleet).map((c) => `${c.x},${c.y}`));
  const water: { x: number; y: number }[] = [];
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++)
      if (!taken.has(`${x},${y}`)) water.push({ x, y });
  return water;
}
