import type {
  FinishReason,
  Match,
  MatchEvent,
  ShipPlacement,
} from "@outegro/battleship-engine";
import type { MatchSnapshot } from "@outegro/contracts/battleship";
import type { RatingChange } from "../rating.js";
import { playerIdOf, sideOfPlayer } from "./seats.js";
import {
  type MatchRecord,
  type Outgoing,
  otherSide,
  type SideKey,
} from "./types.js";

type Side = "you" | "opponent";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Plain placement without extra fields (the engine may hand richer objects). */
const placement = (ship: ShipPlacement): ShipPlacement => ({
  x: ship.x,
  y: ship.y,
  length: ship.length,
  orientation: ship.orientation,
});

export type SnapshotContext = {
  readonly deadline: Date | null;
  readonly opponentConnected: boolean;
  /** The opponent's fleet, revealed only once the match is over. */
  readonly opponentFleet: readonly ShipPlacement[] | null;
};

/**
 * Turns engine events and views into the messages one side receives: players
 * are "you" and "opponent", user ids never appear, and the opponent's live
 * ships are never included (TC-BS-03). The connection validates every
 * message against the contract before sending it.
 */
export class SideProjector {
  constructor(private readonly record: MatchRecord) {}

  private side(viewer: SideKey, subject: SideKey): Side {
    return viewer === subject ? "you" : "opponent";
  }

  private sideOf(viewer: SideKey, player: string): Side {
    return this.side(viewer, sideOfPlayer(this.record, player));
  }

  /** A message for everything but `finished` (see `finished`). */
  event(
    viewer: SideKey,
    event: MatchEvent,
    deadline: Date | null,
  ): Outgoing | null {
    switch (event.type) {
      case "fleet_placed":
        return {
          type: "fleet.placed",
          payload: { side: this.sideOf(viewer, event.player) },
        };
      case "battle_started":
        return {
          type: "match.started",
          payload: {
            turn: this.sideOf(viewer, event.turn),
            deadline: iso(deadline),
          },
        };
      case "shot": {
        const { report } = event;
        return {
          type: "shot.result",
          payload: {
            by: this.sideOf(viewer, event.by),
            x: report.x,
            y: report.y,
            outcome: report.outcome,
            ...(report.ship ? { ship: placement(report.ship) } : {}),
            revealed: report.revealed.map((cell) => ({ x: cell.x, y: cell.y })),
            nextTurn: event.nextTurn
              ? this.sideOf(viewer, event.nextTurn)
              : null,
            deadline: event.nextTurn ? iso(deadline) : null,
          },
        };
      }
      case "turn_skipped":
        return {
          type: "turn.skipped",
          payload: {
            side: this.sideOf(viewer, event.player),
            missedInRow: event.missedInRow,
            nextTurn: this.sideOf(viewer, event.nextTurn),
            deadline: iso(deadline),
          },
        };
      case "finished":
        return null;
    }
  }

  finished(
    viewer: SideKey,
    winner: SideKey,
    reason: FinishReason,
    rating: RatingChange | null,
    opponentFleet: readonly ShipPlacement[],
  ): Outgoing {
    return {
      type: "match.finished",
      payload: {
        winner: this.side(viewer, winner),
        reason,
        rating: rating
          ? { before: rating.before, after: rating.after, delta: rating.delta }
          : null,
        opponentFleet: opponentFleet.map(placement),
      },
    };
  }

  presence(connected: boolean, graceUntil: Date | null): Outgoing {
    return {
      type: "opponent.presence",
      payload: { connected, graceUntil: iso(graceUntil) },
    };
  }

  /** The full picture one side may know; sent on join, reconnect and sync. */
  snapshot(viewer: SideKey, match: Match, context: SnapshotContext): Outgoing {
    const view = match.viewFor(playerIdOf(this.record, viewer));
    const opponentSeat = this.record.seats[otherSide(viewer)];
    const snapshot: MatchSnapshot = {
      matchId: this.record.id,
      mode: this.record.mode,
      rated: this.record.rated,
      phase: view.phase,
      opponent:
        opponentSeat.kind === "bot"
          ? { kind: "bot", level: opponentSeat.level }
          : {
              kind: "human",
              nickname: opponentSeat.nickname,
              rating: opponentSeat.rating,
              premium: opponentSeat.premium,
            },
      turn: view.turn ? this.sideOf(viewer, view.turn) : null,
      deadline: iso(context.deadline),
      winner: view.winner ? this.sideOf(viewer, view.winner) : null,
      reason: view.reason,
      moves: view.moves,
      yourFleetPlaced: view.yourFleetPlaced,
      opponentFleetPlaced: view.opponentFleetPlaced,
      opponentConnected: context.opponentConnected,
      own: view.own
        ? {
            size: view.own.size,
            ships: view.own.ships.map((ship) => ({
              ...placement(ship),
              hits: ship.hits.map((cell) => ({ x: cell.x, y: cell.y })),
              sunk: ship.sunk,
            })),
            shots: view.own.shots.map((row) => [...row]),
          }
        : null,
      target: view.target
        ? {
            size: view.target.size,
            cells: view.target.cells.map((row) => [...row]),
            sunkShips: view.target.sunkShips.map(placement),
            remaining: [...view.target.remaining],
          }
        : null,
      opponentFleet:
        view.phase === "finished" && context.opponentFleet
          ? context.opponentFleet.map(placement)
          : null,
    };
    return { type: "match.state", payload: { match: snapshot } };
  }
}
