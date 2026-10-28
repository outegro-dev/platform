import { z } from "zod";
import { adminReasonSchema, isoDateTime } from "./primitives.js";

/**
 * The daily bonus (owner, 28.10.2026): grumbles once every 24 hours,
 * counted from the moment the player took the last one, credited by
 * daily-bonus-backend through the wallet with `ref = daily:{userId}:{claimNo}`.
 */

/** Header the roulette-web BFF sets from its long-lived device cookie. */
export const deviceIdHeader = "x-device-id";
export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** One line of the prize table; chances of a table sum to 1. */
export const dailyPrizeSchema = z.object({
  amount: z.number().int().positive(),
  chance: z.number().gt(0).max(1),
});
export type DailyPrize = z.infer<typeof dailyPrizeSchema>;

/** Why the player cannot take the bonus at all (as opposed to "not yet"). */
export const dailyBlockSchema = z.enum([
  "email_unverified",
  "account_too_new",
  "account_closed",
  "disabled",
]);

export const dailyStatusSchema = z.object({
  /** Can be taken right now. */
  available: z.boolean(),
  /** When it can be taken next; null while available or blocked. */
  nextAt: isoDateTime.nullable(),
  blocked: dailyBlockSchema.nullable(),
  /** Days in a row so far; 0 while streaks are off. */
  streak: z.number().int().nonnegative(),
  /** What the streak adds to the next prize, in percent (0 while off). */
  streakBonusPercent: z.number().int().nonnegative(),
  prizes: z.array(dailyPrizeSchema),
});
export type DailyStatus = z.infer<typeof dailyStatusSchema>;

export const dailyClaimSchema = z.object({
  claimNo: z.number().int().positive(),
  /** The line of `prizes` the ribbon stops on. */
  prizeIndex: z.number().int().nonnegative(),
  /** The table amount, and what was credited with the streak bonus. */
  basePrize: z.number().int().positive(),
  prize: z.number().int().positive(),
  streak: z.number().int().nonnegative(),
  nextAt: isoDateTime,
  /** The wallet's balance after the credit; null when it did not say. */
  balance: z.number().int().nonnegative().nullable(),
});
export type DailyClaim = z.infer<typeof dailyClaimSchema>;

// Admin (admin-web, `roulette.read` / `roulette.manage`)

export const dailySettingsSchema = z.object({
  enabled: z.boolean(),
  streaksEnabled: z.boolean(),
  prizes: z.array(dailyPrizeSchema).min(1).max(20),
  version: z.number().int().nonnegative(),
  updatedAt: isoDateTime,
});
export type DailySettings = z.infer<typeof dailySettingsSchema>;

/** A command of the admin console: preview first, then the same body without it. */
export const dailySettingsCommandSchema = z
  .object({
    enabled: z.boolean(),
    streaksEnabled: z.boolean(),
    prizes: z.array(dailyPrizeSchema).min(1).max(20),
    expectedVersion: z.number().int().nonnegative(),
    reason: adminReasonSchema,
    preview: z.boolean().optional(),
  })
  .refine(
    (body) =>
      Math.abs(body.prizes.reduce((sum, prize) => sum + prize.chance, 0) - 1) <
      1e-9,
    { message: "chances_must_sum_to_one", path: ["prizes"] },
  );

export const dailyOverviewSchema = z.object({
  settings: dailySettingsSchema,
  /** Average prize of the table, before streak bonuses. */
  expectedPrize: z.number().nonnegative(),
  last24h: z.object({
    claims: z.number().int().nonnegative(),
    granted: z.number().int().nonnegative(),
  }),
  suspicions: z.array(
    z.object({
      kind: z.enum(["shared_ip", "shared_device"]),
      /** A hash, never the address or the device id itself. */
      key: z.string(),
      users: z.array(z.uuid()),
      claims: z.number().int().positive(),
      lastAt: isoDateTime,
    }),
  ),
});
export type DailyOverview = z.infer<typeof dailyOverviewSchema>;

export const dailySettingsResultSchema = z.object({
  preview: z.boolean(),
  before: dailySettingsSchema,
  after: dailySettingsSchema,
  expectedPrizeBefore: z.number().nonnegative(),
  expectedPrizeAfter: z.number().nonnegative(),
});
