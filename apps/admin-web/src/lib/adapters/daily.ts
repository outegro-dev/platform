import {
  type DailyOverview,
  type DailyPrize,
  type DailySettings,
  dailyOverviewSchema,
  dailySettingsResultSchema,
} from "@outegro/contracts/daily-bonus";
import type { z } from "zod";
import { OptionalServiceAdapter, parse } from "./base";

/**
 * daily-bonus-backend admin API (the roulette's bonus of the day; contract:
 * `@outegro/contracts/daily-bonus`). Every call carries the operator's own
 * token; the settings command is previewed first (`preview: true`).
 *
 *   GET  /v1/admin/daily            settings, expected prize, 24 h, suspicions   roulette.read
 *   POST /v1/admin/daily/settings {enabled, streaksEnabled, prizes,
 *        expectedVersion, reason, preview?}                                     roulette.manage
 *
 * Refusals: 409 VERSION_CONFLICT (changed meanwhile), 400 (chances that do
 * not sum to 1), 401 (a token older than the last role change), 403.
 */

export type DailyView = DailyOverview;
export type { DailyPrize, DailySettings };
export type DailyPreview = z.infer<typeof dailySettingsResultSchema>;
export type DailySuspicion = DailyOverview["suspicions"][number];

export type DailyChange = {
  enabled: boolean;
  streaksEnabled: boolean;
  prizes: DailyPrize[];
  expectedVersion: number;
  reason: string;
};

export class DailyAdmin extends OptionalServiceAdapter {
  async overview(): Promise<DailyView> {
    return parse(
      dailyOverviewSchema,
      await this.get("/v1/admin/daily", undefined, { list: true }),
      "daily bonus overview",
    );
  }

  /** The prize table and switches; with `preview`, before and after only. */
  async setSettings(
    input: DailyChange & { preview: boolean },
  ): Promise<DailyPreview> {
    const { preview, ...body } = input;
    return parse(
      dailySettingsResultSchema,
      await this.send("POST", "/v1/admin/daily/settings", {
        ...body,
        ...(preview ? { preview: true } : {}),
      }),
      "daily bonus settings",
    );
  }
}
