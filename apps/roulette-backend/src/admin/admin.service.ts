import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type {
  AdminLive,
  AdminPlayer,
  AdminRound,
  AdminRoundDetail,
  AdminServices,
} from "@outegro/contracts/roulette";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { verifyLink } from "@outegro/roulette-engine";
import { and, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import type { RouletteDatabase } from "../common/database.js";
import { FAIR_ROLL } from "../common/tokens.js";
import { servicesConfig } from "../config/config.js";
import { adminAudit, bets, players, rounds } from "../db/schema.js";
import type { FairRollPort } from "../fair/fair-roll.port.js";
import { RoundFeed } from "../rounds/round.feed.js";
import { RoundRepository, type RoundRow } from "../rounds/round.repository.js";
import { RoundStore } from "../rounds/round.store.js";
import { TableSettingsService } from "../table/table.settings.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 2000;
const TOP_BETS = 50;
const LAST_BETS = 50;

/** Players see "rolling" while winnings go out. */
const phaseOf = (status: RoundRow["status"]) =>
  status === "paying" ? "rolling" : status;

/** Refunded bets of voided rounds count neither as stakes nor as payouts. */
const stakedSum = sql<number>`coalesce(sum(${bets.amount}) filter (where ${bets.status} <> 'refunded'), 0)::bigint`;

const playerColumns = {
  userId: players.userId,
  nickname: players.nickname,
  status: players.status,
  bets: sql<number>`count(${bets.id})::int`,
  staked: stakedSum,
  paidOut: sql<number>`coalesce(sum(${bets.payout}) filter (where ${bets.status} in ('won', 'lost')), 0)::bigint`,
  lastBetAt: sql<Date | null>`max(${bets.createdAt})`,
};

/** An opaque offset cursor for lists ordered by an aggregate. */
const offsetOf = (cursor: string | undefined) => {
  const value = Number(cursor ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

/**
 * The admin console's read side (`roulette.read`): the live table, rounds
 * with their chain check, players' turnover, the house result and the
 * health of the services around the roulette.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE) private readonly database: RouletteDatabase,
    private readonly repo: RoundRepository,
    private readonly store: RoundStore,
    private readonly feed: RoundFeed,
    private readonly settings: TableSettingsService,
    @Inject(FAIR_ROLL) private readonly fair: FairRollPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(servicesConfig.KEY)
    private readonly services: ConfigType<typeof servicesConfig>,
  ) {}

  private get db() {
    return this.database.db;
  }

  async live(): Promise<AdminLive> {
    const round = await this.feed.current();
    const [online, table, exposure, day, total] = await Promise.all([
      this.store.online(),
      this.settings.current(),
      round ? this.store.exposure(round.round) : { red: 0, black: 0, green: 0 },
      this.house(new Date(this.clock.now().getTime() - DAY_MS)),
      this.house(),
    ]);
    return { round, online, table, exposure, house: { day, total } };
  }

  /** Settled rounds only: a voided round returned its stakes. */
  private async house(since?: Date) {
    const [row] = await this.db
      .select({
        rounds: sql<number>`count(*)::int`,
        bets: sql<number>`coalesce(sum(${rounds.bets}), 0)::int`,
        staked: sql<number>`coalesce(sum(${rounds.staked}), 0)::bigint`,
        paidOut: sql<number>`coalesce(sum(${rounds.paidOut}), 0)::bigint`,
      })
      .from(rounds)
      .where(
        and(
          eq(rounds.status, "settled"),
          since ? gte(rounds.settledAt, since) : undefined,
        ),
      );
    const staked = Number(row?.staked ?? 0);
    const paidOut = Number(row?.paidOut ?? 0);
    return {
      rounds: row?.rounds ?? 0,
      bets: row?.bets ?? 0,
      staked,
      paidOut,
      result: staked - paidOut,
    };
  }

  private round(row: RoundRow): AdminRound {
    return {
      round: row.id,
      phase: phaseOf(row.status),
      number: row.number,
      color: row.color,
      openedAt: row.openedAt.toISOString(),
      bets: row.bets,
      staked: row.staked,
      paidOut: row.paidOut,
      result: row.status === "settled" ? row.staked - row.paidOut : 0,
    };
  }

  async rounds(cursor: string | undefined, limit: number) {
    const before = cursor ? Number(cursor) : undefined;
    const rows = await this.db
      .select()
      .from(rounds)
      .where(
        before && Number.isSafeInteger(before)
          ? lt(rounds.id, before)
          : undefined,
      )
      .orderBy(desc(rounds.id))
      .limit(limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => this.round(row)),
      nextCursor: rows.length === limit && last ? String(last.id) : null,
    };
  }

  async roundDetail(id: number): Promise<AdminRoundDetail> {
    const row = await this.repo.find(id);
    if (!row) throw new AppError("NOT_FOUND");
    const chain = await this.fair.chain();
    const previousSeed =
      id === 1 ? chain.commit : ((await this.repo.find(id - 1))?.seed ?? null);
    const linkVerified =
      row.seed && previousSeed
        ? await verifyLink(previousSeed, row.seed)
        : null;
    return {
      ...this.round(row),
      seed: row.seed,
      previousSeed,
      commit: chain.commit,
      publicSeed: chain.publicSeed,
      linkVerified,
      topBets: await this.bets(eq(bets.roundId, id), TOP_BETS, "amount"),
    };
  }

  private async bets(
    where: ReturnType<typeof eq>,
    limit: number,
    order: "amount" | "recent",
  ) {
    const rows = await this.db
      .select({ bet: bets, nickname: players.nickname })
      .from(bets)
      .leftJoin(players, eq(players.userId, bets.userId))
      .where(where)
      .orderBy(order === "amount" ? desc(bets.amount) : desc(bets.createdAt))
      .limit(limit);
    return rows.map(({ bet, nickname }) => ({
      betId: bet.id,
      round: bet.roundId,
      userId: bet.userId,
      nickname: nickname ?? "",
      color: bet.color,
      amount: bet.amount,
      status: bet.status,
      payout: bet.payout,
      createdAt: bet.createdAt.toISOString(),
    }));
  }

  /** Turnover per player, biggest first; `q` filters by nickname. */
  async players(query: { q?: string; cursor?: string; limit: number }) {
    const offset = offsetOf(query.cursor);
    const rows = await this.db
      .select(playerColumns)
      .from(players)
      .leftJoin(bets, eq(bets.userId, players.userId))
      .where(query.q ? ilike(players.nickname, `%${query.q}%`) : undefined)
      .groupBy(players.userId)
      .orderBy(desc(stakedSum), desc(players.userId))
      .limit(query.limit)
      .offset(offset);
    const items = rows.map((row) => this.player(row));
    return {
      items,
      nextCursor:
        rows.length === query.limit ? String(offset + query.limit) : null,
    };
  }

  private player(row: {
    userId: string;
    nickname: string;
    status: AdminPlayer["status"];
    bets: number;
    staked: number;
    paidOut: number;
    lastBetAt: Date | string | null;
  }): AdminPlayer {
    const staked = Number(row.staked);
    const paidOut = Number(row.paidOut);
    return {
      userId: row.userId,
      nickname: row.nickname,
      status: row.status,
      bets: row.bets,
      staked,
      paidOut,
      result: paidOut - staked,
      lastBetAt: row.lastBetAt ? new Date(row.lastBetAt).toISOString() : null,
    };
  }

  async playerDetail(userId: string) {
    const [row] = await this.db
      .select(playerColumns)
      .from(players)
      .leftJoin(bets, eq(bets.userId, players.userId))
      .where(eq(players.userId, userId))
      .groupBy(players.userId);
    if (!row) throw new AppError("NOT_FOUND");
    return {
      ...this.player(row),
      lastBets: await this.bets(eq(bets.userId, userId), LAST_BETS, "recent"),
    };
  }

  async servicesHealth(): Promise<AdminServices> {
    const probe = async (
      name: AdminServices["services"][number]["name"],
      url: string | undefined,
    ) => {
      if (!url) return { name, status: "unknown" as const, latencyMs: null };
      const started = performance.now();
      try {
        const response = await fetch(new URL("/health", url), {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        return {
          name,
          status: response.ok ? ("up" as const) : ("down" as const),
          latencyMs: Math.round(performance.now() - started),
        };
      } catch {
        return { name, status: "down" as const, latencyMs: null };
      }
    };
    const services = await Promise.all([
      Promise.resolve({
        name: "roulette-backend" as const,
        status: "up" as const,
        latencyMs: 0,
      }),
      probe("fair-roll", this.services.fairRoll),
      probe("daily-bonus", this.services.dailyBonus),
      probe("wallet", this.services.wallet),
    ]);
    return {
      services,
      leader: await this.store.leader(),
      tickAgeMs: this.feed.frameAgeMs(),
      wallet: this.services.walletMode,
    };
  }

  async audit(cursor: string | undefined) {
    const offset = offsetOf(cursor);
    const limit = 50;
    const rows = await this.db
      .select()
      .from(adminAudit)
      .orderBy(desc(adminAudit.createdAt))
      .limit(limit)
      .offset(offset);
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        reason: row.reason,
        subject: row.subject,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length === limit ? String(offset + limit) : null,
    };
  }
}
