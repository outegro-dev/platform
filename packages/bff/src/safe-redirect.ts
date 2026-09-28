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
