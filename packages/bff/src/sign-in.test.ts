import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askIdentity,
  type CallbackOptions,
  finishSignIn,
  type SignInOptions,
  startSignIn,
} from "./sign-in";
import { beginSignIn } from "./sso";

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

describe("startSignIn, silently", () => {
  const silentVisit = (
    cookies: Record<string, string>,
    returnTo = "/leaderboard",
  ) =>
    new NextRequest(
      `https://battleship.outegro.test/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}&silent=1`,
      {
        headers: {
          cookie: Object.entries(cookies)
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
          "x-forwarded-proto": "https",
        },
      },
    );

  it("asks Identity without its sign-in page and marks the attempt", async () => {
    const response = await startSignIn(silentVisit({ og_hint: "1" }), options);
    toAuthorize(response);
    expect(location(response).searchParams.get("prompt")).toBe("none");
    const pending = pendingOf(response) as {
      silent?: boolean;
      returnTo: string;
    };
    expect(pending).toMatchObject({ silent: true, returnTo: "/leaderboard" });
    const tried = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("og_silent="));
    expect(tried).toMatch(/^og_silent=tried;/);
    expect(tried).toMatch(/Max-Age=300/);
    expect(tried).toMatch(/HttpOnly/i);
    expect(identity).not.toHaveBeenCalled();
  });

  it("starts again once a silent session here has expired", async () => {
    const response = await startSignIn(
      silentVisit({ og_hint: "1", og_silent: "silent" }),
      options,
    );
    toAuthorize(response);
  });

  it.each([
    ["without the hint", {}],
    ["right after an attempt", { og_hint: "1", og_silent: "tried" }],
    ["after a sign-out here", { og_hint: "1", og_silent: "out" }],
  ])("goes straight back %s", async (_, cookies) => {
    const response = await startSignIn(silentVisit(cookies), options);
    expect(response.status).toBe(303);
    expect(location(response).toString()).toBe(
      "https://battleship.outegro.test/leaderboard",
    );
    expect(setCookies(response)).toEqual([]);
  });

  it("returns only to this app", async () => {
    const response = await startSignIn(
      silentVisit({}, "https://evil.test/"),
      options,
    );
    expect(location(response).toString()).toBe(
      "https://battleship.outegro.test/",
    );
  });
});

describe("finishSignIn", () => {
  const callbackOptions: CallbackOptions = {
    client: options.client,
    appUrl: options.appUrl,
    fallback: "/",
    errorPath: (reason) => `/auth/error?reason=${reason}`,
    clientIpSource: "x-forwarded-for",
  };
  const tokens = {
    sessionId: "s1",
    accessToken: "access",
    accessTokenExpiresAt: "2026-09-30T12:05:00.000Z",
    refreshToken: "refresh",
    refreshTokenExpiresAt: "2026-10-30T12:00:00.000Z",
  };
  const back = (
    params: Record<string, string>,
    cookies: Record<string, string>,
  ) =>
    new NextRequest(
      `https://battleship.outegro.test/auth/callback?${new URLSearchParams(params)}`,
      {
        headers: {
          cookie: Object.entries(cookies)
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
          "x-forwarded-proto": "https",
        },
      },
    );
  const started = (silent: boolean) => {
    const { url, cookie } = beginSignIn(options.client, "/leaderboard", {
      silent,
    });
    return {
      state: new URL(url).searchParams.get("state") ?? "",
      cookies: { og_sso: cookie, ...(silent ? { og_silent: "tried" } : {}) },
    };
  };

  it("writes the session, marks it as silent and returns", async () => {
    identity.mockResolvedValue(Response.json(tokens));
    const { state, cookies } = started(true);
    const response = await finishSignIn(
      back({ code: "c".repeat(43), state }, cookies),
      callbackOptions,
    );
    expect(location(response).toString()).toBe(
      "https://battleship.outegro.test/leaderboard",
    );
    expect(setCookies(response)).toEqual([
      "og_at=access",
      "og_rt=refresh",
      "og_silent=silent",
      "og_sso=",
    ]);
  });

  it("clears any mark when the visitor asked to sign in", async () => {
    identity.mockResolvedValue(Response.json(tokens));
    const { state, cookies } = started(false);
    const fresh = await finishSignIn(
      back({ code: "c".repeat(43), state }, cookies),
      callbackOptions,
    );
    expect(setCookies(fresh)).toEqual([
      "og_at=access",
      "og_rt=refresh",
      "og_sso=",
    ]);

    // Signed out here before: a later expiry may be picked up silently again.
    identity.mockResolvedValue(Response.json(tokens));
    const again = started(false);
    const response = await finishSignIn(
      back(
        { code: "c".repeat(43), state: again.state },
        { ...again.cookies, og_silent: "out" },
      ),
      callbackOptions,
    );
    expect(setCookies(response)).toEqual([
      "og_at=access",
      "og_rt=refresh",
      "og_silent=",
      "og_sso=",
    ]);
  });

  it("lands a silent attempt Identity had no session for on its page, signed out", async () => {
    const { state, cookies } = started(true);
    const response = await finishSignIn(
      back({ error: "login_required", state }, cookies),
      callbackOptions,
    );
    expect(location(response).toString()).toBe(
      "https://battleship.outegro.test/leaderboard",
    );
    // The "tried" mark stays: no new attempt for a while.
    expect(setCookies(response)).toEqual(["og_sso="]);
    expect(identity).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, string>, () => void]>([
    [
      "an outage",
      { code: "c".repeat(43) },
      () => identity.mockRejectedValue(new TypeError("fetch failed")),
    ],
    ["Identity's outage", { error: "temporarily_unavailable" }, () => {}],
  ])(
    "lands a silent attempt during %s on its page too, to try again soon",
    async (_, params, answer) => {
      answer();
      const { state, cookies } = started(true);
      const response = await finishSignIn(
        back({ ...params, state }, cookies),
        callbackOptions,
      );
      expect(location(response).pathname).toBe("/leaderboard");
      expect(setCookies(response)).toEqual(["og_sso="]);
    },
  );

  it.each<[string, Record<string, string>, () => void]>([
    ["a refused request", { error: "invalid_request" }, () => {}],
    [
      "a refused code",
      { code: "c".repeat(43) },
      () => identity.mockResolvedValue(refusal(422, "UNPROCESSABLE")),
    ],
  ])(
    "waits a day after a silent attempt ends in %s, which would only repeat",
    async (_, params, answer) => {
      answer();
      const { state, cookies } = started(true);
      const response = await finishSignIn(
        back({ ...params, state }, cookies),
        callbackOptions,
      );
      expect(location(response).pathname).toBe("/leaderboard");
      const tried = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("og_silent="));
      expect(tried).toMatch(/^og_silent=tried;/);
      expect(tried).toMatch(/Max-Age=86400/);
    },
  );

  it("explains a failed sign-in the visitor asked for", async () => {
    identity.mockRejectedValue(new TypeError("fetch failed"));
    const { state, cookies } = started(false);
    const response = await finishSignIn(
      back({ code: "c".repeat(43), state }, cookies),
      callbackOptions,
    );
    expect(location(response).toString()).toBe(
      "https://battleship.outegro.test/auth/error?reason=unavailable",
    );
    expect(setCookies(response)).toEqual(["og_sso="]);
  });

  it("shows a forged or expired callback for what it is", async () => {
    const { cookies } = started(false);
    const response = await finishSignIn(
      back({ code: "c".repeat(43), state: "forged-state-value" }, cookies),
      callbackOptions,
    );
    expect(location(response).toString()).toBe(
      "https://battleship.outegro.test/auth/error?reason=state_mismatch",
    );
    expect(setCookies(response)).toEqual(["og_sso="]);
    expect(identity).not.toHaveBeenCalled();
  });

  it.each([
    ["while a silent attempt is under way", { og_silent: "tried" }],
    ["when another tab already signed in", { og_at: "access" }],
  ])(
    "lands a callback of a lost parallel attempt quietly %s and leaves the pending sign-in",
    async (_, extra) => {
      const { cookies } = started(true);
      const response = await finishSignIn(
        back(
          { error: "login_required", state: "another-tab-state-value" },
          { og_sso: cookies.og_sso, ...extra },
        ),
        callbackOptions,
      );
      expect(location(response).toString()).toBe(
        "https://battleship.outegro.test/",
      );
      expect(setCookies(response)).toEqual([]);
    },
  );

  it.each([
    ["shortly after a silent attempt", { og_silent: "tried" }],
    ["with a session already here", { og_at: "access" }],
  ])(
    "still explains a mismatched sign-in the visitor asked for %s",
    async (_, extra) => {
      // Two sign-in tabs, or too long on Identity's sign-in page.
      const { cookies } = started(false);
      const response = await finishSignIn(
        back(
          { code: "c".repeat(43), state: "another-tab-state-value" },
          { ...cookies, ...extra },
        ),
        callbackOptions,
      );
      expect(location(response).toString()).toBe(
        "https://battleship.outegro.test/auth/error?reason=state_mismatch",
      );
    },
  );
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
