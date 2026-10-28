import { dailyBlockSchema } from "@outegro/contracts/daily-bonus";
import { z } from "zod";

/** The long-lived device cookie the BFF turns into `x-device-id`. */
export const DEVICE_COOKIE = "og_device";
export const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 3600;

/** Why the bonus could not be shown or taken, as the browser hears it from the BFF. */
export const dailyProblemSchema = z.discriminatedUnion("error", [
  z.object({ error: z.literal("not_yet") }),
  z.object({ error: z.literal("blocked"), reason: dailyBlockSchema }),
  z.object({ error: z.literal("rate_limited") }),
  z.object({ error: z.literal("signed_out") }),
  z.object({ error: z.literal("unavailable") }),
]);
export type DailyProblem = z.infer<typeof dailyProblemSchema>;

/**
 * daily-bonus-backend's refusal → what the BFF answers: 409 is "not yet"
 * (show the timer), 403 carries the reason in `fieldErrors.reason[0]`, 429
 * is too many bonuses from this network or device, anything else is "try
 * later". A 403 without a known reason reads as a closed account.
 */
export function dailyFailure(
  status: number,
  fieldErrors: Record<string, string[]> = {},
): { status: number; body: DailyProblem } {
  switch (status) {
    case 401:
      return { status: 401, body: { error: "signed_out" } };
    case 409:
      return { status: 409, body: { error: "not_yet" } };
    case 403: {
      const reason = dailyBlockSchema.safeParse(fieldErrors.reason?.[0]);
      return {
        status: 403,
        body: {
          error: "blocked",
          reason: reason.success ? reason.data : "account_closed",
        },
      };
    }
    case 429:
      return { status: 429, body: { error: "rate_limited" } };
    default:
      return { status: 503, body: { error: "unavailable" } };
  }
}
