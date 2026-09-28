"use server";

import { cookies, headers } from "next/headers";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  localeCookieDomain,
} from "./config";

/** Persist the visitor's language on the parent domain. */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  // Next keeps the proxy's x-forwarded-proto (Traefik: https) and sets "http"
  // otherwise, so plain-http previews (localhost, LAN IP) still get the cookie.
  const secure =
    requestHeaders.get("x-forwarded-proto")?.includes("https") ?? false;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    domain: localeCookieDomain(host),
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure,
  });
}
