import { type NextRequest, NextResponse } from "next/server";
import { fromThisApp } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The idle timer reports recent activity (reading a long page makes no
 * requests). The proxy has already refreshed the session and stamped
 * `og_admin_seen`; a signed-out or idle session never reaches this handler.
 */
export function POST(request: NextRequest) {
  if (!fromThisApp(request)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
