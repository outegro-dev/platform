import { BackendError, createBackend } from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "./env";

// Every call runs inside a request, so the browser identity is always at hand.
const forward = async () =>
  clientHeaders(await headers(), env.CLIENT_IP_SOURCE);
export const authApi = createBackend(env.AUTH_API_URL, { headers: forward });
export const notificationsApi = createBackend(env.NOTIFICATIONS_API_URL, {
  headers: forward,
});

export type Me = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  locale: "en" | "ru";
  status: string;
  version: number;
  createdAt: string;
  roles: string[];
  permissions: string[];
};
export type SessionItem = {
  id: string;
  authMethod: "email" | "google" | "passkey" | "sso";
  clientName: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
};
export type InboxPage = {
  items: {
    id: string;
    category: string;
    title: string;
    body: string;
    createdAt: string;
    readAt: string | null;
  }[];
  unreadCount: number;
  nextCursor: string | null;
};
export type Preferences = {
  version: number;
  items: {
    category: string;
    channel: string;
    enabled: boolean;
    mandatory: boolean;
  }[];
};

export async function accessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * The signed-in account for the header menu and the overview's links, once
 * per request. Optional: when it cannot be read the menu says "Your
 * account"; the page itself still asks with `withSession`.
 */
export const loadMe = cache(async (): Promise<Me | null> => {
  const token = await accessToken();
  if (!token) return null;
  try {
    return await authApi<Me>("/v1/me", { accessToken: token, timeoutMs: 3000 });
  } catch {
    return null;
  }
});

/**
 * Calls a user endpoint with the session token. A missing or rejected
 * session sends the user to sign-in; outages propagate to the error page.
 */
export async function withSession<T>(
  from: string,
  call: (token: string) => Promise<T>,
): Promise<T> {
  const token = await accessToken();
  if (!token) redirect(`/login?continue=${encodeURIComponent(from)}`);
  try {
    return await call(token);
  } catch (error) {
    if (error instanceof BackendError && error.status === 401) {
      redirect(`/login?continue=${encodeURIComponent(from)}`);
    }
    throw error;
  }
}
