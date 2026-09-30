import type { MatchStatus } from "./adapters/battleship";

/**
 * Why a finished match ended, as the console names it (`labels.finishReason`).
 * The server reports a loss on the placement clock as `timeout`, like one in
 * battle; the battle never started then (`battleStartedAt` is null), so it
 * reads as `not_deployed`: the loser did not place a fleet in time.
 */
export function finishReasonOf(match: {
  status: MatchStatus;
  reason: string | null;
  battleStartedAt: string | null;
}): string | null {
  if (match.status !== "finished" || !match.reason) return null;
  if (match.reason === "timeout" && match.battleStartedAt === null)
    return "not_deployed";
  return match.reason;
}
