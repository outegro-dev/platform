import type { Operator } from "./adapters/identity";

/**
 * Monitoring is Grafana, served by the cluster under /grafana/ on this
 * console's own host. Traefik asks GRAFANA_AUTH_PATH (ForwardAuth) before
 * every Grafana request; the console decides who gets in and as whom.
 */
export const GRAFANA_PATH = "/grafana/";
export const GRAFANA_AUTH_PATH = "/api/grafana/auth";
/**
 * A console route on the way back to Grafana: the proxy refreshes the
 * session there (ForwardAuth answers cannot set cookies), checks idleness
 * and stamps activity. Not under /grafana, so Traefik never sends it there.
 */
export const MONITORING_PATH = "/monitoring";

/** Longest Grafana address kept for the way back (the sign-in cookie holds it). */
const MAX_RETURN_LENGTH = 2000;
const BASE = "https://grafana.invalid";

/**
 * Where to send the browser back to: a path on this host under /grafana/,
 * from Traefik's X-Forwarded-Uri or `/monitoring?to=`. Absolute and
 * protocol-relative URLs, backslashes, control characters, encoded slashes,
 * backslashes or dots, and dot segments that leave /grafana/ all fall back
 * to /grafana/.
 */
export function grafanaReturnPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length > MAX_RETURN_LENGTH)
    return GRAFANA_PATH;
  if (value === "/grafana") return GRAFANA_PATH;
  if (
    !value.startsWith(GRAFANA_PATH) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
    /[\\\u0000-\u001f\u007f]/.test(value) ||
    /%(2f|5c|2e)/i.test(value)
  )
    return GRAFANA_PATH;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE || !url.pathname.startsWith(GRAFANA_PATH))
      return GRAFANA_PATH;
    return `${url.pathname}${url.search}`;
  } catch {
    return GRAFANA_PATH;
  }
}

/** `/monitoring?to=…`: the console route that refreshes and returns. */
export function monitoringPath(returnTo: string): string {
  return `${MONITORING_PATH}?to=${encodeURIComponent(returnTo)}`;
}

export type GrafanaRole = "Admin" | "Viewer";

/**
 * Grafana's organisation role for the operator, from fresh Identity data:
 * the owner role administers Grafana, `monitoring.read` (auditors, service
 * operators, anyone an owner grants it) views it, everyone else stays out.
 * An account that is not active gets nothing, whatever its roles.
 */
export function grafanaRole(
  operator: Pick<Operator, "status" | "roles" | "permissions">,
): GrafanaRole | null {
  if (operator.status !== "active") return null;
  if (operator.roles.includes("owner")) return "Admin";
  if (operator.permissions.includes("monitoring.read")) return "Viewer";
  return null;
}

/**
 * Header values are ASCII here, and Grafana (auth proxy with
 * `headers_encoded = true`) reads them as quoted-printable: printable ASCII
 * passes unchanged, anything else, "=" included, becomes =XX per UTF-8 byte.
 */
export function quotedPrintable(value: string): string {
  let encoded = "";
  for (const byte of new TextEncoder().encode(value)) {
    encoded +=
      byte >= 0x20 && byte <= 0x7e && byte !== 0x3d
        ? String.fromCharCode(byte)
        : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

/** One line of visible text: control characters and runs of space collapse. */
const oneLine = (value: string | null | undefined) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  (value ?? "").replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();

/**
 * Who Grafana's auth proxy signs in: the email in lower case is the stable
 * login, the display name falls back to it. Always all four headers,
 * never empty; null when the operator has no email to be known by.
 */
export function grafanaHeaders(
  operator: Pick<Operator, "email" | "displayName">,
  role: GrafanaRole,
): Record<string, string> | null {
  const email = oneLine(operator.email).toLowerCase();
  if (!email) return null;
  const name = oneLine(operator.displayName) || email;
  return {
    "X-WEBAUTH-USER": quotedPrintable(email),
    "X-WEBAUTH-EMAIL": quotedPrintable(email),
    "X-WEBAUTH-NAME": quotedPrintable(name),
    "X-WEBAUTH-ROLE": role,
  };
}
