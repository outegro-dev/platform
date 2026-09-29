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

type Params = URLSearchParams | Record<string, unknown>;

const read = (params: Params, key: string) =>
  params instanceof URLSearchParams ? params.get(key) : params[key];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Order ids arrive as `?orderId=` (Lava return) or `?order=` (links). */
export function orderIdFrom(params: Params) {
  for (const key of ["orderId", "order"]) {
    const value = read(params, key);
    if (typeof value === "string" && UUID.test(value))
      return value.toLowerCase();
  }
  return null;
}

/**
 * Lava's `result` is a hint about how the buyer left its page, never proof
 * of payment. Only "failure" and "cancel" are kept, to word a pending
 * order as "not completed" while the server is still asked.
 */
export function leftPayment(params: Params): boolean {
  const result = read(params, "result");
  return result === "failure" || result === "cancel";
}

/** Where a return from Lava lands: the live order page, with the hint. */
export function returnPath(params: Params) {
  const orderId = orderIdFrom(params);
  if (!orderId) return "/orders";
  const result = read(params, "result");
  return leftPayment(params)
    ? `/orders/${orderId}?result=${result}`
    : `/orders/${orderId}`;
}
