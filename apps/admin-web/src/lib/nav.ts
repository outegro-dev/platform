/** Navigation keys and paths; safe for client components (no contracts import). */

export type NavKey =
  | "dashboard"
  | "users"
  | "notifications"
  | "payments"
  | "battleship"
  | "audit";

export const navHref: Record<NavKey, string> = {
  dashboard: "/",
  users: "/users",
  notifications: "/notifications",
  payments: "/payments",
  battleship: "/battleship",
  audit: "/audit",
};

/** Which sidebar item a path belongs to (for aria-current). */
export function activeNav(pathname: string): NavKey {
  const first = `/${pathname.split("/")[1] ?? ""}`;
  const match = (Object.keys(navHref) as NavKey[]).find(
    (key) => key !== "dashboard" && navHref[key] === first,
  );
  return match ?? "dashboard";
}
