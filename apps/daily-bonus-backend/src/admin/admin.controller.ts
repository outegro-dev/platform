import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type DailyOverview,
  dailySettingsCommandSchema,
} from "@outegro/contracts/daily-bonus";
import {
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  CurrentUser,
  DATABASE,
  RequirePermissions,
} from "@outegro/nest-common";
import {
  and,
  count,
  countDistinct,
  gte,
  isNotNull,
  max,
  sql,
} from "drizzle-orm";
import type { Request } from "express";
import type { z } from "zod";
import { expectedPrize } from "../bonus/rules.js";
import { SettingsService } from "../bonus/settings.service.js";
import type { DailyDatabase } from "../common/database.js";
import { claims } from "../db/schema.js";
import { CurrentAccessGuard } from "../identity/identity.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Shared networks and devices are looked for over a week. */
const SUSPICION_WINDOW_MS = 7 * DAY_MS;

/**
 * The bonus in the admin console's «Рулетка» section: `roulette.read` to
 * look (claims, suspicions), `roulette.manage` to change the table.
 */
@Controller("admin/daily")
export class AdminController {
  constructor(
    @Inject(DATABASE) private readonly database: DailyDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @RequirePermissions("roulette.read")
  async overview(): Promise<DailyOverview> {
    const now = this.clock.now().getTime();
    const settings = await this.settings.current();
    const [last24h] = await this.database.db
      .select({
        claims: count(),
        granted: sql<number>`count(*) filter (where ${claims.status} = 'granted')::int`,
      })
      .from(claims)
      .where(gte(claims.claimedAt, new Date(now - DAY_MS)));
    const since = new Date(now - SUSPICION_WINDOW_MS);
    const shared = async (
      kind: "shared_ip" | "shared_device",
      column: typeof claims.ipHash | typeof claims.deviceHash,
    ) => {
      const rows = await this.database.db
        .select({
          key: column,
          users: sql<string[]>`array_agg(distinct ${claims.userId})`,
          claims: count(),
          lastAt: max(claims.claimedAt),
        })
        .from(claims)
        .where(and(isNotNull(column), gte(claims.claimedAt, since)))
        .groupBy(column)
        .having(sql`${countDistinct(claims.userId)} > 1`);
      return rows.map((row) => ({
        kind,
        // A prefix of the peppered hash: enough to tell groups apart.
        key: (row.key ?? "").slice(0, 12),
        users: row.users,
        claims: row.claims,
        lastAt: (row.lastAt ?? new Date(0)).toISOString(),
      }));
    };
    return {
      settings,
      expectedPrize: expectedPrize(settings.prizes),
      last24h: {
        claims: last24h?.claims ?? 0,
        granted: last24h?.granted ?? 0,
      },
      suspicions: [
        ...(await shared("shared_ip", claims.ipHash)),
        ...(await shared("shared_device", claims.deviceHash)),
      ],
    };
  }

  @Post("settings")
  @HttpCode(200)
  @RequirePermissions("roulette.manage")
  @UseGuards(CurrentAccessGuard)
  change(
    @CurrentUser() actor: AuthenticatedUser,
    @Body({ schema: dailySettingsCommandSchema }) body: z.infer<
      typeof dailySettingsCommandSchema
    >,
    @Req() request: Request & { id?: unknown },
  ) {
    return this.settings.command(
      actor,
      body,
      request.id === undefined ? undefined : String(request.id),
    );
  }
}
