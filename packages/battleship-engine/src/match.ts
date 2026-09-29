import {
  OceanBoard,
  type OwnView,
  type ShotError,
  ShotRejected,
  type ShotReport,
  type TargetView,
} from "./board.js";
import { Coordinate } from "./coordinate.js";
import { Fleet, type FleetError, FleetValidationError } from "./fleet.js";
import { classicRules, type GameRules } from "./rules.js";
import type { ShipPlacement } from "./ship.js";

export type PlayerId = string;
export type MatchPhase = "placement" | "battle" | "finished";
export type FinishReason =
  | "fleet_destroyed"
  | "resigned"
  | "timeout"
  | "disconnected";

export type MatchEvent =
  | { readonly type: "fleet_placed"; readonly player: PlayerId }
  | { readonly type: "battle_started"; readonly turn: PlayerId }
  | {
      readonly type: "shot";
      readonly by: PlayerId;
      readonly report: ShotReport;
      /** null when the shot ended the match. */
      readonly nextTurn: PlayerId | null;
    }
  | {
      readonly type: "turn_skipped";
      readonly player: PlayerId;
      readonly missedInRow: number;
      readonly nextTurn: PlayerId;
    }
  | {
      readonly type: "finished";
      readonly winner: PlayerId;
      readonly loser: PlayerId;
      readonly reason: FinishReason;
    };

export type MatchErrorCode =
  | "not_a_player"
  | "wrong_phase"
  | "not_your_turn"
  | "fleet_already_placed"
  | FleetError
  | ShotError;

export class MatchError extends Error {
  constructor(readonly code: MatchErrorCode) {
    super(`Match action rejected: ${code}`);
  }
}

/** Everything one player may know about the match (never the opponent's live ships). */
export type MatchView = {
  readonly id: string;
  readonly phase: MatchPhase;
  readonly you: PlayerId;
  readonly opponent: PlayerId;
  readonly turn: PlayerId | null;
  readonly winner: PlayerId | null;
  readonly reason: FinishReason | null;
  readonly moves: number;
  readonly yourFleetPlaced: boolean;
  readonly opponentFleetPlaced: boolean;
  readonly own: OwnView | null;
  readonly target: TargetView | null;
};

/**
 * One game between two players as a state machine. Pure: no timers and no
 * I/O. Every action returns the events it caused; the caller persists them,
 * broadcasts them and runs the turn clock.
 */
export class Match {
  private phase: MatchPhase = "placement";
  private readonly boards = new Map<PlayerId, OceanBoard>();
  private readonly missedInRow = new Map<PlayerId, number>();
  private turn: PlayerId | null = null;
  private winner: PlayerId | null = null;
  private reason: FinishReason | null = null;
  private moves = 0;

  constructor(
    readonly id: string,
    readonly players: readonly [PlayerId, PlayerId],
    readonly rules: GameRules = classicRules,
    /** Who shoots first once both fleets are placed. */
    private readonly firstTurn: PlayerId = players[0],
  ) {
    if (players[0] === players[1])
      throw new RangeError("A match needs two different players");
    if (!players.includes(firstTurn))
      throw new RangeError("First turn must belong to a player");
  }

  get currentPhase(): MatchPhase {
    return this.phase;
  }

  get currentTurn(): PlayerId | null {
    return this.turn;
  }

  get result(): { winner: PlayerId; reason: FinishReason } | null {
    return this.winner && this.reason
      ? { winner: this.winner, reason: this.reason }
      : null;
  }

  get moveCount(): number {
    return this.moves;
  }

  opponentOf(player: PlayerId): PlayerId {
    this.assertPlayer(player);
    return player === this.players[0] ? this.players[1] : this.players[0];
  }

  hasPlacedFleet(player: PlayerId): boolean {
    return this.boards.has(player);
  }

  placeFleet(
    player: PlayerId,
    placements: readonly ShipPlacement[],
  ): MatchEvent[] {
    this.assertPlayer(player);
    this.assertPhase("placement");
    if (this.boards.has(player)) throw new MatchError("fleet_already_placed");
    let fleet: Fleet;
    try {
      fleet = Fleet.create(placements, this.rules);
    } catch (error) {
      if (error instanceof FleetValidationError)
        throw new MatchError(error.code);
      throw error;
    }
    this.boards.set(player, new OceanBoard(fleet, this.rules));
    const events: MatchEvent[] = [{ type: "fleet_placed", player }];
    if (this.boards.size === 2) {
      this.phase = "battle";
      this.turn = this.firstTurn;
      events.push({ type: "battle_started", turn: this.firstTurn });
    }
    return events;
  }

  fire(player: PlayerId, x: number, y: number): MatchEvent[] {
    this.assertPlayer(player);
    this.assertPhase("battle");
    if (this.turn !== player) throw new MatchError("not_your_turn");
    const opponent = this.opponentOf(player);
    const target = this.boardOf(opponent);
    let report: ShotReport;
    try {
      report = target.receive(Coordinate.of(x, y));
    } catch (error) {
      if (error instanceof ShotRejected) throw new MatchError(error.code);
      throw error;
    }
    this.moves++;
    this.missedInRow.set(player, 0);
    if (target.defeated) {
      return [
        { type: "shot", by: player, report, nextTurn: null },
        this.finish(player, "fleet_destroyed"),
      ];
    }
    const keepsTurn = report.outcome !== "miss" && this.rules.extraShotOnHit;
    this.turn = keepsTurn ? player : opponent;
    return [{ type: "shot", by: player, report, nextTurn: this.turn }];
  }

  /** The turn clock ran out for `player`. Too many in a row forfeits. */
  skipTurn(player: PlayerId): MatchEvent[] {
    this.assertPlayer(player);
    this.assertPhase("battle");
    if (this.turn !== player) throw new MatchError("not_your_turn");
    const missed = (this.missedInRow.get(player) ?? 0) + 1;
    this.missedInRow.set(player, missed);
    const opponent = this.opponentOf(player);
    if (missed >= this.rules.maxMissedTurns)
      return [this.finish(opponent, "timeout")];
    this.turn = opponent;
    return [
      { type: "turn_skipped", player, missedInRow: missed, nextTurn: opponent },
    ];
  }

  resign(player: PlayerId): MatchEvent[] {
    return this.forfeit(player, "resigned");
  }

  /**
   * A clock outside the turn ran out for `player` (the placement window):
   * the player forfeits on time. Missed turns in battle go through skipTurn.
   */
  timeOut(player: PlayerId): MatchEvent[] {
    return this.forfeit(player, "timeout");
  }

  /** The player left and did not come back in time. */
  abandon(player: PlayerId): MatchEvent[] {
    return this.forfeit(player, "disconnected");
  }

  viewFor(player: PlayerId): MatchView {
    const opponent = this.opponentOf(player);
    return {
      id: this.id,
      phase: this.phase,
      you: player,
      opponent,
      turn: this.turn,
      winner: this.winner,
      reason: this.reason,
      moves: this.moves,
      yourFleetPlaced: this.boards.has(player),
      opponentFleetPlaced: this.boards.has(opponent),
      own: this.boards.get(player)?.ownView() ?? null,
      target:
        this.phase === "placement"
          ? null
          : (this.boards.get(opponent)?.targetView() ?? null),
    };
  }

  private forfeit(player: PlayerId, reason: FinishReason): MatchEvent[] {
    this.assertPlayer(player);
    if (this.phase === "finished") throw new MatchError("wrong_phase");
    return [this.finish(this.opponentOf(player), reason)];
  }

  private finish(winner: PlayerId, reason: FinishReason): MatchEvent {
    this.phase = "finished";
    this.turn = null;
    this.winner = winner;
    this.reason = reason;
    return { type: "finished", winner, loser: this.opponentOf(winner), reason };
  }

  private boardOf(player: PlayerId): OceanBoard {
    const board = this.boards.get(player);
    if (!board) throw new MatchError("wrong_phase");
    return board;
  }

  private assertPlayer(player: PlayerId) {
    if (!this.players.includes(player)) throw new MatchError("not_a_player");
  }

  private assertPhase(phase: MatchPhase) {
    if (this.phase !== phase) throw new MatchError("wrong_phase");
  }
}
