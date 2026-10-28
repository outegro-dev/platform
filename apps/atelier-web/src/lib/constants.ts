/** Request header set by src/proxy.ts: the requested path, for return-after-sign-in. */
export const PATH_HEADER = "x-atelier-path";

/** Request header set by src/proxy.ts: the CSP nonce of this response. */
export const NONCE_HEADER = "x-nonce";

/** The owner's IANA time zone, written by the browser (TimezoneSync). */
export const TZ_COOKIE = "og_tz";

/** light | dark; absent means "as the system". Read by the server and an inline script. */
export const THEME_COOKIE = "atelier_theme";
