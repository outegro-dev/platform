"use server";

import { BackendError } from "@outegro/bff/backend";
import { redirect } from "next/navigation";
import { accessToken, authApi } from "@/lib/api";
import { googleErrorKey } from "@/lib/google";

const signIn = `/login?continue=${encodeURIComponent("/account/security")}`;

/** Unlinks Google; the server refuses to remove the last way to sign in. */
export async function unlinkGoogle() {
  const token = await accessToken();
  if (!token) redirect(signIn);
  let target = "/account/security?unlinked=google";
  try {
    await authApi("/v1/me/identities/google", {
      method: "DELETE",
      accessToken: token,
    });
  } catch (error) {
    target =
      error instanceof BackendError && error.status === 401
        ? signIn
        : `/account/security?error=${googleErrorKey(error)}`;
  }
  redirect(target);
}
