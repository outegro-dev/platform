import type { NextRequest } from "next/server";
import { loadLeaderboard } from "@/lib/api";
import { respond } from "@/lib/respond";

export const dynamic = "force-dynamic";

/** Public leaderboard; with a session it includes the caller's own place. */
export async function GET(request: NextRequest) {
  const period =
    request.nextUrl.searchParams.get("period") === "week" ? "week" : "all";
  return respond(await loadLeaderboard(period));
}
