import {
  classicRules,
  Match,
  type MatchEvent,
  type PlayerId,
} from "@outegro/battleship-engine";
import {
  BOT_ID,
  type MatchAction,
  type MatchRecord,
  SIDES,
  type SideKey,
} from "./types.js";

/** Engine player id of a side: the user id, or BOT_ID. */
export function playerIdOf(record: MatchRecord, side: SideKey): PlayerId {
  const seat = record.seats[side];
  return seat.kind === "human" ? seat.userId : BOT_ID;
}

export function sideOfPlayer(record: MatchRecord, player: PlayerId): SideKey {
  const side = SIDES.find((s) => playerIdOf(record, s) === player);
  if (!side) throw new Error(`${player} does not play match ${record.id}`);
  return side;
}

/** The side of a human participant, or null for anyone else. */
export function sideOfUser(
  record: MatchRecord,
  userId: string,
): SideKey | null {
  return (
    SIDES.find((side) => {
      const seat = record.seats[side];
      return seat.kind === "human" && seat.userId === userId;
    }) ?? null
  );
}

export function userIdOf(record: MatchRecord, side: SideKey): string | null {
  const seat = record.seats[side];
  return seat.kind === "human" ? seat.userId : null;
}

/** Applies one logged action through the engine; the engine decides. */
export function applyAction(
  match: Match,
  record: MatchRecord,
  action: MatchAction,
): MatchEvent[] {
  const player = playerIdOf(record, action.side);
  switch (action.kind) {
    case "place":
      return match.placeFleet(player, action.ships);
    case "shot":
      return match.fire(player, action.x, action.y);
    case "skip":
      return match.skipTurn(player);
    case "timeout":
      return match.timeOut(player);
    case "resign":
      return match.resign(player);
    case "abandon":
      return match.abandon(player);
  }
}

/** Rebuilds the engine state by replaying stored actions (recovery, rollback). */
export function replay(
  record: MatchRecord,
  actions: readonly MatchAction[],
): Match {
  const match = new Match(
    record.id,
    [playerIdOf(record, "a"), playerIdOf(record, "b")],
    classicRules,
    playerIdOf(record, record.firstTurn),
  );
  for (const action of actions) applyAction(match, record, action);
  return match;
}
