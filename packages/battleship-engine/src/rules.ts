/** How many ships of one length a fleet has. */
export type ShipClass = { readonly length: number; readonly count: number };

/**
 * The rules a match is played by. A new variant implements this interface;
 * the engine itself does not change (open/closed).
 */
export interface GameRules {
  readonly boardSize: number;
  readonly fleet: readonly ShipClass[];
  /** Ships may touch each other, even diagonally. */
  readonly shipsMayTouch: boolean;
  /** A hit (or sinking) grants another shot. */
  readonly extraShotOnHit: boolean;
  /** Missed turns in a row that forfeit the match. */
  readonly maxMissedTurns: number;
}

/** Classic rules: 10×10, 1×4, 2×3, 3×2, 4×1, ships never touch. */
export const classicRules: GameRules = Object.freeze({
  boardSize: 10,
  fleet: Object.freeze([
    { length: 4, count: 1 },
    { length: 3, count: 2 },
    { length: 2, count: 3 },
    { length: 1, count: 4 },
  ]),
  shipsMayTouch: false,
  extraShotOnHit: true,
  maxMissedTurns: 3,
});

/** Every ship length of the fleet, longest first. */
export function fleetLengths(rules: GameRules): number[] {
  return rules.fleet
    .flatMap((shipClass) =>
      Array<number>(shipClass.count).fill(shipClass.length),
    )
    .sort((a, b) => b - a);
}
