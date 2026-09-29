/** The viewer's IANA time zone, written by the browser (TimeZoneSync). */
export const TIME_ZONE_COOKIE = "og_tz";

/** IANA names are cookie-safe as they are: letters, digits, / _ + -. */
const IANA = /^[A-Za-z0-9/_+-]{1,64}$/;

/**
 * Value for document.cookie: a year, this host only, readable by the
 * server; null when the name is not a plain IANA zone.
 */
export function timeZoneCookie(timeZone: string, secure: boolean) {
  if (!IANA.test(timeZone)) return null;
  return [
    `${TIME_ZONE_COOKIE}=${timeZone}`,
    "path=/",
    "max-age=31536000",
    "samesite=lax",
    ...(secure ? ["secure"] : []),
  ].join("; ");
}
