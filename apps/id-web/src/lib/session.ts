import {
  type CookieWriter,
  clearHint,
  clearSession,
  isSecureRequest,
  REFRESH_COOKIE,
  type SessionTokens,
  writeHint,
  writeSession,
} from "@outegro/bff/session";
import { cookies, headers } from "next/headers";
import { authApi } from "./api";
import { hintCookieDomain } from "./env";

/**
 * This browser's session here, and beside it the platform's sign-in hint
 * that lets the other apps sign in silently. The hint ends with the
 * session; the proxy renews and drops it from then on.
 */
export function writeIdSession(
  jar: CookieWriter,
  tokens: SessionTokens,
  secure: boolean,
) {
  writeSession(jar, tokens, secure);
  writeHint(jar, tokens, secure, hintCookieDomain);
}

/** HTTPS as a server action sees it. */
async function secureAction() {
  const requestHeaders = await headers();
  return isSecureRequest(requestHeaders, requestHeaders.get("origin") ?? "");
}

/**
 * Starts this browser's session from a server action. A session the browser
 * held before (signing in again to confirm it is you) is ended, so the new
 * one replaces it instead of staying behind in the session list.
 */
export async function startSession(tokens: SessionTokens) {
  const jar = await cookies();
  const previous = jar.get(REFRESH_COOKIE)?.value;
  writeIdSession(jar, tokens, await secureAction());
  if (previous) await endSession(previous);
}

/** Forgets this browser's session, and the hint with it, from a server action. */
export async function forgetSession() {
  const jar = await cookies();
  clearSession(jar);
  clearHint(jar, await secureAction(), hintCookieDomain);
}

/** Ends a session by its refresh token; an unknown or dead one is a no-op. */
export async function endSession(refreshToken: string) {
  await authApi("/v1/sessions/logout", {
    method: "POST",
    body: { refreshToken },
  }).catch(() => undefined);
}
