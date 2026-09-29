import { Inject, Injectable } from "@nestjs/common";
import {
  botLevelSchema,
  type matchReplaySchema,
  type matchSummarySchema,
  type PlayerStats,
} from "@outegro/contracts/battleship";
import { AppError, DATABASE } from "@outegro/nest-common";
import { and, asc, desc, eq, lt, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { decodeCursor, toPage } from "../common/cursor.js";
import type { BattleshipDatabase } from "../common/database.js";
import { matches, moves, players } from "../db/schema.js";
import { EntitlementsService } from "../players/entitlements.service.js";
import { PlayersService } from "../players/players.service.js";

type MatchSummary = z.infer<typeof matchSummarySchema>;
type MatchReplay = z.infer<typeof matchReplaySchema>;
type Side = "a" | "b";

const BOARD = 10;

/** Statistics, history and replays of one player (Premium parts included). */
@Injectable()
export class StatsService {
  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    private readonly players: PlayersService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** The player's side in a match row, as SQL. */
  private sideOf(userId: string): SQL {
    return sql`case when ${matches.playerA} = ${userId} then 'a' else 'b' end`;
  }

  private participant(userId: string): SQL | undefined {
    return or(eq(matches.playerA, userId), eq(matches.playerB, userId));
  }

  /** `heatmap` only with extended statistics; everyone else gets the rest. */
  async stats(userId: string, withHeatmap?: boolean): Promise<PlayerStats> {
    const player = await this.players.ensure(userId);
    const heatmapAllowed =
      withHeatmap ?? (await this.entitlements.of(userId)).extendedStats;
    const own = and(
      this.participant(userId),
      sql`${moves.side} = ${this.sideOf(userId)}`,
      sql`${moves.outcome} <> 'skip'`,
    );
    const db = this.database.db;
    const [shots] = await db
      .select({
        shots: sql<number>`count(*)::int`,
        hits: sql<number>`(count(*) filter (where ${moves.outcome} in ('hit', 'sunk')))::int`,
      })
      .from(moves)
      .innerJoin(matches, eq(matches.id, moves.matchId))
      .where(own);
    const won = and(
      this.participant(userId),
      eq(matches.status, "finished"),
      eq(matches.reason, "fleet_destroyed"),
      sql`${matches.winner} = ${this.sideOf(userId)}`,
    );
    const perWin = db
      .select({ shots: sql<number>`count(*)`.as("shots") })
      .from(moves)
      .innerJoin(matches, eq(matches.id, moves.matchId))
      .where(and(won, own))
      .groupBy(matches.id)
      .as("per_win");
    const [average] = await db
      .select({ value: sql<number | null>`avg(${perWin.shots})::float` })
      .from(perWin);
    const botRows = await db
      .select({ level: matches.botLevel, wins: sql<number>`count(*)::int` })
      .from(matches)
      .where(
        and(
          eq(matches.mode, "bot"),
          eq(matches.status, "finished"),
          eq(matches.playerA, userId),
          eq(matches.winner, "a"),
        ),
      )
      .groupBy(matches.botLevel);
    const botWins = Object.fromEntries(
      botLevelSchema.options.map((level) => [
        level,
        botRows.find((row) => row.level === level)?.wins ?? 0,
      ]),
    ) as PlayerStats["botWins"];

    let heatmap: number[][] | null = null;
    if (heatmapAllowed) {
      heatmap = Array.from({ length: BOARD }, () =>
        Array<number>(BOARD).fill(0),
      );
      const cells = await db
        .select({ x: moves.x, y: moves.y, count: sql<number>`count(*)::int` })
        .from(moves)
        .innerJoin(matches, eq(matches.id, moves.matchId))
        .where(own)
        .groupBy(moves.x, moves.y);
      for (const cell of cells) {
        const row = cell.y === null ? undefined : heatmap[cell.y];
        if (row && cell.x !== null) row[cell.x] = cell.count;
      }
    }

    const total = shots?.shots ?? 0;
    return {
      matches: player.matches,
      wins: player.wins,
      losses: player.losses,
      winRate: player.matches > 0 ? player.wins / player.matches : null,
      accuracy: total > 0 ? (shots?.hits ?? 0) / total : null,
      currentStreak: player.currentStreak,
      longestStreak: player.longestStreak,
      averageMovesToWin: average?.value ?? null,
      botWins,
      heatmap,
    };
  }

  /** Finished matches, newest first, from the player's side. */
  async history(userId: string, query: { cursor?: string; limit: number }) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const opponent = alias(players, "opponent");
    const opponentId = sql`case when ${matches.playerA} = ${userId} then ${matches.playerB} else ${matches.playerA} end`;
    const rows = await this.database.db
      .select({
        match: matches,
        opponentNickname: opponent.nickname,
        opponentRating: opponent.rating,
        opponentPremium: this.entitlements.premiumCondition(opponent.userId),
      })
      .from(matches)
      .leftJoin(opponent, sql`${opponent.userId} = ${opponentId}`)
      .where(
        and(
          this.participant(userId),
          eq(matches.status, "finished"),
          cursor
            ? or(
                lt(matches.finishedAt, cursor.at),
                and(
                  eq(matches.finishedAt, cursor.at),
                  lt(matches.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(matches.finishedAt), desc(matches.id))
      .limit(query.limit + 1);
    return toPage(
      rows,
      query.limit,
      (row): MatchSummary => {
        const m = row.match;
        const side: Side = m.playerA === userId ? "a" : "b";
        const won = m.winner === side;
        return {
          matchId: m.id,
          mode: m.mode,
          opponent:
            m.botLevel && !m.playerB
              ? { kind: "bot", level: m.botLevel }
              : {
                  kind: "human",
                  nickname: row.opponentNickname ?? "",
                  rating: row.opponentRating ?? 0,
                  premium: Boolean(row.opponentPremium),
                },
          result: won ? "win" : "loss",
          reason: m.reason ?? "fleet_destroyed",
          moves: m.moves,
          ratingDelta:
            m.ratingDelta === null
              ? null
              : won
                ? m.ratingDelta
                : -m.ratingDelta,
          finishedAt: (m.finishedAt ?? m.createdAt).toISOString(),
        };
      },
      (row) => ({
        at: row.match.finishedAt ?? row.match.createdAt,
        id: row.match.id,
      }),
    );
  }

  /**
   * Both fleets and every shot of a finished match (Premium). Someone else's
   * match, a live one or an aborted one looks like a missing one (404).
   */
  async replay(userId: string, matchId: string): Promise<MatchReplay> {
    if (!(await this.entitlements.of(userId)).extendedStats)
      throw new AppError("FORBIDDEN");
    if (!z.uuid().safeParse(matchId).success) throw new AppError("NOT_FOUND");
    const [match] = await this.database.db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.id, matchId),
          this.participant(userId),
          eq(matches.status, "finished"),
        ),
      );
    if (!match?.winner || !match.reason || !match.finishedAt)
      throw new AppError("NOT_FOUND");
    const side: Side = match.playerA === userId ? "a" : "b";
    const rows = await this.database.db
      .select()
      .from(moves)
      .where(and(eq(moves.matchId, matchId), sql`${moves.outcome} <> 'skip'`))
      .orderBy(asc(moves.n));
    const opponentUser = side === "a" ? match.playerB : match.playerA;
    const [opponent] = opponentUser
      ? await this.database.db
          .select({
            nickname: players.nickname,
            rating: players.rating,
            premium: this.entitlements.premiumCondition(players.userId),
          })
          .from(players)
          .where(eq(players.userId, opponentUser))
      : [];
    const mine = side === "a" ? match.fleetA : match.fleetB;
    const theirs = side === "a" ? match.fleetB : match.fleetA;
    return {
      matchId: match.id,
      mode: match.mode,
      opponent:
        match.botLevel && !match.playerB
          ? { kind: "bot", level: match.botLevel }
          : {
              kind: "human",
              nickname: opponent?.nickname ?? "",
              rating: opponent?.rating ?? 0,
              premium: Boolean(opponent?.premium),
            },
      winner: match.winner === side ? "you" : "opponent",
      reason: match.reason,
      fleets: { you: mine ?? [], opponent: theirs ?? [] },
      moves: rows
        .filter(
          (row) => row.x !== null && row.y !== null && row.outcome !== "skip",
        )
        .map((row, index) => ({
          n: index + 1,
          by: row.side === side ? ("you" as const) : ("opponent" as const),
          x: row.x as number,
          y: row.y as number,
          outcome: row.outcome as "miss" | "hit" | "sunk",
        })),
      startedAt: match.createdAt.toISOString(),
      finishedAt: match.finishedAt.toISOString(),
    };
  }
}
