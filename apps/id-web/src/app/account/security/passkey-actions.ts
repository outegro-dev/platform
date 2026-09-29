"use server";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accessToken, authApi } from "@/lib/api";
import { passkeyName } from "@/lib/passkey-name";
import {
  ceremonyResponse,
  type PasskeyItem,
  passkeyOutcome,
  type Result,
} from "@/lib/passkeys";

const PAGE = "/account/security";

/** Runs a call with this browser's session; a refusal becomes its outcome. */
async function asUser<T extends object>(
  call: (token: string) => Promise<T>,
): Promise<Result<T>> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "signed_out" };
  try {
    return { ok: true, ...(await call(token)) };
  } catch (error) {
    return { ok: false, error: passkeyOutcome(error) };
  }
}

/**
 * Creation options for a new passkey. auth-backend asks for a recent sign-in
 * (`reauth_required` otherwise: the page links to signing in again).
 */
export async function passkeyRegistrationOptions() {
  return asUser((token) =>
    authApi<{
      challengeId: string;
      options: PublicKeyCredentialCreationOptionsJSON;
    }>("/v1/me/passkeys/options", { method: "POST", accessToken: token }),
  );
}

export async function registerPasskey(
  challengeId: string,
  name: string,
  response: unknown,
): Promise<Result<{ item: PasskeyItem }>> {
  const label = passkeyName(name);
  if (!label) return { ok: false, error: "invalid_name" };
  const id = z.uuid().safeParse(challengeId);
  const answer = ceremonyResponse.safeParse(response);
  if (!id.success || !answer.success) return { ok: false, error: "failed" };
  const result = await asUser(async (token) => ({
    item: await authApi<PasskeyItem>("/v1/me/passkeys", {
      method: "POST",
      accessToken: token,
      body: { challengeId: id.data, name: label, response: answer.data },
    }),
  }));
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function renamePasskey(id: string, name: string): Promise<Result> {
  const label = passkeyName(name);
  if (!label) return { ok: false, error: "invalid_name" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "not_found" };
  const result = await asUser((token) =>
    authApi<PasskeyItem>(`/v1/me/passkeys/${id}`, {
      method: "PATCH",
      accessToken: token,
      body: { name: label },
    }),
  );
  if (result.ok || result.error === "not_found") revalidatePath(PAGE);
  return result.ok ? { ok: true } : result;
}

/** Refused while it is the last way to sign in (`last_method`). */
export async function removePasskey(id: string): Promise<Result> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "not_found" };
  const result = await asUser(async (token) => {
    await authApi(`/v1/me/passkeys/${id}`, {
      method: "DELETE",
      accessToken: token,
    });
    return {};
  });
  if (result.ok || result.error === "not_found") revalidatePath(PAGE);
  return result;
}
