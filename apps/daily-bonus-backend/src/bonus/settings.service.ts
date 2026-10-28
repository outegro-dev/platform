import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type {
  DailySettings,
  dailySettingsCommandSchema,
} from "@outegro/contracts/daily-bonus";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  DATABASE,
} from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { DailyDatabase } from "../common/database.js";
import { adminAudit, settings } from "../db/schema.js";
import { defaultPrizes, expectedPrize } from "./rules.js";

type Row = typeof settings.$inferSelect;

const view = (row: Row): DailySettings => ({
  enabled: row.enabled,
  streaksEnabled: row.streaksEnabled,
  prizes: row.prizes,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The bonus switches and prize table (owner, 28.10.2026: streaks on). The
 * defaults are seeded once; the console changes them with a preview, the
 * expected version and a reason, and every change is audited.
 */
@Injectable()
export class SettingsService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: DailyDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap() {
    await this.database.db
      .insert(settings)
      .values({
        id: 1,
        enabled: true,
        streaksEnabled: true,
        prizes: defaultPrizes,
        updatedAt: this.clock.now(),
      })
      .onConflictDoNothing();
  }

  async current(): Promise<DailySettings> {
    const [row] = await this.database.db
      .select()
      .from(settings)
      .where(eq(settings.id, 1));
    if (!row) throw new Error("bonus settings missing");
    return view(row);
  }

  async command(
    actor: AuthenticatedUser,
    body: z.infer<typeof dailySettingsCommandSchema>,
    requestId: string | undefined,
  ) {
    const before = await this.current();
    if (before.version !== body.expectedVersion)
      throw new AppError("VERSION_CONFLICT");
    const now = this.clock.now();
    const after: DailySettings = {
      enabled: body.enabled,
      streaksEnabled: body.streaksEnabled,
      prizes: body.prizes,
      version: before.version + 1,
      updatedAt: now.toISOString(),
    };
    const result = (saved: DailySettings, preview: boolean) => ({
      preview,
      before,
      after: saved,
      expectedPrizeBefore: expectedPrize(before.prizes),
      expectedPrizeAfter: expectedPrize(saved.prizes),
    });
    if (body.preview) return result(after, true);
    const saved = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(settings)
        .set({
          enabled: after.enabled,
          streaksEnabled: after.streaksEnabled,
          prizes: after.prizes,
          version: after.version,
          updatedAt: now,
          updatedBy: actor.userId,
        })
        .where(eq(settings.version, body.expectedVersion))
        .returning();
      if (!row) throw new AppError("VERSION_CONFLICT");
      await tx.insert(adminAudit).values({
        id: randomUUID(),
        actorId: actor.userId,
        action: "settings.update",
        reason: body.reason,
        before,
        after: view(row),
        requestId: requestId ?? null,
        createdAt: now,
      });
      return view(row);
    });
    return result(saved, false);
  }
}
