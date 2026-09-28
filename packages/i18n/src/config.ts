/**
 * Locale contract shared by every outegro.dev frontend.
 * The URL never carries the language: one cookie on the parent domain
 * keeps the choice consistent across outegro.dev, id., pay., admin. and apps.
 */
export const locales = ["en", "ru"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const LOCALE_COOKIE = "og_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const ROOT_DOMAIN = "outegro.dev";

export const localeOptions = [
  { value: "en", label: "EN", name: "English" },
  { value: "ru", label: "RU", name: "Русский" },
] as const satisfies readonly { value: Locale; label: string; name: string }[];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}

/**
 * `.outegro.dev` on the production domain and its subdomains, host-only
 * elsewhere (localhost, previews). `LOCALE_COOKIE_DOMAIN` overrides it.
 */
export function localeCookieDomain(host: string | null | undefined) {
  const override = process.env.LOCALE_COOKIE_DOMAIN?.trim();
  if (override) return override;
  const hostname = host?.split(":")[0]?.toLowerCase() ?? "";
  return hostname === ROOT_DOMAIN || hostname.endsWith(`.${ROOT_DOMAIN}`)
    ? `.${ROOT_DOMAIN}`
    : undefined;
}
