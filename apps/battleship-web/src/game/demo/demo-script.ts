import {
  classicRules,
  outlineOf,
  placementCells,
  type ShipPlacement,
} from "@outegro/battleship-engine";

/**
 * The battle on the home page, as data: one fleet, ten shots in order, the
 * fleet surfacing at the end. The static board (shop previews, reduced
 * motion, the server render) is the last frame of the same script, so the
 * still picture and the loop can never drift apart.
 */

export type DemoOutcome = "miss" | "hit" | "sunk";
export type DemoShot = { x: number; y: number; outcome: DemoOutcome };
export type DemoPhase = "hold" | "reset" | "aim" | "fire" | "land";
export type DemoBeat = {
  phase: DemoPhase;
  /** The shot being aimed, fired or landing. */
  shot: number | null;
  /** How long the beat lasts at full motion. */
  ms: number;
};

export type DemoMark = {
  x: number;
  y: number;
  kind: DemoOutcome;
  /** Stagger of the dots that ring a ship just sunk (ms). */
  delay: number;
};

export type DemoShipView = {
  ship: ShipPlacement;
  /** Above water: a sunk ship once found, the whole fleet at rest. */
  shown: boolean;
  wreck: boolean;
  /** Just revealed by the shot that sank it: plays the sinking. */
  sinking: boolean;
};

export type DemoFrame = {
  phase: DemoPhase;
  marks: DemoMark[];
  ships: DemoShipView[];
  /** Where the sight is; `aiming` says whether it shows. */
  aim: { x: number; y: number } | null;
  aiming: boolean;
  effect: { kind: "fire" | DemoOutcome; x: number; y: number } | null;
};

export const demoFleet: readonly ShipPlacement[] = [
  { x: 1, y: 1, length: 4, orientation: "horizontal" },
  { x: 7, y: 0, length: 3, orientation: "vertical" },
  { x: 0, y: 4, length: 3, orientation: "vertical" },
  { x: 3, y: 4, length: 2, orientation: "horizontal" },
  { x: 7, y: 5, length: 2, orientation: "vertical" },
  { x: 2, y: 8, length: 2, orientation: "horizontal" },
  { x: 9, y: 9, length: 1, orientation: "horizontal" },
  { x: 5, y: 7, length: 1, orientation: "horizontal" },
  { x: 9, y: 3, length: 1, orientation: "horizontal" },
  { x: 5, y: 9, length: 1, orientation: "horizontal" },
];

/** Misses, two hits on the battleship, a destroyer found and sunk. */
export const demoShots: readonly DemoShot[] = [
  { x: 5, y: 0, outcome: "miss" },
  { x: 2, y: 1, outcome: "hit" },
  { x: 3, y: 1, outcome: "hit" },
  { x: 6, y: 3, outcome: "miss" },
  { x: 3, y: 4, outcome: "hit" },
  { x: 4, y: 4, outcome: "sunk" },
  { x: 3, y: 6, outcome: "miss" },
  { x: 7, y: 5, outcome: "hit" },
  { x: 8, y: 8, outcome: "miss" },
  { x: 0, y: 9, outcome: "miss" },
];

export const demoTiming = {
  hold: 3600,
  reset: 1500,
  aim: 460,
  fire: 320,
  land: { miss: 640, hit: 760, sunk: 1500 },
  /** Delay before the first dot around a sunk ship, then per dot. */
  ringStart: 420,
  ringStep: 45,
} as const;

/** Beat 0 is the full picture; the loop runs 0 → last → 0. */
export const demoBeats: readonly DemoBeat[] = [
  { phase: "hold", shot: null, ms: demoTiming.hold },
  { phase: "reset", shot: null, ms: demoTiming.reset },
  ...demoShots.flatMap((shot, index): DemoBeat[] => [
    { phase: "aim", shot: index, ms: demoTiming.aim },
    { phase: "fire", shot: index, ms: demoTiming.fire },
    { phase: "land", shot: index, ms: demoTiming.land[shot.outcome] },
  ]),
];

const key = (x: number, y: number) => `${x},${y}`;

const shipIndexAt = new Map<string, number>(
  demoFleet.flatMap((ship, index) =>
    placementCells(ship).map((cell) => [cell.key, index] as const),
  ),
);

/** For each ship, the index of the shot that sinks it (if any). */
const sunkBy = new Map<number, number>(
  demoShots.flatMap((shot, index) => {
    const ship = shipIndexAt.get(key(shot.x, shot.y));
    return shot.outcome === "sunk" && ship !== undefined
      ? [[ship, index] as const]
      : [];
  }),
);

/** The water around a ship, clockwise from the top left, for the ripple. */
function ringOf(ship: ShipPlacement): { x: number; y: number }[] {
  const cells = placementCells(ship);
  const cx = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
  const cy = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
  // Screen angles grow clockwise; start just above the left end.
  const turn = (x: number, y: number) =>
    (Math.atan2(y - cy, x - cx) + Math.PI * (2 + 8 / 9)) % (Math.PI * 2);
  return outlineOf(cells, classicRules.boardSize)
    .map((cell) => ({ x: cell.x, y: cell.y }))
    .sort((a, b) => turn(a.x, a.y) - turn(b.x, b.y));
}

/** How many shots have left their mark at a beat. */
function landedAt(beat: DemoBeat): number {
  if (beat.phase === "hold" || beat.phase === "reset") return demoShots.length;
  const shot = beat.shot ?? 0;
  return beat.phase === "land" ? shot + 1 : shot;
}

/** What the board shows at a beat (0 = the full, still picture). */
export function demoFrame(index: number): DemoFrame {
  const beat = demoBeats[index] ?? demoBeats[0];
  if (!beat) throw new Error("the demo has no beats");
  const landed = landedAt(beat);
  const sunkShips = new Set(
    [...sunkBy].filter(([, shot]) => shot < landed).map(([ship]) => ship),
  );
  const justSunk =
    beat.phase === "land" && beat.shot !== null
      ? [...sunkBy].find(([, shot]) => shot === beat.shot)?.[0]
      : undefined;

  const marks: DemoMark[] = demoShots.slice(0, landed).map((shot) => {
    const ship = shipIndexAt.get(key(shot.x, shot.y));
    const kind: DemoOutcome =
      shot.outcome === "miss"
        ? "miss"
        : ship !== undefined && sunkShips.has(ship)
          ? "sunk"
          : "hit";
    return { x: shot.x, y: shot.y, kind, delay: 0 };
  });
  for (const ship of sunkShips) {
    const placement = demoFleet[ship];
    if (!placement) continue;
    ringOf(placement).forEach((cell, order) => {
      marks.push({
        ...cell,
        kind: "miss",
        delay:
          ship === justSunk
            ? demoTiming.ringStart + order * demoTiming.ringStep
            : 0,
      });
    });
  }

  const resting = beat.phase === "hold";
  const ships = demoFleet.map((ship, index): DemoShipView => {
    const wreck = sunkShips.has(index);
    const shown = resting || (beat.phase !== "reset" && wreck);
    return {
      ship,
      shown,
      wreck,
      sinking: shown && wreck && !resting,
    };
  });

  const current = beat.shot !== null ? (demoShots[beat.shot] ?? null) : null;
  return {
    phase: beat.phase,
    marks,
    ships,
    aim: current ? { x: current.x, y: current.y } : null,
    aiming: beat.phase === "aim" || beat.phase === "fire",
    effect:
      current && beat.phase === "fire"
        ? { kind: "fire", x: current.x, y: current.y }
        : current && beat.phase === "land"
          ? { kind: current.outcome, x: current.x, y: current.y }
          : null,
  };
}
