import { Inject, Injectable } from "@nestjs/common";
import { battleshipFeatures } from "@outegro/contracts/battleship";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, eq, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { BattleshipDatabase } from "../common/database.js";
import { grants } from "../db/schema.js";
import { Entitlements, type GrantRecord } from "../domain/entitlements.js";

/** Reads the grants projection; the rules live in the Entitlements class. */
@Injectable()
export class EntitlementsService {
  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private records(userId: string): Promise<GrantRecord[]> {
    return this.database.db
      .select({
        feature: grants.feature,
        state: grants.state,
        validFrom: grants.validFrom,
        validUntil: grants.validUntil,
      })
      .from(grants)
      .where(eq(grants.userId, userId));
  }

  async of(userId: string): Promise<Entitlements> {
    return Entitlements.from(await this.records(userId), this.clock.now());
  }

  /** When the user's features next change by time alone (a grant starts or ends). */
  async nextChange(userId: string): Promise<Date | null> {
    return Entitlements.nextChange(
      await this.records(userId),
      this.clock.now(),
    );
  }

  /** Every grant of a user, in force or not (admin). */
  list(userId: string) {
    return this.database.db
      .select()
      .from(grants)
      .where(eq(grants.userId, userId))
      .orderBy(grants.validFrom);
  }

  /** SQL condition "this user has Premium now", for lists (leaderboard, history). */
  premiumCondition(userId: AnyPgColumn | SQL): SQL {
    const now = this.clock.now();
    return sql`exists (select 1 from ${grants} where ${and(
      sql`${grants.userId} = ${userId}`,
      eq(grants.feature, battleshipFeatures.premium),
      eq(grants.state, "active"),
      lte(grants.validFrom, now),
      or(isNull(grants.validUntil), gt(grants.validUntil, now)),
    )})`;
  }
}
