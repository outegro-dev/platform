/**
 * Browser identity for server-to-server calls. Services see the BFF as the
 * caller, so the user agent and client IP are passed on explicitly: Identity
 * keys its sign-in rate limits on the IP and shows both in the session list.
 * Services run with `trust proxy` = 1 and read exactly one forwarded value.
 *
 * Where the visitor's address comes from depends on the edge:
 * - `x-forwarded-for`: Traefik appends the peer address, so only the last
 *   entry is trusted; anything before it came from the client.
 * - `cf-connecting-ip`: behind the Cloudflare proxy the last hop is a
 *   Cloudflare node and the visitor is in this header. Trust it only while
 *   the origin accepts 80/443 from Cloudflare's ranges alone; otherwise
 *   anyone can send it.
 */
export type ClientIpSource = "x-forwarded-for" | "cf-connecting-ip";

export function clientHeaders(
  incoming: Headers,
  source: ClientIpSource = "x-forwarded-for",
): Record<string, string> {
  const result: Record<string, string> = {};
  const userAgent = incoming.get("user-agent");
  if (userAgent) result["user-agent"] = userAgent.slice(0, 400);
  const ip =
    source === "cf-connecting-ip"
      ? incoming.get("cf-connecting-ip")?.trim()
      : incoming.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (ip) result["x-forwarded-for"] = ip;
  return result;
}
