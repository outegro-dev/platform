import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/sign-in/route";
import { env } from "./env";

/*
 * /auth/sign-in with Identity (auth-backend `GET /v1/me`) played by a
 * stubbed fetch: the route may not trust an unexpired access cookie alone.
 */

/** A JWT-shaped access token expiring `left` seconds from now. */
const token = (left: number) =>
  `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + left })).toString("base64url")}.y`;
const session = { og_at: token(240), og_rt: "refresh-token" };

let identity: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  identity = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", identity);
});
afterEach(() => vi.unstubAllGlobals());

const answer = (status: number) =>
  identity.mockResolvedValue(
    status === 200
      ? Response.json({ id: "u1", email: "nick@outegro.test", roles: [] })
      : Response.json(
          {
            error: {
              code: status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
              messageKey: "errors.x",
              fieldErrors: {},
              requestId: "r1",
              retryable: status >= 500,
            },
          },
          { status },
        ),
  );

function visit(
  returnTo: string | null,
  cookies: Record<string, string> = session,
  fetchDest = "document",
) {
  const query =
    returnTo === null ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`${env.APP_URL}/auth/sign-in${query}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      "sec-fetch-dest": fetchDest,
      "x-forwarded-for": "203.0.113.7",
    },
  });
}

const location = (response: Response) =>
  new URL(response.headers.get("location") ?? "");
/** Name=value of every cookie the answer sets; an empty value deletes it. */
const setCookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .sort();
const toAuthorize = (response: Response) => {
  expect(response.status).toBe(303);
  const url = location(response);
  expect(`${url.origin}${url.pathname}`).toBe(
    new URL("/authorize", env.ID_URL).toString(),
  );
  expect(url.searchParams.get("client_id")).toBe("battleship-web");
};

describe("/auth/sign-in", () => {
  it("starts sign-in without a session, back home by default", async () => {
    const response = await GET(visit(null, {}));
    toAuthorize(response);
    expect(identity).not.toHaveBeenCalled();
    const pending = setCookies(response).find((c) => c.startsWith("og_sso="));
    const state = JSON.parse(
      Buffer.from(pending?.slice(7) ?? "", "base64url").toString("utf8"),
    );
    expect(state.returnTo).toBe("/");
  });

  it("sends a session Identity accepts straight back", async () => {
    answer(200);
    const response = await GET(visit("/profile"));
    expect(response.status).toBe(303);
    expect(location(response).toString()).toBe(
      new URL("/profile", env.APP_URL).toString(),
    );
    expect(setCookies(response)).toEqual([]);
    const [url, init] = identity.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${env.AUTH_API_URL}/v1/me`);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${session.og_at}`,
    );
  });

  it("drops a session Identity refuses before its cookie expires, and signs in once", async () => {
    answer(401);
    const response = await GET(visit("/profile"));
    toAuthorize(response);
    expect(identity).toHaveBeenCalledOnce();
    const cookies = setCookies(response);
    expect(cookies.filter((cookie) => !cookie.startsWith("og_sso="))).toEqual([
      "og_at=",
      "og_rt=",
    ]);
    expect(cookies.some((cookie) => /^og_sso=.+/.test(cookie))).toBe(true);
  });

  it("keeps the session and goes back when Identity cannot tell", async () => {
    identity.mockRejectedValue(new TypeError("fetch failed"));
    const response = await GET(visit("/replay/m1"));
    expect(location(response).toString()).toBe(
      new URL("/replay/m1", env.APP_URL).toString(),
    );
    expect(setCookies(response)).toEqual([]);
  });

  it("answers the router's fetch with 204, so the browser loads it as a document", async () => {
    answer(401);
    const response = await GET(visit("/profile", session, "empty"));
    expect(response.status).toBe(204);
    expect(response.headers.get("location")).toBeNull();
    expect(setCookies(response)).toEqual([]);
    expect(identity).not.toHaveBeenCalled();
  });
});
