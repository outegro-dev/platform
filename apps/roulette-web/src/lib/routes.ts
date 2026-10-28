/** Where sign-in starts, returning to `path` afterwards. */
export function signInHref(path: string) {
  return `/auth/sign-in?returnTo=${encodeURIComponent(path)}`;
}
