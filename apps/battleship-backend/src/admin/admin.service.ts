import { Inject, Injectable } from "@nestjs/common";
import { battleshipFeatures } from "@outegro/contracts/battleship";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { decodeCursor, toPage } from "../common/cursor.js";
import type { BattleshipDatabase } from "../common/database.js";
import { isUniqueViolation } from "../common/pg-errors.js";
import {
  adminAudit,
  grants,
  matches,
  matchModes,
  matchStatuses,
  moves,
  players,
  ratingHistory,
} from "../db/schema.js";
import { dayStart } from "../domain/calendar.js";
import { Entitlements } from "../domain/entitlements.js";
import type { AuditEntry } from "../domain/game/types.js";
import { defaultNickname } from "../domain/names.js";
import { GameService } from "../game/game.service.js";
import { writeAudit } from "../game/match.repository.js";
import { QueueStore } from "../game/queue.store.js";
import { SessionRegistry } from "../game/session.registry.js";
import { EntitlementsService } from "../players/entitlements.service.js";
import { PlayersService } from "../players/players.service.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";
import { StatsService } from "../stats/stats.service.js";

export const matchListSchema = z.object({
  status: z.enum(matchStatuses).optional(),
  mode: z.enum(matchModes).optional(),
  userId: z.uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const playerSearchSchema = z.object({
  query: z.string().trim().min(1).max(64).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const auditListSchema = z.object({
  targetType: z.enum(["match", "player"]).optional(),
  targetId: z.string().max(64).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const DAY_MS = 24 * 3600_000;
const escapeLike = (value: string) => value.replace(/[%_\\]/g, "\\$&");

type Actor = { userId: string };

/** The game side of the admin console: read models and audited moderation. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly game: GameService,
    private readonly sessions: SessionRegistry,
    private readonly registry: ConnectionRegistry,
    private readonly queue: QueueStore,
    private readonly players: PlayersService,
    private readonly entitlements: EntitlementsService,
    private readonly stats: StatsService,
  ) {}

  async overview() {
    const now = this.clock.now();
    const db = this.database.db;
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [started] = await db
      .select({
        today: sql<number>`(count(*) filter (where ${matches.createdAt} >= ${dayStart(now).toISOString()}::timestamptz))::int`,
        week: sql<number>`count(*)::int`,
      })
      .from(matches)
      .where(gte(matches.createdAt, weekAgo));
    const [newPlayers] = await db
      .select({ value: count() })
      .from(players)
      .where(gte(players.createdAt, weekAgo));
    const [premium] = await db
      .select({ value: sql<number>`count(distinct ${grants.userId})::int` })
      .from(grants)
      .where(
        and(
          eq(grants.feature, battleshipFeatures.premium),
          eq(grants.state, "active"),
          lte(grants.validFrom, now),
          or(isNull(grants.validUntil), gt(grants.validUntil, now)),
        ),
      );
    const bots = await db
      .select({
        level: matches.botLevel,
        matches: sql<number>`count(*)::int`,
        botWins: sql<number>`(count(*) filter (where ${matches.winner} = 'b'))::int`,
      })
      .from(matches)
      .where(and(eq(matches.mode, "bot"), eq(matches.status, "finished")))
      .groupBy(matches.botLevel);
    const online = this.registry.stats();
    return {
      socketsOnline: online.sockets,
      playersOnline: online.players,
      activeMatches: this.sessions.countByMode(),
      queueSize: await this.queue.size(),
      matchesToday: started?.today ?? 0,
      matches7d: started?.week ?? 0,
      newPlayers7d: newPlayers?.value ?? 0,
      premiumPlayers: premium?.value ?? 0,
      botWinRate: Object.fromEntries(
        (["easy", "medium", "hard", "expert"] as const).map((level) => {
          const row = bots.find((b) => b.level === level);
          const played = row?.matches ?? 0;
          return [
            level,
            {
              matches: played,
              botWins: row?.botWins ?? 0,
              rate: played > 0 ? (row?.botWins ?? 0) / played : null,
            },
          ];
        }),
      ),
    };
  }

  async listMatches(query: z.infer<typeof matchListSchema>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const a = alias(players, "pa");
    const b = alias(players, "pb");
    const rows = await this.database.db
      .select({ match: matches, nicknameA: a.nickname, nicknameB: b.nickname })
      .from(matches)
      .leftJoin(a, eq(a.userId, matches.playerA))
      .leftJoin(b, eq(b.userId, matches.playerB))
      .where(
        and(
          query.status ? eq(matches.status, query.status) : undefined,
          query.mode ? eq(matches.mode, query.mode) : undefined,
          query.userId
            ? or(
                eq(matches.playerA, query.userId),
                eq(matches.playerB, query.userId),
              )
            : undefined,
          cursor
            ? or(
                lt(matches.createdAt, cursor.at),
                and(
                  eq(matches.createdAt, cursor.at),
                  lt(matches.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(matches.createdAt), desc(matches.id))
      .limit(query.limit + 1);
    return toPage(
      rows,
      query.limit,
      (row) => this.matchItem(row.match, row.nicknameA, row.nicknameB),
      (row) => ({ at: row.match.createdAt, id: row.match.id }),
    );
  }

  private matchItem(
    match: typeof matches.$inferSelect,
    nicknameA: string | null,
    nicknameB: string | null,
  ) {
    return {
      matchId: match.id,
      mode: match.mode,
      status: match.status,
      players: {
        a: { userId: match.playerA, nickname: nicknameA },
        b: match.playerB
          ? { userId: match.playerB, nickname: nicknameB }
          : { bot: match.botLevel },
      },
      winner: match.winner,
      reason: match.reason,
      abortReason: match.abortReason,
      moves: match.moves,
      rated: match.rated,
      ratingDelta: match.ratingDelta,
      createdAt: match.createdAt.toISOString(),
      battleStartedAt: match.battleStartedAt?.toISOString() ?? null,
      finishedAt: match.finishedAt?.toISOString() ?? null,
    };
  }

  /**
   * Every move and the live state; both fleets once the match is over. While
   * it runs, fleets stay hidden even from staff: an operator who also plays
   * could otherwise read an opponent's ships (TC-BS-03).
   */
  async matchDetail(matchId: string) {
    if (!z.uuid().safeParse(matchId).success) throw new AppError("NOT_FOUND");
    const a = alias(players, "pa");
    const b = alias(players, "pb");
    const [row] = await this.database.db
      .select({ match: matches, nicknameA: a.nickname, nicknameB: b.nickname })
      .from(matches)
      .leftJoin(a, eq(a.userId, matches.playerA))
      .leftJoin(b, eq(b.userId, matches.playerB))
      .where(eq(matches.id, matchId));
    if (!row) throw new AppError("NOT_FOUND");
    const history = await this.database.db
      .select()
      .from(moves)
      .where(eq(moves.matchId, matchId))
      .orderBy(asc(moves.n));
    const session = this.sessions.byMatch(matchId);
    const running =
      row.match.status === "placement" || row.match.status === "battle";
    return {
      ...this.matchItem(row.match, row.nicknameA, row.nicknameB),
      firstTurn: row.match.firstTurn,
      fleets: running ? null : { a: row.match.fleetA, b: row.match.fleetB },
      moves: history.map((move) => ({
        n: move.n,
        side: move.side,
        x: move.x,
        y: move.y,
        outcome: move.outcome,
        at: move.at.toISOString(),
      })),
      live: session?.live ? session.inspect() : null,
    };
  }

  async searchPlayers(query: z.infer<typeof playerSearchSchema>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const term = query.query;
    const byId = term && z.uuid().safeParse(term).success;
    const rows = await this.database.db
      .select()
      .from(players)
      .where(
        and(
          term
            ? byId
              ? eq(players.userId, term)
              : ilike(players.nickname, `%${escapeLike(term)}%`)
            : undefined,
          cursor
            ? or(
                lt(players.createdAt, cursor.at),
                and(
                  eq(players.createdAt, cursor.at),
                  lt(players.userId, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(players.createdAt), desc(players.userId))
      .limit(query.limit + 1);
    return toPage(
      rows,
      query.limit,
      (player) => this.playerItem(player),
      (player) => ({ at: player.createdAt, id: player.userId }),
    );
  }

  private playerItem(player: typeof players.$inferSelect) {
    return {
      userId: player.userId,
      nickname: player.nickname,
      rating: player.rating,
      ratedMatches: player.ratedMatches,
      matches: player.matches,
      wins: player.wins,
      losses: player.losses,
      status: player.status,
      leaderboardHidden: player.leaderboardHidden,
      online: this.registry.isOnline(player.userId),
      createdAt: player.createdAt.toISOString(),
    };
  }

  async playerDetail(userId: string) {
    const player = await this.requirePlayer(userId);
    const now = this.clock.now();
    const history = await this.database.db
      .select()
      .from(ratingHistory)
      .where(eq(ratingHistory.userId, userId))
      .orderBy(desc(ratingHistory.at))
      .limit(50);
    const allGrants = await this.entitlements.list(userId);
    return {
      player: {
        ...this.playerItem(player),
        ratedWins: player.ratedWins,
        currentStreak: player.currentStreak,
        longestStreak: player.longestStreak,
        cosmetics: player.cosmetics,
        activeMatchId: this.game.active(userId)?.id ?? null,
      },
      stats: await this.stats.stats(userId, true),
      ratingHistory: history.map((entry) => ({
        matchId: entry.matchId,
        before: entry.before,
        after: entry.after,
        delta: entry.delta,
        at: entry.at.toISOString(),
      })),
      grants: allGrants.map((grant) => ({
        grantId: grant.grantId,
        feature: grant.feature,
        sourceType: grant.sourceType,
        sourceId: grant.sourceId,
        state: grant.state,
        validFrom: grant.validFrom.toISOString(),
        validUntil: grant.validUntil?.toISOString() ?? null,
        active: Entitlements.isActive(grant, now),
      })),
    };
  }

  async listAudit(query: z.infer<typeof auditListSchema>) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.database.db
      .select()
      .from(adminAudit)
      .where(
        and(
          query.targetType
            ? eq(adminAudit.targetType, query.targetType)
            : undefined,
          query.targetId ? eq(adminAudit.targetId, query.targetId) : undefined,
          cursor
            ? or(
                lt(adminAudit.at, cursor.at),
                and(eq(adminAudit.at, cursor.at), lt(adminAudit.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(adminAudit.at), desc(adminAudit.id))
      .limit(query.limit + 1);
    return toPage(
      rows,
      query.limit,
      (entry) => ({
        id: entry.id,
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        reason: entry.reason,
        data: entry.data,
        at: entry.at.toISOString(),
      }),
      (entry) => ({ at: entry.at, id: entry.id }),
    );
  }

  // Moderation: each change and its audit row commit together.

  async abortMatch(actor: Actor, matchId: string, reason: string) {
    if (!z.uuid().safeParse(matchId).success) throw new AppError("NOT_FOUND");
    const audit: AuditEntry = {
      actorId: actor.userId,
      action: "match.aborted",
      targetType: "match",
      targetId: matchId,
      reason,
    };
    if (await this.game.abort(matchId, audit))
      return { matchId, status: "aborted" as const };
    const [row] = await this.database.db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.id, matchId));
    // Only live matches can be stopped.
    throw new AppError(row ? "CONFLICT" : "NOT_FOUND");
  }

  async resetNickname(actor: Actor, userId: string, reason: string) {
    const player = await this.requirePlayer(userId);
    for (let attempt = 0; attempt < 15; attempt++) {
      const nickname = defaultNickname(attempt);
      try {
        await this.database.db.transaction(async (tx) => {
          const now = this.clock.now();
          await tx
            .update(players)
            .set({ nickname, updatedAt: now })
            .where(eq(players.userId, userId));
          await writeAudit(
            tx,
            {
              actorId: actor.userId,
              action: "player.nickname.reset",
              targetType: "player",
              targetId: userId,
              reason,
              data: { previous: player.nickname, next: nickname },
            },
            now,
          );
        });
        await this.players.pushUpdate(userId);
        return { userId, nickname };
      } catch (error) {
        if (!isUniqueViolation(error, "players_nickname_uq")) throw error;
      }
    }
    throw new AppError("CONFLICT");
  }

  async setLeaderboardHidden(
    actor: Actor,
    userId: string,
    hidden: boolean,
    reason: string,
  ) {
    await this.requirePlayer(userId);
    await this.database.db.transaction(async (tx) => {
      const now = this.clock.now();
      await tx
        .update(players)
        .set({ leaderboardHidden: hidden, updatedAt: now })
        .where(eq(players.userId, userId));
      await writeAudit(
        tx,
        {
          actorId: actor.userId,
          action: hidden
            ? "player.leaderboard.hidden"
            : "player.leaderboard.shown",
          targetType: "player",
          targetId: userId,
          reason,
        },
        now,
      );
    });
    return { userId, leaderboardHidden: hidden };
  }

  private async requirePlayer(userId: string) {
    if (!z.uuid().safeParse(userId).success) throw new AppError("NOT_FOUND");
    const player = await this.players.find(userId);
    if (!player) throw new AppError("NOT_FOUND");
    return player;
  }
}
