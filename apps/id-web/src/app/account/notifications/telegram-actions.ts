"use server";

import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { revalidatePath } from "next/cache";
import { accessToken, notificationsApi } from "@/lib/api";

export type TelegramStatus = {
  available: boolean;
  linked: boolean;
  linkedAt: string | null;
  botUsername: string | null;
};

type LinkResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; error: "signed_out" | "unavailable" | "rate_limited" };

/** A fresh one-time t.me link; the bot links the chat when the user presses Start. */
export async function createTelegramLink(): Promise<LinkResult> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "signed_out" };
  try {
    const link = await notificationsApi<{ url: string; expiresAt: string }>(
      "/v1/me/telegram/link",
      { method: "POST", accessToken: token },
    );
    return { ok: true, ...link };
  } catch (error) {
    if (error instanceof BackendError && error.status === 401)
      return { ok: false, error: "signed_out" };
    if (error instanceof BackendError && error.status === 429)
      return { ok: false, error: "rate_limited" };
    if (error instanceof BackendError || error instanceof BackendUnavailable)
      return { ok: false, error: "unavailable" };
    throw error;
  }
}

/** Polled while the user is in Telegram; null means "cannot tell right now". */
export async function telegramStatus(): Promise<TelegramStatus | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    return await notificationsApi<TelegramStatus>("/v1/me/telegram", {
      accessToken: token,
    });
  } catch {
    return null;
  }
}

export async function disconnectTelegram(): Promise<{ ok: boolean }> {
  const token = await accessToken();
  if (!token) return { ok: false };
  try {
    await notificationsApi("/v1/me/telegram", {
      method: "DELETE",
      accessToken: token,
    });
  } catch {
    return { ok: false };
  }
  revalidatePath("/account/notifications");
  return { ok: true };
}
