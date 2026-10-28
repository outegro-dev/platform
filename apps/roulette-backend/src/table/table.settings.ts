import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type {
  TableSettings,
  tableCommandSchema,
} from "@outegro/contracts/roulette";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  DATABASE,
} from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { RouletteDatabase } from "../common/database.js";
import { tableConfig } from "../config/config.js";
import { adminAudit, tableSettings } from "../db/schema.js";

/** A change reaches every replica within this long. */
const REFRESH_MS = 1000;

type Row = typeof tableSettings.$inferSelect;

function view(row: Row): TableSettings {
  return {
    minBet: row.minBet,
    maxBet: row.maxBet,
    betsPerRound: row.betsPerRound,
    payoutLimitPerColor: row.payoutLimitPerColor,
    paused: row.paused,
    maintenance: row.maintenance,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The table's limits and switches (ADR-012). The env seeds the row once;
 * afterwards only an admin command changes it: preview, then the change
 * with the expected version and a reason, audited. Replicas read it at most
 * a second old, which is what a bet sees.
 */
@Injectable()
export class TableSettingsService implements OnApplicationBootstrap {
  private cached: { settings: TableSettings; at: number } | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: RouletteDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(tableConfig.KEY)
    private readonly defaults: ConfigType<typeof tableConfig>,
  ) {}

  async onApplicationBootstrap() {
    await this.database.db
      .insert(tableSettings)
      .values({ id: 1, ...this.defaults, updatedAt: this.clock.now() })
      .onConflictDoNothing();
  }

  async current(): Promise<TableSettings> {
    if (this.cached && Date.now() - this.cached.at < REFRESH_MS)
      return this.cached.settings;
    return this.reload();
  }

  async reload(): Promise<TableSettings> {
    const [row] = await this.database.db
      .select()
      .from(tableSettings)
      .where(eq(tableSettings.id, 1));
    if (!row) throw new Error("table settings missing");
    const settings = view(row);
    this.cached = { settings, at: Date.now() };
    return settings;
  }

  async command(
    actor: AuthenticatedUser,
    body: z.infer<typeof tableCommandSchema>,
    requestId: string | undefined,
  ) {
    const before = await this.reload();
    if (before.version !== body.expectedVersion)
      throw new AppError("VERSION_CONFLICT");
    const after: TableSettings = {
      minBet: body.minBet,
      maxBet: body.maxBet,
      betsPerRound: body.betsPerRound,
      payoutLimitPerColor: body.payoutLimitPerColor,
      paused: body.paused,
      maintenance: body.maintenance,
      version: before.version + 1,
      updatedAt: this.clock.now().toISOString(),
    };
    if (body.preview) return { preview: true, before, after };
    const now = this.clock.now();
    const saved = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(tableSettings)
        .set({
          minBet: after.minBet,
          maxBet: after.maxBet,
          betsPerRound: after.betsPerRound,
          payoutLimitPerColor: after.payoutLimitPerColor,
          paused: after.paused,
          maintenance: after.maintenance,
          version: after.version,
          updatedAt: now,
          updatedBy: actor.userId,
        })
        .where(eq(tableSettings.version, body.expectedVersion))
        .returning();
      if (!row) throw new AppError("VERSION_CONFLICT");
      await tx.insert(adminAudit).values({
        id: randomUUID(),
        actorId: actor.userId,
        action: "table.update",
        subject: "table",
        reason: body.reason,
        before,
        after: view(row),
        requestId: requestId ?? null,
        createdAt: now,
      });
      return view(row);
    });
    this.cached = { settings: saved, at: Date.now() };
    return { preview: false, before, after: saved };
  }
}
