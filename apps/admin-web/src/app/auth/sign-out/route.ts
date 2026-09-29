import { clientHeaders } from "@outegro/bff/client";
import { clearSession, REFRESH_COOKIE } from "@outegro/bff/session";
import { endSession } from "@outegro/bff/sso";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { SEEN_COOKIE } from "@/lib/idle";
import { appUrl, fromThisApp } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Sign-out is a POST from this console's own form: end the session in
 * Identity, then forget the cookies (locally even when Identity is down).
 * `reason=idle` comes from the idle timer.
 */
export async function POST(request: NextRequest) {
  if (!fromThisApp(request)) {
    return new NextResponse(null, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const idle = form?.get("reason") === "idle";
  await endSession(
    env.AUTH_API_URL,
    request.cookies.get(REFRESH_COOKIE)?.value,
    clientHeaders(request.headers, env.CLIENT_IP_SOURCE),
  );
  const response = NextResponse.redirect(
    appUrl(idle ? "/sign-in?reason=idle" : "/sign-in?signedOut=1"),
    303,
  );
  clearSession(response.cookies);
  response.cookies.delete(SEEN_COOKIE);
  return response;
}
