import type { NextRequest } from "next/server";
import { loadMatches } from "@/lib/api";
import { respond } from "@/lib/respond";

export const dynamic = "force-dynamic";

/** The next page of the player's match history. */
export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor");
  return respond(
    await loadMatches(cursor && cursor.length <= 512 ? cursor : null),
  );
}
