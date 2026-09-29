/**
 * Only same-origin paths are allowed as post-login destinations; anything
 * else (absolute URLs, protocol-relative `//evil`, backslashes) falls back.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/",
) {
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return fallback;
  try {
    const url = new URL(value, "https://placeholder.invalid");
    if (url.origin !== "https://placeholder.invalid") return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

/**
 * A way back to another platform app ("Back to Battleship"): an absolute
 * http(s) URL whose origin is exactly one of `allowedOrigins` (for example
 * https://battleship.outegro.dev), without credentials. Anything else —
 * another or look-alike origin, a relative or protocol-relative value,
 * `javascript:`, whitespace or backslashes, an overlong value — is refused
 * with null, never repaired. The fragment is dropped.
 */
export function safeReturnUrl(
  value: string | null | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (!value || typeof value !== "string" || value.length > 2048) return null;
  // The URL parser silently drops tabs and newlines and reads "\" as "/":
  // refuse such input instead of guessing what it meant.
  if (/[\s\\]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!allowedOrigins.includes(url.origin)) return null;
  url.hash = "";
  return url.toString();
}
