import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import type {
  BotLevel,
  Random,
  ShipPlacement,
} from "@outegro/battleship-engine";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { BattleshipMetrics } from "../common/metrics.js";
import { GAME_TIMINGS, RANDOM, SCHEDULER } from "../common/tokens.js";
import { GameError } from "../domain/errors.js";
import { BotPlayer } from "../domain/game/bot-player.js";
import { GameSession } from "../domain/game/game-session.js";
import type {
  AuditEntry,
  GameTimings,
  MatchAction,
  MatchRecord,
  SessionEnd,
} from "../domain/game/types.js";
import { RatingPolicy } from "../domain/rating.js";
import type { Scheduler } from "../domain/scheduler.js";
import { PlayersService } from "../players/players.service.js";
import type { Connection } from "../realtime/connection.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";
import { MatchRepository } from "./match.repository.js";
import { SessionRegistry } from "./session.registry.js";

export type NewMatch =
  | { mode: "bot"; userId: string; level: BotLevel }
  | { mode: "quick" | "private"; a: string; b: string };

/**
 * Starts matches and routes players' commands to their live session. The
 * rules are the engine's; timing and delivery are the session's.
 */
@Injectable()
export class GameService implements OnModuleDestroy {
  private readonly logger = new Logger("GameService");
  private readonly rating = new RatingPolicy();

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly store: MatchRepository,
    private readonly registry: ConnectionRegistry,
    private readonly players: PlayersService,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RANDOM) private readonly random: Random,
    @Inject(GAME_TIMINGS) private readonly timings: GameTimings,
    private readonly metrics: BattleshipMetrics,
  ) {}

  active(userId: string): GameSession | undefined {
    return this.sessions.forUser(userId);
  }

  /** Creates, stores and starts a match, then shows it to the players. */
  async start(input: NewMatch): Promise<GameSession> {
    const seats =
      input.mode === "bot"
        ? {
            a: await this.players.seat(input.userId),
            b: { kind: "bot" as const, level: input.level },
          }
        : {
            a: await this.players.seat(input.a),
            b: await this.players.seat(input.b),
          };
    const record: MatchRecord = {
      id: randomUUID(),
      mode: input.mode,
      rated: this.rating.isRated(input.mode),
      seats,
      firstTurn: this.random.next() < 0.5 ? "a" : "b",
      createdAt: this.clock.now(),
    };
    // The bot places its fleet at once, stored with the match.
    const history: MatchAction[] =
      seats.b.kind === "bot"
        ? [
            {
              kind: "place",
              side: "b",
              ships: BotPlayer.placeFleet(this.random),
            },
          ]
        : [];
    await this.store.create(record, history);
    const session = this.resume(record, history);
    for (const userId of session.userIds) {
      if (record.mode === "quick")
        this.registry.send(userId, {
          type: "queue.matched",
          payload: { matchId: record.id },
        });
      for (const message of await session.stateFor(userId))
        this.registry.send(userId, message);
    }
    return session;
  }

  /** Registers a session for a stored match and arms its clocks (also recovery). */
  resume(record: MatchRecord, history: readonly MatchAction[]): GameSession {
    const session = new GameSession(
      record,
      {
        store: this.store,
        outlet: this.registry,
        scheduler: this.scheduler,
        clock: this.clock,
        random: this.random,
        timings: this.timings,
        log: new Logger("GameSession"),
        onEnd: (ended, end) => this.ended(ended, end),
      },
      history,
    );
    this.sessions.add(session);
    session.start();
    return session;
  }

  private ended(session: GameSession, end: SessionEnd) {
    this.sessions.remove(session);
    this.metrics.matchEnded(session.record.mode, end);
    // A rated result changed both ratings: show them without a reload.
    if (end.kind === "finished" && session.record.rated) {
      for (const userId of session.userIds)
        this.players
          .pushUpdate(userId)
          .catch((error: unknown) =>
            this.logger.warn(
              { err: (error as Error).message },
              "player.updated failed",
            ),
          );
    }
  }

  private require(userId: string): GameSession {
    const session = this.sessions.forUser(userId);
    if (!session) throw new GameError("no_active_match");
    return session;
  }

  placeFleet(userId: string, ships: readonly ShipPlacement[]) {
    return this.require(userId).placeFleet(userId, ships);
  }

  fire(userId: string, x: number, y: number) {
    return this.require(userId).fire(userId, x, y);
  }

  resign(userId: string) {
    return this.require(userId).resign(userId);
  }

  /**
   * A full `match.state` to one socket (on connect and on `match.sync`), then
   * the opponent's reconnect deadline if the opponent is away.
   */
  async sync(connection: Connection): Promise<void> {
    const session = this.require(connection.userId);
    for (const message of await session.stateFor(connection.userId))
      connection.send(message);
  }

  userOnline(userId: string) {
    this.sessions.forUser(userId)?.userOnline(userId);
  }

  userOffline(userId: string) {
    this.sessions.forUser(userId)?.userOffline(userId);
  }

  /** The account is gone: its live match is forfeited. */
  async forfeit(userId: string): Promise<void> {
    const session = this.sessions.forUser(userId);
    if (!session) return;
    try {
      await session.forfeit(userId);
    } catch (error) {
      if (!(error instanceof GameError && error.code === "wrong_phase"))
        throw error;
    }
  }

  /** Moderation: stops a live match without a result. False when it is not live. */
  async abort(matchId: string, audit: AuditEntry): Promise<boolean> {
    const session = this.sessions.byMatch(matchId);
    if (!session?.live) return false;
    try {
      await session.abort("moderation", audit);
      return true;
    } catch (error) {
      if (error instanceof GameError && error.code === "wrong_phase")
        return false;
      throw error;
    }
  }

  onModuleDestroy() {
    for (const session of this.sessions.all()) session.dispose();
    this.scheduler.cancelAll();
  }
}
