import { safeReturnUrl } from "@outegro/bff/safe-redirect";
import type { PlatformSite } from "@outegro/ui/lib/platform";
import { platformUrls } from "./env";

/*
 * "Back to Battleship": apps and the portfolio site link here with
 * ?return=<their page>. Only an absolute URL on the origin of one of them
 * counts (see safeReturnUrl); anything else is ignored. The accepted target
 * is kept in a host-only cookie for a while, so it survives moving between
 * purchases and subscriptions, and is checked against the list again
 * whenever it is read.
 */

export const RETURN_COOKIE = "og_return";
/** Long enough to look around, short enough not to linger for days. */
export const RETURN_MAX_AGE_SECONDS = 2 * 60 * 60;

/** Sites a buyer may come from, the only places "Back to …" leads. */
export const returnApps: readonly PlatformSite[] = [
  "battleship",
  "edu",
  "id",
  "admin",
  "site",
];

const appByOrigin = new Map(
  returnApps.map((app) => [new URL(platformUrls[app]).origin, app] as const),
);

export type ReturnTarget = { href: string; app: PlatformSite };

/** The way back for a `?return=` value or the cookie; null when not allowed. */
export function returnTarget(
  value: string | null | undefined,
): ReturnTarget | null {
  const href = safeReturnUrl(value, [...appByOrigin.keys()]);
  if (!href) return null;
  const app = appByOrigin.get(new URL(href).origin);
  return app ? { href, app } : null;
}
