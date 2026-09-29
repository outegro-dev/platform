"use server";

import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import type { SessionTokens } from "@outegro/bff/session";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authApi } from "@/lib/api";
import { ceremonyResponse, passkeyOutcome, type Result } from "@/lib/passkeys";
import { startSession } from "@/lib/session";

type Options = {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
};

/** A one-time challenge for a usernameless passkey sign-in (button or autofill). */
export async function passkeySignInOptions(): Promise<Result<Options>> {
  try {
    const begun = await authApi<Options>("/v1/login/passkey/options", {
      method: "POST",
    });
    return { ok: true, ...begun };
  } catch (error) {
    return { ok: false, error: passkeyOutcome(error) };
  }
}

/**
 * Hands the browser's answer to auth-backend. A verified passkey is an
 * ordinary session: the cookies are set here and the browser continues
 * where it was going, an app's /authorize included.
 */
export async function passkeySignIn(
  challengeId: string,
  response: unknown,
  continueTo: string,
): Promise<Result> {
  const id = z.uuid().safeParse(challengeId);
  const answer = ceremonyResponse.safeParse(response);
  if (!id.success || !answer.success) return { ok: false, error: "failed" };
  let tokens: SessionTokens;
  try {
    tokens = await authApi<SessionTokens>("/v1/login/passkey/verify", {
      method: "POST",
      body: { challengeId: id.data, response: answer.data },
    });
  } catch (error) {
    return { ok: false, error: passkeyOutcome(error) };
  }
  await startSession(tokens);
  redirect(safeRedirectPath(continueTo, "/account"));
}
