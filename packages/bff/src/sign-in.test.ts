import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askIdentity, type SignInOptions, startSignIn } from "./sign-in";

const NOW = Date.parse("2026-09-30T12:00:00Z");
/** A JWT-shaped access token expiring `left` seconds after NOW. */
const token = (left: number) =>
  `x.${Buffer.from(JSON.stringify({ exp: Math.floor(NOW / 1000) + left })).toString("base64url")}.y`;
const session = { og_at: token(240), og_rt: "refresh-token", og_tz: "UTC" };

const options: SignInOptions = {
  client: {
    idUrl: "https://id.outegro.test",
    authApiUrl: "http://auth.internal",
    clientId: "battleship-web",
    redirectUri: "https://battleship.outegro.test/auth/callback",
  },
  appUrl: "https://battleship.outegro.test",
  fallback: "/",
  clientIpSource: "x-forwarded-for",
  now: () => NOW,
};

/** Identity's `GET /v1/me`, as the stubbed fetch answers it. */
let identity: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  identity = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", identity);
});
afterEach(() => vi.unstubAllGlobals());

const refusal = (status: number, code: string) =>
  Response.json(
    {
      error: {
        code,
        messageKey: `errors.${code.toLowerCase()}`,
        fieldErrors: {},
        requestId: "r1",
        retryable: status >= 500,
      },
    },
    { status },
  );
const accepts = () =>
  identity.mockResolvedValue(Response.json({ id: "u1", roles: [] }));
const refuses = () =>
  identity.mockResolvedValue(refusal(401, "UNAUTHENTICATED"));

function visit(
  returnTo: string | null,
  cookies: Record<string, string> = session,
  headers: Record<string, string> = {},
) {
  const query =
    returnTo === null ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(
    `https://battleship.outegro.test/auth/sign-in${query}`,
    {
      headers: {
        ...(cookie ? { cookie } : {}),
        "x-forwarded-proto": "https",
        ...headers,
      },
    },
  );
}

const location = (response: Response) =>
  new URL(response.headers.get("location") ?? "");
/** Name=value of every cookie the answer sets; an empty value deletes it. */
const setCookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .sort();
const pendingOf = (response: Response) => {
  const pending = setCookies(response).find((c) => c.startsWith("og_sso="));
  return JSON.parse(
    Buffer.from(pending?.slice("og_sso=".length) ?? "", "base64url").toString(
      "utf8",
    ),
  ) as { state: string; returnTo: string };
};
const toAuthorize = (response: Response) => {
  expect(response.status).toBe(303);
  const url = location(response);
  expect(`${url.origin}${url.pathname}`).toBe(
    "https://id.outegro.test/authorize",
  );
  expect(url.searchParams.get("client_id")).toBe("battleship-web");
};

describe("startSignIn", () => {
  it("starts the round trip through id.outegro.dev without a session", async () => {
    const response = await startSignIn(visit("/play?mode=quick", {}), options);
    toAuthorize(response);
    expect(identity).not.toHaveBeenCalled();
    expect(setCookies(response).map((cookie) => cookie.split("=")[0])).toEqual([
      "og_sso",
    ]);
    expect(pendingOf(response).returnTo).toBe("/play?mode=quick");
    expect(response.headers.getSetCookie()[0]).toMatch(/HttpOnly/i);
    expect(response.headers.getSetCookie()[0]).toMatch(/Secure/i);
  });

  it("sends a session Identity accepts straight back", async () => {
    accepts();
    const response = await startSignIn(visit("/profile"), options);
    expect(response.status).toBe(303);
    expect(location(response).toString()).toBe(
      "https://battleship.outegro.test/profile",
    );
    expect(setCookies(response)).toEqual([]);
    expect(identity).toHaveBeenCalledOnce();
  });

  it("drops a session Identity refuses before its cookie expires, and signs in once", async () => {
    // Revoked in another tab, by an operator, or the account suspended.
    refuses();
    const response = await startSignIn(visit("/profile"), options);
    toAuthorize(response);
    expect(identity).toHaveBeenCalledOnce();
    const cookies = setCookies(response);
    // Only the session goes; other cookies of the app stay.
    expect(cookies.filter((cookie) => !cookie.startsWith("og_sso="))).toEqual([
      "og_at=",
      "og_rt=",
    ]);
    // The pending sign-in returns to the page that was asked for.
    const pending = pendingOf(response);
    expect(pending.returnTo).toBe("/profile");
    expect(location(response).searchParams.get("state")).toBe(pending.state);
  });

  it.each([
    ["an outage", () => identity.mockResolvedValue(refusal(503, "INTERNAL"))],
    [
      "a gateway error without a body",
      () => identity.mockResolvedValue(new Response("", { status: 502 })),
    ],
    [
      "no answer",
      () => identity.mockRejectedValue(new TypeError("fetch failed")),
    ],
    ["a 403", () => identity.mockResolvedValue(refusal(403, "FORBIDDEN"))],
  ])(
    "keeps the session and goes back on %s: the page shows what it knows",
    async (_, answer) => {
      answer();
      const response = await startSignIn(visit("/replay/m1"), options);
      expect(response.status).toBe(303);
      expect(location(response).toString()).toBe(
        "https://battleship.outegro.test/replay/m1",
      );
      expect(setCookies(response)).toEqual([]);
    },
  );

  it("has a client-side navigation load it as a document before anything happens", async () => {
    refuses();
    // What the router's fetch carries; the browser's own navigation says "document".
    const fetched = await startSignIn(
      visit("/profile", session, {
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
      }),
      options,
    );
    expect(fetched.status).toBe(204);
    expect(fetched.headers.get("location")).toBeNull();
    expect(fetched.headers.get("cache-control")).toBe("no-store");
    expect(setCookies(fetched)).toEqual([]);
    expect(identity).not.toHaveBeenCalled();

    const document = await startSignIn(
      visit("/profile", session, {
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
      }),
      options,
    );
    toAuthorize(document);
  });

  it("does not ask about a cookie about to expire: the proxy tried a refresh", async () => {
    accepts();
    const response = await startSignIn(
      visit("/", { ...session, og_at: token(20) }),
      options,
    );
    toAuthorize(response);
    expect(identity).not.toHaveBeenCalled();
  });

  it.each([
    ["https://evil.test/", "/"],
    ["//evil.test", "/"],
    [null, "/"],
  ])("returns only to this app (%s)", async (returnTo, back) => {
    accepts();
    const response = await startSignIn(visit(returnTo), options);
    expect(location(response).toString()).toBe(
      new URL(back, options.appUrl).toString(),
    );
  });

  it("falls back to the app's own start page", async () => {
    const response = await startSignIn(visit(null, {}), {
      ...options,
      fallback: "/orders",
    });
    expect(pendingOf(response).returnTo).toBe("/orders");
  });
});

describe("askIdentity", () => {
  it("asks /v1/me with the token and the browser's identity", async () => {
    accepts();
    const verdict = await askIdentity(
      "http://auth.internal",
      "access-token",
      new Headers({
        "user-agent": "Firefox",
        "x-forwarded-for": "198.51.100.1, 203.0.113.7",
      }),
    );
    expect(verdict).toBe("accepted");
    const [url, init] = identity.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://auth.internal/v1/me");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("user-agent")).toBe("Firefox");
    // Only the address Traefik appended is trusted.
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("reads 401 as refused and anything else as unknown", async () => {
    refuses();
    expect(await askIdentity("http://auth.internal", "t", new Headers())).toBe(
      "refused",
    );
    identity.mockResolvedValue(refusal(500, "INTERNAL"));
    expect(await askIdentity("http://auth.internal", "t", new Headers())).toBe(
      "unknown",
    );
  });
});
