import { Inject, Injectable } from "@nestjs/common";
import {
  type CosmeticSlot,
  type Cosmetics,
  defaultCosmetics,
  type PlayerProfile,
  type updateProfileSchema,
} from "@outegro/contracts/battleship";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { BattleshipDatabase, Executor } from "../common/database.js";
import { isUniqueViolation } from "../common/pg-errors.js";
import { players } from "../db/schema.js";
import type { Entitlements } from "../domain/entitlements.js";
import type { HumanSeat } from "../domain/game/types.js";
import { defaultNickname } from "../domain/names.js";
import { RatingPolicy } from "../domain/rating.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";
import { EntitlementsService } from "./entitlements.service.js";

export type PlayerRow = typeof players.$inferSelect;
export type PlayerSummary = {
  nickname: string;
  rating: number;
  premium: boolean;
  cosmetics: Cosmetics;
};

const NICKNAME_INDEX = "players_nickname_uq";
const rating = new RatingPolicy();

/** Game accounts: created on first access, own nickname and cosmetics. */
@Injectable()
export class PlayersService {
  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly entitlements: EntitlementsService,
    private readonly registry: ConnectionRegistry,
  ) {}

  async find(userId: string, db: Executor = this.database.db) {
    const [row] = await db
      .select()
      .from(players)
      .where(eq(players.userId, userId));
    return row ?? null;
  }

  /** The player, created with a free "Sailor NNNN" nickname on first access. */
  async ensure(userId: string): Promise<PlayerRow> {
    const existing = await this.find(userId);
    if (existing) return existing;
    for (let attempt = 0; attempt < 15; attempt++) {
      const now = this.clock.now();
      try {
        const [created] = await this.database.db
          .insert(players)
          .values({
            userId,
            nickname: defaultNickname(attempt),
            cosmetics: defaultCosmetics,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: players.userId })
          .returning();
        if (created) return created;
        // Another request created it at the same moment.
        const raced = await this.find(userId);
        if (raced) return raced;
      } catch (error) {
        if (isUniqueViolation(error, NICKNAME_INDEX)) continue;
        throw error;
      }
    }
    throw new Error("Could not allocate a default nickname");
  }

  /** Suspended and deleted accounts cannot play. */
  async requireActive(userId: string): Promise<PlayerRow> {
    const player = await this.ensure(userId);
    if (player.status !== "active") throw new AppError("FORBIDDEN");
    return player;
  }

  async profile(userId: string): Promise<PlayerProfile> {
    const player = await this.ensure(userId);
    return this.toProfile(player, await this.entitlements.of(userId));
  }

  toProfile(player: PlayerRow, entitlements: Entitlements): PlayerProfile {
    return {
      userId: player.userId,
      nickname: player.nickname,
      rating: player.rating,
      provisional: rating.isProvisional(player.ratedMatches),
      matches: player.matches,
      wins: player.wins,
      premium: entitlements.premium,
      premiumUntil: entitlements.premiumUntil?.toISOString() ?? null,
      features: entitlements.list(),
      cosmetics: {
        equipped: player.cosmetics,
        effective: entitlements.effective(player.cosmetics),
      },
    };
  }

  /** What the socket shows: rating, Premium badge and effective cosmetics. */
  async summary(userId: string): Promise<PlayerSummary> {
    const player = await this.ensure(userId);
    const entitlements = await this.entitlements.of(userId);
    return {
      nickname: player.nickname,
      rating: player.rating,
      premium: entitlements.premium,
      cosmetics: entitlements.effective(player.cosmetics),
    };
  }

  /** How a player appears to an opponent at the table. */
  async seat(userId: string): Promise<HumanSeat> {
    const summary = await this.summary(userId);
    return {
      kind: "human",
      userId,
      nickname: summary.nickname,
      rating: summary.rating,
      premium: summary.premium,
    };
  }

  async update(
    userId: string,
    body: z.infer<typeof updateProfileSchema>,
  ): Promise<PlayerProfile> {
    const player = await this.requireActive(userId);
    const entitlements = await this.entitlements.of(userId);
    const chosen = body.cosmetics ?? {};
    for (const slot of Object.keys(chosen) as CosmeticSlot[]) {
      const item = chosen[slot];
      if (item !== undefined && !entitlements.unlocked(slot, item as never))
        throw new AppError("FORBIDDEN", {
          fieldErrors: { [`cosmetics.${slot}`]: ["locked"] },
        });
    }
    let updated: PlayerRow | undefined;
    try {
      [updated] = await this.database.db
        .update(players)
        .set({
          ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
          cosmetics: { ...player.cosmetics, ...chosen },
          updatedAt: this.clock.now(),
        })
        .where(eq(players.userId, userId))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, NICKNAME_INDEX))
        throw new AppError("CONFLICT", {
          fieldErrors: { nickname: ["taken"] },
        });
      throw error;
    }
    if (!updated) throw new AppError("NOT_FOUND");
    await this.pushUpdate(userId);
    return this.toProfile(updated, entitlements);
  }

  /** `player.updated` to every open socket: changes land without re-login (TC-BS-09). */
  async pushUpdate(userId: string): Promise<void> {
    if (!this.registry.isOnline(userId)) return;
    const player = await this.summary(userId);
    this.registry.send(userId, { type: "player.updated", payload: { player } });
  }
}
