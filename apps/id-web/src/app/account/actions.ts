"use server";

import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { clearSession, REFRESH_COOKIE } from "@outegro/bff/session";
import { setLocale } from "@outegro/i18n/actions";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authApi, notificationsApi, withSession } from "@/lib/api";

export type FormState = {
  status: "idle" | "saved" | "conflict" | "error" | "invalid";
  message?: string;
};

const outcome = (error: unknown): FormState => {
  if (error instanceof BackendError && error.error.code === "VERSION_CONFLICT")
    return { status: "conflict" };
  if (error instanceof BackendError && error.status < 500)
    return { status: "invalid" };
  if (error instanceof BackendUnavailable) return { status: "error" };
  throw error;
};

const profileSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  displayName: z.string().trim().max(80),
  locale: z.enum(["en", "ru"]),
});

export async function updateProfile(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const input = profileSchema.safeParse(Object.fromEntries(form));
  if (!input.success) return { status: "invalid" };
  try {
    await withSession("/account", (token) =>
      authApi("/v1/me", {
        method: "PATCH",
        accessToken: token,
        body: {
          expectedVersion: input.data.expectedVersion,
          displayName: input.data.displayName || null,
          locale: input.data.locale,
        },
      }),
    );
  } catch (error) {
    return outcome(error);
  }
  // The account language also becomes this browser's language (TC-ID-09-02).
  await setLocale(input.data.locale);
  revalidatePath("/account", "layout");
  return { status: "saved" };
}

export async function revokeSession(form: FormData) {
  const id = z.uuid().parse(form.get("sessionId"));
  await withSession("/account/sessions", (token) =>
    authApi(`/v1/me/sessions/${id}`, {
      method: "DELETE",
      accessToken: token,
    }).catch((error) => {
      if (error instanceof BackendError && error.status === 404) return;
      throw error;
    }),
  );
  revalidatePath("/account/sessions");
}

export async function revokeOtherSessions(_: {
  revoked?: number;
}): Promise<{ revoked?: number }> {
  const result = await withSession("/account/sessions", (token) =>
    authApi<{ revoked: number }>("/v1/me/sessions/revoke-all", {
      method: "POST",
      accessToken: token,
      body: {},
    }),
  );
  revalidatePath("/account/sessions");
  return { revoked: result.revoked };
}

export async function markRead(form: FormData) {
  const id = z.uuid().parse(form.get("itemId"));
  await withSession("/account/inbox", (token) =>
    notificationsApi(`/v1/me/inbox/${id}/read`, {
      method: "POST",
      accessToken: token,
    }),
  );
  revalidatePath("/account/inbox");
}

export async function savePreferences(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const version = Number(form.get("version"));
  const items = String(form.get("keys") ?? "")
    .split(",")
    .filter(Boolean)
    .map((key) => {
      const [category, channel] = key.split(".");
      return { category, channel, enabled: form.get(key) === "on" };
    });
  try {
    await withSession("/account/notifications", (token) =>
      notificationsApi("/v1/me/notification-preferences", {
        method: "PATCH",
        accessToken: token,
        body: { expectedVersion: version, items },
      }),
    );
  } catch (error) {
    return outcome(error);
  }
  revalidatePath("/account/notifications");
  return { status: "saved" };
}

/** Ends this browser's session on the server, then forgets the cookies. */
export async function signOut() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await authApi("/v1/sessions/logout", {
      method: "POST",
      body: { refreshToken },
    }).catch(() => undefined);
  }
  clearSession(jar);
  redirect("/login");
}
