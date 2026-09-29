import {
  isSecureRequest,
  REFRESH_COOKIE,
  type SessionTokens,
  writeSession,
} from "@outegro/bff/session";
import { cookies, headers } from "next/headers";
import { authApi } from "./api";

/**
 * Starts this browser's session from a server action. A session the browser
 * held before (signing in again to confirm it is you) is ended, so the new
 * one replaces it instead of staying behind in the session list.
 */
export async function startSession(tokens: SessionTokens) {
  const jar = await cookies();
  const previous = jar.get(REFRESH_COOKIE)?.value;
  const requestHeaders = await headers();
  writeSession(
    jar,
    tokens,
    isSecureRequest(requestHeaders, requestHeaders.get("origin") ?? ""),
  );
  if (previous) await endSession(previous);
}

/** Ends a session by its refresh token; an unknown or dead one is a no-op. */
export async function endSession(refreshToken: string) {
  await authApi("/v1/sessions/logout", {
    method: "POST",
    body: { refreshToken },
  }).catch(() => undefined);
}
