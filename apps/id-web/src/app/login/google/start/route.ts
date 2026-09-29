import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import { isSecureRequest } from "@outegro/bff/session";
import { type NextRequest, NextResponse } from "next/server";
import { authApi } from "@/lib/api";
import {
  GOOGLE_COOKIE,
  GOOGLE_COOKIE_TTL_SECONDS,
  type GoogleConfig,
  type GoogleIntent,
  startGoogle,
} from "@/lib/google";
import { redirectTo } from "@/lib/redirect";

/** Sends the browser to Google; `intent=link` connects Google to the signed-in account. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const intent: GoogleIntent =
    params.get("intent") === "link" ? "link" : "login";
  const continueTo = safeRedirectPath(
    params.get("continue"),
    intent === "link" ? "/account/security" : "/account",
  );
  const unavailable = () =>
    redirectTo(
      intent === "link"
        ? "/account/security?error=google_unavailable"
        : `/login?error=google_unavailable&continue=${encodeURIComponent(continueTo)}`,
    );

  let config: GoogleConfig;
  try {
    config = await authApi<GoogleConfig>("/v1/login/google/config");
  } catch {
    return unavailable();
  }
  if (!config.enabled || !config.clientId || !config.redirectUri)
    return unavailable();

  const { url, cookie } = startGoogle(
    { clientId: config.clientId, redirectUri: config.redirectUri },
    intent,
    continueTo,
  );
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_COOKIE, cookie, {
    httpOnly: true,
    secure: isSecureRequest(request.headers, request.url),
    sameSite: "lax",
    path: "/",
    maxAge: GOOGLE_COOKIE_TTL_SECONDS,
  });
  return response;
}
