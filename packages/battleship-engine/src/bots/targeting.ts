import type { TargetView } from "../board.js";
import type { Coordinate } from "../coordinate.js";
import { openHits, stateAt } from "./strategy.js";

/** Groups of orthogonally connected hits; with no-touch rules each group is one ship. */
export function hitClusters(view: TargetView): Coordinate[][] {
  const hits = openHits(view);
  const remaining = new Map(hits.map((hit) => [hit.key, hit]));
  const clusters: Coordinate[][] = [];
  for (const start of hits) {
    if (!remaining.has(start.key)) continue;
    const cluster: Coordinate[] = [];
    const queue = [start];
    remaining.delete(start.key);
    while (queue.length > 0) {
      const cell = queue.shift() as Coordinate;
      cluster.push(cell);
      for (const next of cell.orthogonal()) {
        const hit = remaining.get(next.key);
        if (hit) {
          remaining.delete(hit.key);
          queue.push(hit);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/**
 * Finishing a wounded ship: once two hits line up, continue along the line;
 * with a single hit, try its four neighbours. Empty when nothing is wounded.
 */
export class TargetingPolicy {
  candidates(view: TargetView): Coordinate[] {
    for (const cluster of hitClusters(view)) {
      const found = this.forCluster(view, cluster);
      if (found.length > 0) return found;
    }
    return [];
  }

  private forCluster(view: TargetView, cluster: Coordinate[]): Coordinate[] {
    const isUnknown = (cell: Coordinate) => stateAt(view, cell) === "unknown";
    if (cluster.length >= 2) {
      const horizontal = cluster.every(
        (cell) => cell.y === (cluster[0] as Coordinate).y,
      );
      const sorted = [...cluster].sort((a, b) =>
        horizontal ? a.x - b.x : a.y - b.y,
      );
      const first = sorted[0] as Coordinate;
      const last = sorted[sorted.length - 1] as Coordinate;
      const ends = horizontal
        ? [first.orthogonal()[1], last.orthogonal()[0]]
        : [first.orthogonal()[3], last.orthogonal()[2]];
      const line = ends.filter(
        (cell): cell is Coordinate => !!cell && isUnknown(cell),
      );
      if (line.length > 0) return line;
    }
    return cluster.flatMap((cell) => cell.orthogonal()).filter(isUnknown);
  }
}
