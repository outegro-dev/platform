import { Inject, Injectable } from "@nestjs/common";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { RouletteDatabase } from "../common/database.js";
import { isUniqueViolation } from "../common/pg-errors.js";
import { players } from "../db/schema.js";
import { defaultNickname } from "../domain/ids.js";

export type PlayerRow = typeof players.$inferSelect;

const NICKNAME_INDEX = "players_nickname_uq";

/** Roulette accounts: created on first access with a "Player NNNN" nickname. */
@Injectable()
export class PlayersService {
  constructor(
    @Inject(DATABASE) private readonly database: RouletteDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async find(userId: string): Promise<PlayerRow | null> {
    const [row] = await this.database.db
      .select()
      .from(players)
      .where(eq(players.userId, userId));
    return row ?? null;
  }

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
}
