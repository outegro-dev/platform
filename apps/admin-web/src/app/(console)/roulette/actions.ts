"use server";

import { adminReasonSchema } from "@outegro/contracts";
import { dailyPrizeSchema } from "@outegro/contracts/daily-bonus";
import { z } from "zod";
import { runPreviewable } from "@/lib/actions";
import type { DailyPreview } from "@/lib/adapters/daily";
import type { TablePreview, VoidPreview } from "@/lib/adapters/roulette";
import { chancesSumToOne } from "@/lib/roulette";

/**
 * Roulette commands. Each is posted twice from its dialog: `intent=preview`
 * asks the service what would change (`preview: true`), `intent=confirm`
 * sends the same body without it. The actor is whoever the token belongs
 * to; the reason and the expected version go to the service as they are.
 */

const flag = z.enum(["true", "false"]).transform((value) => value === "true");
const amount = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const expectedVersion = z.coerce.number().int().nonnegative();

/** The prize table travels as JSON: FormData keeps one value per name. */
const prizeTable = z
  .string()
  .transform((text, context) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "not json" });
      return z.NEVER;
    }
  })
  .pipe(z.array(dailyPrizeSchema).min(1).max(20))
  .refine(chancesSumToOne, { message: "chances_must_sum_to_one" });

const voidSchema = z.object({ round: amount, reason: adminReasonSchema });

/** Cancels a round that is not paid out yet and returns every bet. */
export async function voidRound(form: FormData) {
  return runPreviewable<typeof voidSchema, VoidPreview>({
    permission: "roulette.void",
    form,
    schema: voidSchema,
    run: (services, input, preview) =>
      services.roulette.voidRound(input.round, {
        reason: input.reason,
        preview,
      }),
    success: (t, input, result) =>
      t("done.roundVoided", { round: input.round, count: result.bets }),
    // 422: settled or voided already; 409: it started paying out meanwhile.
    explain: (error) =>
      error.error.code === "UNPROCESSABLE" || error.error.code === "CONFLICT"
        ? "round-closed"
        : null,
  });
}

const tableSchema = z
  .object({
    minBet: amount,
    maxBet: amount,
    betsPerRound: z.coerce.number().int().min(1).max(20),
    payoutLimitPerColor: amount,
    paused: flag,
    maintenance: flag,
    expectedVersion,
    reason: adminReasonSchema,
  })
  .refine((input) => input.minBet <= input.maxBet, {
    message: "min_above_max",
    path: ["minBet"],
  });

/** Bet limits, the payout limit per colour, pausing bets, maintenance. */
export async function changeTable(form: FormData) {
  return runPreviewable<typeof tableSchema, TablePreview>({
    permission: "roulette.manage",
    form,
    schema: tableSchema,
    run: (services, input, preview) =>
      services.roulette.setTable({ ...input, preview }),
    success: (t) => t("done.tableChanged"),
  });
}

const dailySchema = z.object({
  enabled: flag,
  streaksEnabled: flag,
  prizes: prizeTable,
  expectedVersion,
  reason: adminReasonSchema,
});

/** The bonus of the day: on or off, streaks, the prize table. */
export async function changeDaily(form: FormData) {
  return runPreviewable<typeof dailySchema, DailyPreview>({
    permission: "roulette.manage",
    form,
    schema: dailySchema,
    run: (services, input, preview) =>
      services.daily.setSettings({ ...input, preview }),
    success: (t) => t("done.dailyChanged"),
  });
}
