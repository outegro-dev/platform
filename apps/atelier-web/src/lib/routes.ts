/** Where sign-in starts, returning to `path` afterwards. */
export function signInHref(path: string) {
  return `/auth/sign-in?returnTo=${encodeURIComponent(path)}`;
}

/** An application's own page; from the board it opens in the side panel. */
export const applicationHref = (id: string) => `/applications/${id}`;

/** The app's sections, in navigation order. */
export const sections = [
  { key: "inbox", href: "/inbox" },
  { key: "board", href: "/" },
  { key: "pipeline", href: "/pipeline" },
  { key: "profile", href: "/profile" },
] as const;
export type SectionKey = (typeof sections)[number]["key"];

/** The section a path belongs to (an application belongs to the board). */
export function sectionOf(pathname: string): SectionKey | null {
  if (pathname === "/" || pathname.startsWith("/applications/")) return "board";
  for (const section of sections)
    if (section.href !== "/" && pathname.startsWith(section.href))
      return section.key;
  return null;
}
