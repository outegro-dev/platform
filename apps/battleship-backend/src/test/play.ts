import type { ShipPlacement } from "@outegro/battleship-engine";
import { cellsOf, fleets, waterOf } from "./fixtures.js";
import type { Harness } from "./harness.js";

export type Player = Awaited<ReturnType<Harness["connect"]>>;
export type Cell = { x: number; y: number };

/** A private room between two new players, both looking at the new match. */
export async function room(h: Harness) {
  const a = await h.connect();
  const b = await h.connect();
  a.send("room.create", {});
  const { code } = (await a.next("room.created")).payload;
  b.send("room.join", { code });
  const stateA = (await a.next("match.state")).payload.match;
  const stateB = (await b.next("match.state")).payload.match;
  return { a, b, matchId: stateA.matchId, stateA, stateB };
}

/** Both fleets placed (a: fleets.a, b: fleets.b); who shoots first and at what. */
export async function battle(a: Player, b: Player) {
  a.send("fleet.place", { ships: fleets.a });
  b.send("fleet.place", { ships: fleets.b });
  const turn = (await a.next("match.started")).payload.turn;
  await b.next("match.started");
  return turn === "you"
    ? { first: a, second: b, firstTargets: fleets.b, secondTargets: fleets.a }
    : { first: b, second: a, firstTargets: fleets.a, secondTargets: fleets.b };
}

/** A shot and the result as both players see it. */
export async function fire(shooter: Player, other: Player, cell: Cell) {
  shooter.send("shot.fire", cell);
  const mine = await shooter.next("shot.result", (m) => m.payload.by === "you");
  const theirs = await other.next(
    "shot.result",
    (m) => m.payload.by === "opponent",
  );
  return { mine: mine.payload, theirs: theirs.payload };
}

export async function snapshot(player: Player) {
  player.send("match.sync", {});
  return (await player.next("match.state")).payload.match;
}

/** Water no sunk-ship outline can reach: safe misses for the whole match. */
export function farWater(fleet: readonly ShipPlacement[]): Cell[] {
  const near = new Set<string>();
  for (const cell of cellsOf(fleet))
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        near.add(`${cell.x + dx},${cell.y + dy}`);
  return waterOf(fleet).filter((cell) => !near.has(`${cell.x},${cell.y}`));
}
