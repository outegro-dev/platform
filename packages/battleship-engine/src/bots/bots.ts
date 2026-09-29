import type { TargetView } from "../board.js";
import type { Coordinate } from "../coordinate.js";
import { pick, type Random } from "../random.js";
import { type BotLevel, type ShotStrategy, unknownCells } from "./strategy.js";
import { TargetingPolicy } from "./targeting.js";

/** Easy: random shots at cells not tried yet. */
export class RandomShots implements ShotStrategy {
  readonly level: BotLevel = "easy";

  constructor(private readonly random: Random) {}

  next(view: TargetView): Coordinate {
    return pick(this.random, unknownCells(view));
  }
}

/** Medium: random hunting, then finishes wounded ships along their line. */
export class HuntAndTarget implements ShotStrategy {
  readonly level: BotLevel = "medium";
  private readonly targeting = new TargetingPolicy();

  constructor(private readonly random: Random) {}

  next(view: TargetView): Coordinate {
    const finishing = this.targeting.candidates(view);
    return pick(
      this.random,
      finishing.length > 0 ? finishing : unknownCells(view),
    );
  }
}

/**
 * Hard: hunts on a lattice spaced by the smallest ship still afloat (a ship
 * of length n always covers one lattice cell), then finishes like medium.
 */
export class ParityHunter implements ShotStrategy {
  readonly level: BotLevel = "hard";
  private readonly targeting = new TargetingPolicy();
  private readonly offset: number;

  constructor(private readonly random: Random) {
    this.offset = Math.floor(random.next() * 4);
  }

  next(view: TargetView): Coordinate {
    const finishing = this.targeting.candidates(view);
    if (finishing.length > 0) return pick(this.random, finishing);
    const spacing = Math.max(1, Math.min(...view.remaining));
    const unknown = unknownCells(view);
    const lattice = unknown.filter(
      (cell) => (cell.x + cell.y + this.offset) % spacing === 0,
    );
    return pick(this.random, lattice.length > 0 ? lattice : unknown);
  }
}

/**
 * Expert: counts every position each floating ship could still occupy given
 * all misses, hits and sunk ships, and fires at the most probable cell.
 * Positions through wounded cells weigh far more, so it also finishes ships.
 */
export class ProbabilityHunter implements ShotStrategy {
  readonly level: BotLevel = "expert";

  constructor(private readonly random: Random) {}

  next(view: TargetView): Coordinate {
    const scores = this.density(view);
    let best = -1;
    let bestCells: Coordinate[] = [];
    for (const cell of unknownCells(view)) {
      const score = scores[cell.y * view.size + cell.x] ?? 0;
      if (score > best) {
        best = score;
        bestCells = [cell];
      } else if (score === best) {
        bestCells.push(cell);
      }
    }
    return pick(this.random, bestCells);
  }

  /** Scores per cell, indexed y * size + x. Runs on every shot, so it stays allocation-light. */
  private density(view: TargetView): Float64Array {
    const flat = view.cells.flat();
    const wounded = flat.includes("hit");
    const scores = new Float64Array(view.size * view.size);
    const copies = new Map<number, number>();
    for (const length of view.remaining)
      copies.set(length, (copies.get(length) ?? 0) + 1);
    for (const [length, count] of copies) {
      for (const cells of positionsOf(view.size, length)) {
        let hits = 0;
        let possible = true;
        for (const index of cells) {
          const state = flat[index];
          if (state === "miss" || state === "sunk" || state === undefined) {
            possible = false;
            break;
          }
          if (state === "hit") hits++;
        }
        if (!possible || (wounded && hits === 0)) continue;
        const weight = count * (hits > 0 ? 50 ** hits : 1);
        for (const index of cells) {
          if (flat[index] === "unknown")
            scores[index] = (scores[index] ?? 0) + weight;
        }
      }
    }
    return scores;
  }
}

const positionCache = new Map<string, readonly (readonly number[])[]>();

/** Every straight position of a ship as flat cell indexes, computed once per board size. */
function positionsOf(size: number, length: number) {
  const key = `${size}:${length}`;
  let positions = positionCache.get(key);
  if (!positions) {
    const list: number[][] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x + length <= size)
          list.push(Array.from({ length }, (_, i) => y * size + x + i));
        if (length > 1 && y + length <= size)
          list.push(Array.from({ length }, (_, i) => (y + i) * size + x));
      }
    }
    positions = list;
    positionCache.set(key, positions);
  }
  return positions;
}

/** The strategy for a difficulty level. */
export function createBot(level: BotLevel, random: Random): ShotStrategy {
  switch (level) {
    case "easy":
      return new RandomShots(random);
    case "medium":
      return new HuntAndTarget(random);
    case "hard":
      return new ParityHunter(random);
    case "expert":
      return new ProbabilityHunter(random);
  }
}
