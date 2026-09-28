"use server";

import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import {
  isSecureRequest,
  type SessionTokens,
  writeSession,
} from "@outegro/bff/session";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { authApi } from "@/lib/api";

export type LoginState = {
  step: "email" | "code";
  email?: string;
  challengeId?: string;
  resendAfter?: string;
  delivery?: "accepted" | "failed";
  error?: string;
};

const emailSchema = z.email().max(254);
const codeSchema = z.string().regex(/^\d{6}$/);

function errorKey(error: unknown) {
  if (error instanceof BackendUnavailable) return "unavailable";
  if (error instanceof BackendError) {
    if (error.status === 429) return "rate_limited";
    return error.error.fieldErrors.code?.[0] ?? "invalid_code";
  }
  return "unavailable";
}

/** One action drives the whole flow: request a code, verify it, or start over. */
export async function loginAction(
  state: LoginState,
  form: FormData,
): Promise<LoginState> {
  const intent = form.get("intent");
  if (intent === "reset") return { step: "email" };

  if (intent === "request") {
    const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
    if (!email.success) return { step: "email", error: "invalid_email" };
    try {
      const result = await authApi<{
        challengeId: string;
        resendAfter: string;
        deliveryStatus: "accepted" | "failed";
      }>("/v1/login/challenges", {
        method: "POST",
        body: { email: email.data, locale: await getLocale() },
      });
      return {
        step: "code",
        email: email.data,
        challengeId: result.challengeId,
        resendAfter: result.resendAfter,
        delivery: result.deliveryStatus,
      };
    } catch (error) {
      return {
        ...state,
        step: state.challengeId ? "code" : "email",
        error: errorKey(error),
      };
    }
  }

  const code = codeSchema.safeParse(
    String(form.get("code") ?? "").replace(/\s/g, ""),
  );
  if (!code.success || !state.challengeId)
    return { ...state, error: "invalid_code" };
  let tokens: SessionTokens;
  try {
    tokens = await authApi<SessionTokens>("/v1/login/challenges/verify", {
      method: "POST",
      body: { challengeId: state.challengeId, code: code.data },
    });
  } catch (error) {
    return { ...state, error: errorKey(error) };
  }
  const requestHeaders = await headers();
  writeSession(
    await cookies(),
    tokens,
    isSecureRequest(requestHeaders, requestHeaders.get("origin") ?? ""),
  );
  redirect(safeRedirectPath(String(form.get("continue") ?? ""), "/account"));
}
