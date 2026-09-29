"use server";

import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import type { SessionTokens } from "@outegro/bff/session";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { authApi } from "@/lib/api";
import { startSession } from "@/lib/session";

export type LoginState = {
  step: "email" | "code";
  email?: string;
  challengeId?: string;
  /** Seconds until a new code may be sent, measured on the server. */
  resendIn?: number;
  delivery?: "accepted" | "failed";
  error?: string;
};

// The browser clock may be off by minutes; only a duration travels to it.
const secondsUntil = (iso: string) =>
  Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));

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
        resendIn: secondsUntil(result.resendAfter),
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
  await startSession(tokens);
  redirect(safeRedirectPath(String(form.get("continue") ?? ""), "/account"));
}
