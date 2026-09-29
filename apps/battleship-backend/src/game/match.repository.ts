import { Inject, Injectable } from "@nestjs/common";
import type { ShipPlacement } from "@outegro/battleship-engine";
import { battleshipMatchFinished, createEvent } from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import { DATABASE, OutboxRelay } from "@outegro/nest-common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BattleshipDatabase, BattleshipTx } from "../common/database.js";
import {
  adminAudit,
  matches,
  moves,
  players,
  ratingHistory,
} from "../db/schema.js";
import {
  type AbortReason,
  type AuditEntry,
  type FinishInput,
  type FinishResult,
  type MatchAction,
  type MatchRecord,
  type MatchStore,
  otherSide,
  SIDES,
  type SideKey,
  type StoredMove,
} from "../domain/game/types.js";
import { type RatingChange, RatingPolicy } from "../domain/rating.js";

const LIVE = ["placement", "battle"] as const;

export type LiveMatchRow = typeof matches.$inferSelect;
export type MoveRow = typeof moves.$inferSelect;

/** Writes an admin audit row inside the caller's transaction. */
export async function writeAudit(
  tx: BattleshipTx,
  entry: AuditEntry,
  at: Date,
) {
  await tx.insert(adminAudit).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason,
    data: entry.data ?? {},
    at,
  });
}

/**
 * Persistence of matches (the MatchStore port). Only live rows change; the
 * finish writes the result, statistics, ratings and the outbox event together.
 */
@Injectable()
export class MatchRepository implements MatchStore {
  private readonly rating = new RatingPolicy();

  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    private readonly relay: OutboxRelay,
  ) {}

  /** Stores a new match with the placements it starts with (the bot's fleet). */
  async create(record: MatchRecord, initial: readonly MatchAction[]) {
    const fleet = (side: SideKey) => {
      const placed = initial.find((a) => a.kind === "place" && a.side === side);
      return placed?.kind === "place" ? [...placed.ships] : null;
    };
    const { a, b } = record.seats;
    await this.database.db.insert(matches).values({
      id: record.id,
      mode: record.mode,
      status: "placement",
      playerA: a.kind === "human" ? a.userId : raise("side a is a human"),
      playerB: b.kind === "human" ? b.userId : null,
      botLevel: b.kind === "bot" ? b.level : null,
      fleetA: fleet("a"),
      fleetB: fleet("b"),
      firstTurn: record.firstTurn,
      rated: record.rated,
      createdAt: record.createdAt,
    });
  }

  async savePlacement(
    matchId: string,
    side: SideKey,
    ships: readonly ShipPlacement[],
    battleStartedAt: Date | null,
    _at: Date,
  ) {
    const fleet = [...ships];
    const rows = await this.database.db
      .update(matches)
      .set({
        ...(side === "a" ? { fleetA: fleet } : { fleetB: fleet }),
        ...(battleStartedAt
          ? { status: "battle" as const, battleStartedAt }
          : {}),
        version: sql`${matches.version} + 1`,
      })
      .where(and(eq(matches.id, matchId), eq(matches.status, "placement")))
      .returning({ id: matches.id });
    if (rows.length !== 1)
      throw new Error(`match ${matchId} is not in placement`);
  }

  /**
   * One statement, so one round trip per shot and atomic on its own: the
   * move is inserted only if the match row was updated (still in battle).
   */
  async saveMove(matchId: string, move: StoredMove, at: Date) {
    const shots = move.outcome === "skip" ? 0 : 1;
    const result = await this.database.db.execute(sql`
      with live as (
        update ${matches}
           set moves = ${matches.moves} + ${shots}, version = ${matches.version} + 1
         where ${matches.id} = ${matchId} and ${matches.status} = 'battle'
     returning ${matches.id} as id
      )
      insert into ${moves} (match_id, n, side, x, y, outcome, at)
      select live.id, ${move.n}::int, ${move.side}::text, ${move.x}::smallint,
             ${move.y}::smallint, ${move.outcome}::text, ${at.toISOString()}::timestamptz
        from live
      returning n`);
    if (result.rows.length !== 1)
      throw new Error(`match ${matchId} is not in battle`);
  }

  async saveWaitingForfeit(matchId: string, side: SideKey) {
    const rows = await this.database.db
      .update(matches)
      .set({ pendingForfeit: side, version: sql`${matches.version} + 1` })
      .where(and(eq(matches.id, matchId), inArray(matches.status, LIVE)))
      .returning({ id: matches.id });
    if (rows.length !== 1) throw new Error(`match ${matchId} is not live`);
  }

  async finish(input: FinishInput): Promise<FinishResult> {
    const { record, winner, at } = input;
    const loser = otherSide(winner);
    const human = (side: SideKey) => {
      const seat = record.seats[side];
      return seat.kind === "human" ? seat.userId : null;
    };
    const result = await this.database.db.transaction(async (tx) => {
      const [live] = await tx
        .select({ version: matches.version })
        .from(matches)
        .where(and(eq(matches.id, record.id), inArray(matches.status, LIVE)))
        .for("update");
      if (!live) throw new Error(`match ${record.id} is not live`);
      if (input.finalMove)
        await tx
          .insert(moves)
          .values({ matchId: record.id, ...input.finalMove, at });

      const ratings: Partial<Record<SideKey, RatingChange>> = {};
      const winnerId = human(winner);
      const loserId = human(loser);
      if (record.rated && winnerId && loserId) {
        const rows = await tx
          .select({
            userId: players.userId,
            rating: players.rating,
            matches: players.ratedMatches,
          })
          .from(players)
          .where(inArray(players.userId, [winnerId, loserId].sort()))
          .orderBy(asc(players.userId))
          .for("update");
        const of = (id: string) => {
          const row = rows.find((r) => r.userId === id);
          if (!row) throw new Error(`player ${id} is missing`);
          return row;
        };
        const settled = this.rating.settle(of(winnerId), of(loserId));
        ratings[winner] = settled.winner;
        ratings[loser] = settled.loser;
        for (const [userId, change, won] of [
          [winnerId, settled.winner, true],
          [loserId, settled.loser, false],
        ] as const) {
          await tx
            .update(players)
            .set({
              rating: change.after,
              ratedMatches: sql`${players.ratedMatches} + 1`,
              ...(won ? { ratedWins: sql`${players.ratedWins} + 1` } : {}),
            })
            .where(eq(players.userId, userId));
          await tx.insert(ratingHistory).values({
            userId,
            matchId: record.id,
            before: change.before,
            after: change.after,
            delta: change.delta,
            at,
          });
        }
      }

      // Statistics of every mode, for the humans at the table.
      if (winnerId) {
        await tx
          .update(players)
          .set({
            matches: sql`${players.matches} + 1`,
            wins: sql`${players.wins} + 1`,
            currentStreak: sql`${players.currentStreak} + 1`,
            longestStreak: sql`greatest(${players.longestStreak}, ${players.currentStreak} + 1)`,
            updatedAt: at,
          })
          .where(eq(players.userId, winnerId));
      }
      if (loserId) {
        await tx
          .update(players)
          .set({
            matches: sql`${players.matches} + 1`,
            losses: sql`${players.losses} + 1`,
            currentStreak: 0,
            updatedAt: at,
          })
          .where(eq(players.userId, loserId));
      }

      const delta = ratings[winner]?.delta ?? null;
      const version = live.version + 1;
      await tx
        .update(matches)
        .set({
          status: "finished",
          winner,
          reason: input.reason,
          pendingForfeit: null,
          moves: input.moves,
          ratingDelta: delta,
          finishedAt: at,
          version,
        })
        .where(eq(matches.id, record.id));

      const bot = SIDES.map((side) => record.seats[side]).find(
        (seat) => seat.kind === "bot",
      );
      await enqueueEvent(
        tx,
        createEvent(battleshipMatchFinished, {
          aggregateId: record.id,
          aggregateVersion: version,
          occurredAt: at,
          payload: {
            matchId: record.id,
            mode: record.mode,
            winnerUserId: winnerId,
            loserUserId: loserId,
            botLevel: bot?.level ?? null,
            reason: input.reason,
            moves: input.moves,
            rated: record.rated,
            ratingDelta: delta,
            finishedAt: at.toISOString(),
          },
        }),
      );
      return { ratings };
    });
    this.relay.kick();
    return result;
  }

  async abort(
    matchId: string,
    reason: AbortReason,
    at: Date,
    audit: AuditEntry | null,
  ) {
    await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .update(matches)
        .set({
          status: "aborted",
          abortReason: reason,
          pendingForfeit: null,
          finishedAt: at,
          version: sql`${matches.version} + 1`,
        })
        .where(and(eq(matches.id, matchId), inArray(matches.status, LIVE)))
        .returning({ id: matches.id });
      if (rows.length !== 1) throw new Error(`match ${matchId} is not live`);
      if (audit) await writeAudit(tx, audit, at);
    });
  }

  /** Live matches with their moves in order, for recovery after a restart. */
  async loadLive(): Promise<{ match: LiveMatchRow; moves: MoveRow[] }[]> {
    const live = await this.database.db
      .select()
      .from(matches)
      .where(inArray(matches.status, LIVE))
      .orderBy(asc(matches.createdAt));
    if (live.length === 0) return [];
    const all = await this.database.db
      .select()
      .from(moves)
      .where(
        inArray(
          moves.matchId,
          live.map((m) => m.id),
        ),
      )
      .orderBy(asc(moves.matchId), asc(moves.n));
    return live.map((match) => ({
      match,
      moves: all.filter((move) => move.matchId === match.id),
    }));
  }
}

function raise(message: string): never {
  throw new Error(message);
}
