import { Inject, Injectable } from "@nestjs/common";
import type { Leaderboard } from "@outegro/contracts/battleship";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, asc, desc, eq, gt, gte, type SQL, sql } from "drizzle-orm";
import type { BattleshipDatabase } from "../common/database.js";
import { players, ratingHistory } from "../db/schema.js";
import { weekStart } from "../domain/calendar.js";
import { EntitlementsService } from "../players/entitlements.service.js";
import { PlayersService } from "../players/players.service.js";

const TOP = 100;

/**
 * Leaderboards (§16.3): all time by rating, and the current week (from
 * Monday 00:00 UTC) by rating gained, ties broken by weekly wins. Hidden,
 * suspended and deleted players and players without a rated match are left out.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly entitlements: EntitlementsService,
    private readonly players: PlayersService,
  ) {}

  private readonly listed: SQL | undefined = and(
    eq(players.status, "active"),
    eq(players.leaderboardHidden, false),
  );

  board(period: "all" | "week", viewer: string | null): Promise<Leaderboard> {
    return period === "week" ? this.week(viewer) : this.allTime(viewer);
  }

  private async allTime(viewer: string | null): Promise<Leaderboard> {
    const ranked = and(this.listed, gt(players.ratedMatches, 0));
    const rows = await this.database.db
      .select({
        userId: players.userId,
        nickname: players.nickname,
        rating: players.rating,
        wins: players.ratedWins,
        matches: players.ratedMatches,
        premium: this.entitlements.premiumCondition(players.userId),
      })
      .from(players)
      .where(ranked)
      .orderBy(
        desc(players.rating),
        desc(players.ratedWins),
        asc(players.createdAt),
        asc(players.userId),
      )
      .limit(TOP);
    let you: Leaderboard["you"] = null;
    if (viewer) {
      const me = await this.players.ensure(viewer);
      const result = await this.database.db.execute<{ rank: number }>(sql`
        select rank from (
          select ${players.userId} as user_id,
                 row_number() over (order by ${players.rating} desc, ${players.ratedWins} desc,
                                    ${players.createdAt} asc, ${players.userId} asc)::int as rank
            from ${players} where ${ranked}
        ) ranked where user_id = ${viewer}`);
      you = {
        rank: result.rows[0]?.rank ?? null,
        rating: me.rating,
        wins: me.ratedWins,
        matches: me.ratedMatches,
      };
    }
    return {
      period: "all",
      since: null,
      items: rows.map((row, index) => ({
        rank: index + 1,
        nickname: row.nickname,
        rating: row.rating,
        wins: row.wins,
        matches: row.matches,
        premium: Boolean(row.premium),
      })),
      you,
    };
  }

  private async week(viewer: string | null): Promise<Leaderboard> {
    const since = weekStart(this.clock.now());
    // Aliases must not collide with players columns (wins, matches) in the join.
    const weekly = this.database.db
      .select({
        userId: ratingHistory.userId,
        gained: sql<number>`sum(${ratingHistory.delta})::int`.as("week_gained"),
        wins: sql<number>`(count(*) filter (where ${ratingHistory.delta} > 0))::int`.as(
          "week_wins",
        ),
        matches: sql<number>`count(*)::int`.as("week_matches"),
      })
      .from(ratingHistory)
      .where(gte(ratingHistory.at, since))
      .groupBy(ratingHistory.userId)
      .as("weekly");
    const rows = await this.database.db
      .select({
        userId: players.userId,
        nickname: players.nickname,
        rating: players.rating,
        gained: weekly.gained,
        wins: weekly.wins,
        matches: weekly.matches,
        premium: this.entitlements.premiumCondition(players.userId),
        rank: sql<number>`(row_number() over (order by ${weekly.gained} desc, ${weekly.wins} desc, ${players.rating} desc, ${players.userId} asc))::int`,
      })
      .from(weekly)
      .innerJoin(players, eq(players.userId, weekly.userId))
      .where(this.listed)
      .orderBy(
        desc(weekly.gained),
        desc(weekly.wins),
        desc(players.rating),
        asc(players.userId),
      );
    let you: Leaderboard["you"] = null;
    if (viewer) {
      const me = await this.players.ensure(viewer);
      const mine = rows.find((row) => row.userId === viewer);
      you = {
        rank: mine?.rank ?? null,
        rating: me.rating,
        wins: mine?.wins ?? 0,
        matches: mine?.matches ?? 0,
        gained: mine?.gained ?? 0,
      };
    }
    return {
      period: "week",
      since: since.toISOString(),
      items: rows.slice(0, TOP).map((row) => ({
        rank: row.rank,
        nickname: row.nickname,
        rating: row.rating,
        wins: row.wins,
        matches: row.matches,
        premium: Boolean(row.premium),
        gained: row.gained,
      })),
      you,
    };
  }
}
