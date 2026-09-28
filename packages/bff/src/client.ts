/**
 * Browser identity for server-to-server calls. Services see the BFF as the
 * caller, so the user agent and client IP are passed on explicitly: Identity
 * keys its sign-in rate limits on the IP and shows both in the session list.
 *
 * Traefik appends the peer address to X-Forwarded-For, so only the last entry
 * is trusted; anything before it came from the client. Services run with
 * `trust proxy` = 1 and read exactly that single value.
 */
export function clientHeaders(incoming: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const userAgent = incoming.get("user-agent");
  if (userAgent) result["user-agent"] = userAgent.slice(0, 400);
  const ip = incoming.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (ip) result["x-forwarded-for"] = ip;
  return result;
}
