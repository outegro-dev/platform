/**
 * Every page needs a session, except the sign-in flow itself and the
 * page shown right after signing out (otherwise SSO would sign the visitor
 * straight back in).
 */
const publicPaths = ["/auth", "/signed-out"];

export function isPublicPath(pathname: string) {
  return publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** JSON endpoints for the browser: answer 401, never redirect to HTML. */
export function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** Order ids arrive as `?order=` or `?orderId=` (Lava return, other apps). */
export function orderIdFrom(params: URLSearchParams | Record<string, unknown>) {
  const read = (key: string) =>
    params instanceof URLSearchParams ? params.get(key) : params[key];
  for (const key of ["orderId", "order"]) {
    const value = read(key);
    if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value))
      return value.toLowerCase();
  }
  return null;
}
