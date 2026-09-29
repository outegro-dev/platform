/** Game pages: playing, rooms, your stats and replays need an account. */
const protectedPrefixes = ["/play", "/room", "/profile", "/replay"];

export function requiresSignIn(pathname: string) {
  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Where sign-in starts, returning to `path` afterwards. */
export function signInHref(path: string) {
  return `/auth/sign-in?returnTo=${encodeURIComponent(path)}`;
}
