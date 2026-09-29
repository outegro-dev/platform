import { BackendError } from "@outegro/bff/backend";
import {
  ACCESS_COOKIE,
  isSecureRequest,
  REFRESH_COOKIE,
  type SessionTokens,
  writeSession,
} from "@outegro/bff/session";
import type { NextRequest } from "next/server";
import { authApi } from "@/lib/api";
import {
  GOOGLE_COOKIE,
  type GoogleErrorKey,
  type GoogleIntent,
  googleErrorKey,
  readPending,
  sameState,
} from "@/lib/google";
import { redirectTo } from "@/lib/redirect";
import { endSession } from "@/lib/session";

/**
 * Google redirects here (registered redirect URI). The state must match the
 * pending request; the code goes to auth-backend once, with the PKCE verifier
 * and nonce. The pending cookie is dropped whatever happens.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pending = readPending(request.cookies.get(GOOGLE_COOKIE)?.value);

  const go = (target: string) => {
    const response = redirectTo(target);
    response.cookies.delete(GOOGLE_COOKIE);
    return response;
  };
  const fail = (intent: GoogleIntent, key: GoogleErrorKey) =>
    go(
      intent === "link"
        ? `/account/security?error=${key}`
        : `/login?error=${key}&continue=${encodeURIComponent(pending?.continueTo ?? "/account")}`,
    );

  if (!pending || !sameState(params.get("state"), pending.state))
    return go("/login?error=google_failed");
  if (params.get("error")) return fail(pending.intent, "google_cancelled");
  const code = params.get("code");
  if (!code) return fail(pending.intent, "google_failed");
  const exchange = {
    code,
    codeVerifier: pending.verifier,
    nonce: pending.nonce,
  };

  if (pending.intent === "login") {
    let tokens: SessionTokens;
    try {
      tokens = await authApi<SessionTokens>("/v1/login/google", {
        method: "POST",
        body: {
          ...exchange,
          locale:
            request.cookies.get("og_locale")?.value === "ru" ? "ru" : "en",
        },
      });
    } catch (error) {
      return fail("login", googleErrorKey(error));
    }
    const response = go(pending.continueTo);
    writeSession(
      response.cookies,
      tokens,
      isSecureRequest(request.headers, request.url),
    );
    // Signed in again to confirm it is you: the new session replaces the old.
    const previous = request.cookies.get(REFRESH_COOKIE)?.value;
    if (previous) await endSession(previous);
    return response;
  }

  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token)
    return go(`/login?continue=${encodeURIComponent("/account/security")}`);
  try {
    await authApi("/v1/me/identities/google", {
      method: "POST",
      accessToken: token,
      body: exchange,
    });
  } catch (error) {
    if (error instanceof BackendError && error.status === 401)
      return go(`/login?continue=${encodeURIComponent("/account/security")}`);
    return fail("link", googleErrorKey(error));
  }
  // Only to append a parameter; the base never leaves this function.
  const target = new URL(pending.continueTo, "http://id-web.local");
  target.searchParams.set("linked", "google");
  return go(`${target.pathname}${target.search}`);
}
