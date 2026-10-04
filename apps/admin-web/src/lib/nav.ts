/** Navigation keys and paths; safe for client components (no contracts import). */

export type NavKey =
  | "dashboard"
  | "users"
  | "notifications"
  | "payments"
  | "battleship"
  | "education"
  | "audit"
  | "monitoring";

export const navHref: Record<NavKey, string> = {
  dashboard: "/",
  users: "/users",
  notifications: "/notifications",
  payments: "/payments",
  battleship: "/battleship",
  education: "/education",
  audit: "/audit",
  // Grafana on this host, outside the console app (a full page load).
  monitoring: "/grafana/",
};

/** Items that leave the console app: plain links, never client routing. */
export const externalNav: ReadonlySet<NavKey> = new Set(["monitoring"]);

/** Which sidebar item a path belongs to (for aria-current). */
export function activeNav(pathname: string): NavKey {
  const first = `/${pathname.split("/")[1] ?? ""}`;
  const match = (Object.keys(navHref) as NavKey[]).find(
    (key) =>
      key !== "dashboard" && !externalNav.has(key) && navHref[key] === first,
  );
  return match ?? "dashboard";
}
