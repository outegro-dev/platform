import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { heldBySafeMode } from "@outegro/nest-common";
import type {
  HumanSeat,
  MatchAction,
  MatchRecord,
  Seat,
  SideKey,
} from "../domain/game/types.js";
import { PlayersService } from "../players/players.service.js";
import { GameService } from "./game.service.js";
import {
  type LiveMatchRow,
  MatchRepository,
  type MoveRow,
} from "./match.repository.js";
import { QueueStore } from "./queue.store.js";

/** The stored log of a match: both placements, then every shot and skip. */
export function historyOf(
  match: LiveMatchRow,
  moves: readonly MoveRow[],
): MatchAction[] {
  const history: MatchAction[] = [];
  const fleets: [SideKey, LiveMatchRow["fleetA"]][] = [
    ["a", match.fleetA],
    ["b", match.fleetB],
  ];
  for (const [side, ships] of fleets)
    if (ships) history.push({ kind: "place", side, ships });
  for (const move of moves) {
    if (move.outcome === "skip")
      history.push({ kind: "skip", side: move.side });
    else if (move.x !== null && move.y !== null)
      history.push({ kind: "shot", side: move.side, x: move.x, y: move.y });
  }
  return history;
}

/**
 * Live matches are kept in memory (one replica, ADR-001). On start, every
 * match still in placement or battle is rebuilt by replaying its stored
 * fleets and moves into a fresh engine match, and its clocks restart: fresh
 * placement or turn window, and the reconnect grace for players not back yet.
 * A stored waiting forfeit keeps waiting: its side gets no new grace, and no
 * clock runs.
 */
@Injectable()
export class RecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger("Recovery");

  constructor(
    private readonly store: MatchRepository,
    private readonly game: GameService,
    private readonly players: PlayersService,
    private readonly queue: QueueStore,
  ) {}

  async onApplicationBootstrap() {
    // Resumed matches run clocks and forfeits: not on restored data.
    if (heldBySafeMode("match recovery")) return;
    // Queue entries belonged to sockets of the previous process.
    await this.queue.clear();
    const live = await this.store.loadLive();
    let recovered = 0;
    for (const { match, moves } of live) {
      try {
        this.game.resume(
          await this.recordOf(match),
          historyOf(match, moves),
          match.pendingForfeit,
        );
        recovered++;
      } catch (error) {
        this.logger.error(
          { matchId: match.id, err: (error as Error).message },
          "Could not recover a live match",
        );
      }
    }
    if (live.length > 0)
      this.logger.log(
        { recovered, live: live.length },
        "Live matches recovered",
      );
  }

  private async recordOf(match: LiveMatchRow): Promise<MatchRecord> {
    const a: HumanSeat = await this.players.seat(match.playerA);
    let b: Seat;
    if (match.playerB) b = await this.players.seat(match.playerB);
    else if (match.botLevel) b = { kind: "bot", level: match.botLevel };
    else throw new Error("a match needs a second player");
    return {
      id: match.id,
      mode: match.mode,
      rated: match.rated,
      seats: { a, b },
      firstTurn: match.firstTurn,
      createdAt: match.createdAt,
    };
  }
}
