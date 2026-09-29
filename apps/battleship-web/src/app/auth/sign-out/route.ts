import { clientHeaders } from "@outegro/bff/client";
import { clearSession, REFRESH_COOKIE } from "@outegro/bff/session";
import { endSession } from "@outegro/bff/sso";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { appUrl, fromThisApp } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Sign-out is a POST from this app's own form: end the session in Identity,
 * then forget the cookies (locally even when Identity is unreachable).
 */
export async function POST(request: NextRequest) {
  if (!fromThisApp(request)) {
    return new NextResponse(null, { status: 403 });
  }
  await endSession(
    env.AUTH_API_URL,
    request.cookies.get(REFRESH_COOKIE)?.value,
    clientHeaders(request.headers, env.CLIENT_IP_SOURCE),
  );
  const response = NextResponse.redirect(appUrl("/"), 303);
  clearSession(response.cookies);
  return response;
}
