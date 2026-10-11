import { clientHeaders } from "@outegro/bff/client";
import {
  clearSession,
  isSecureRequest,
  markSilent,
  REFRESH_COOKIE,
} from "@outegro/bff/session";
import { endSession } from "@outegro/bff/sso";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { fromThisApp, sso, ssoOff } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Sign-out is a POST from the account menu's form: end the session in
 * Identity, then forget the cookies (locally even when Identity is
 * unreachable). og_silent says "out", so the session at id.outegro.dev
 * does not sign the visitor back in silently.
 */
export async function POST(request: NextRequest) {
  if (!sso) return ssoOff();
  if (!fromThisApp(request, sso.appUrl)) {
    return new NextResponse(null, { status: 403 });
  }
  await endSession(
    sso.authApiUrl,
    request.cookies.get(REFRESH_COOKIE)?.value,
    clientHeaders(request.headers, env.CLIENT_IP_SOURCE),
  );
  const response = NextResponse.redirect(new URL("/", sso.appUrl), 303);
  clearSession(response.cookies);
  markSilent(
    response.cookies,
    "out",
    isSecureRequest(request.headers, request.url),
  );
  return response;
}
