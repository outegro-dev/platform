/** Where sign-in starts, returning to `path` afterwards. */
export function signInHref(path: string) {
  return `/auth/sign-in?returnTo=${encodeURIComponent(path)}`;
}

/** Pages of a book. */
export const bookHref = (slug: string) => `/books/${slug}`;
export const chapterHref = (slug: string, n: number) => `/books/${slug}/${n}`;
export const prefaceHref = (slug: string) => `/books/${slug}/intro`;
export const deckHref = (slug: string) => `/books/${slug}/cards`;

/** "03" for chapter 3, the way chapter numbers are set in mono. */
export function chapterIndex(n: number): string {
  return String(n).padStart(2, "0");
}
