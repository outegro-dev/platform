import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RefreshOutcome, refreshSession, silentSignIn } from "./proxy";

const APP = "https://battleship.outegro.test";
/** A JWT-shaped access token expiring `left` seconds from now. */
const token = (left: number) =>
  `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + left })).toString("base64url")}.y`;
const tokens = {
  sessionId: "s1",
  accessToken: token(300),
  accessTokenExpiresAt: "2026-10-11T12:05:00.000Z",
  refreshToken: "r2",
  refreshTokenExpiresAt: "2026-11-10T12:00:00.000Z",
};
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
/** What a browser sends when the visitor opens a page. */
const navigation = {
  "user-agent": CHROME,
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};

function visit(
  path: string,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = navigation,
  method = "GET",
) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`${APP}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      "x-forwarded-proto": "https",
      ...headers,
    },
  });
}

/** Every Set-Cookie of an answer, by name. */
const setCookies = (response: Response) =>
  Object.fromEntries(
    response.headers
      .getSetCookie()
      .map((cookie) => [cookie.split("=")[0] ?? "", cookie]),
  );

let identity: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  identity = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", identity);
});
afterEach(() => vi.unstubAllGlobals());

describe("refreshSession at Identity's frontend", () => {
  const hint = { domain: "outegro.test" };

  it("renews the hint with every rotation, until the session's own expiry", async () => {
    identity.mockResolvedValue(Response.json(tokens));
    const session = await refreshSession(
      visit("/account", { og_rt: "r1" }),
      "http://auth.internal",
      { hint },
    );
    expect(session.outcome).toBe("refreshed");
    const written = setCookies(session.apply(NextResponse.next()));
    expect(written.og_hint).toMatch(/^og_hint=1;/);
    expect(written.og_hint).toMatch(/Domain=outegro\.test/i);
    expect(written.og_hint).toMatch(/Expires=Tue, 10 Nov 2026 12:00:00 GMT/);
    expect(written.og_hint).toMatch(/HttpOnly/i);
    expect(written.og_hint).toMatch(/Secure/i);
    expect(written.og_hint).toMatch(/SameSite=lax/i);
    expect(written.og_silent).toBeUndefined();
  });

  it("drops the hint with a session Identity refuses", async () => {
    identity.mockResolvedValue(new Response(null, { status: 401 }));
    const session = await refreshSession(
      visit("/authorize", { og_rt: "revoked", og_hint: "1" }),
      "http://auth.internal",
      { hint },
    );
    expect(session.outcome).toBe("signed-out");
    const written = setCookies(session.apply(NextResponse.next()));
    expect(written.og_hint).toMatch(/^og_hint=;/);
    expect(written.og_hint).toMatch(/Domain=outegro\.test/i);
    expect(written.og_hint).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(written.og_rt).toMatch(/^og_rt=;/);
  });

  it("drops a hint that outlived the session, and writes nothing for strangers", async () => {
    const stale = await refreshSession(
      visit("/authorize", { og_hint: "1" }),
      "http://auth.internal",
      { hint },
    );
    expect(stale.outcome).toBe("anonymous");
    expect(setCookies(stale.apply(NextResponse.next())).og_hint).toMatch(
      /^og_hint=;/,
    );

    const stranger = await refreshSession(visit("/"), "http://auth.internal", {
      hint,
    });
    expect(stranger.apply(NextResponse.next()).headers.getSetCookie()).toEqual(
      [],
    );
    expect(identity).not.toHaveBeenCalled();
  });

  it("gives a session from before the hint one rotation, to learn when it ends", async () => {
    identity.mockResolvedValue(Response.json(tokens));
    const session = await refreshSession(
      visit("/account", { og_at: token(240), og_rt: "r1" }),
      "http://auth.internal",
      { hint },
    );
    expect(session.outcome).toBe("refreshed");
    expect(identity).toHaveBeenCalledOnce();
    expect(setCookies(session.apply(NextResponse.next())).og_hint).toMatch(
      /Expires=Tue, 10 Nov 2026 12:00:00 GMT/,
    );

    // With the hint in place a fresh token is left alone.
    identity.mockClear();
    const hinted = await refreshSession(
      visit("/account", { og_at: token(240), og_rt: "r2", og_hint: "1" }),
      "http://auth.internal",
      { hint },
    );
    expect(hinted.outcome).toBe("fresh");
    expect(identity).not.toHaveBeenCalled();
  });

  it("keeps a fresh session fresh while Identity cannot rotate it for the hint", async () => {
    identity.mockRejectedValue(new TypeError("fetch failed"));
    const session = await refreshSession(
      visit("/account", { og_at: token(240), og_rt: "r1" }),
      "http://auth.internal",
      { hint },
    );
    expect(session.outcome).toBe("fresh");
    expect(session.apply(NextResponse.next()).headers.getSetCookie()).toEqual(
      [],
    );
  });

  it("keeps the hint while Identity cannot tell", async () => {
    identity.mockRejectedValue(new TypeError("fetch failed"));
    const session = await refreshSession(
      visit("/authorize", { og_rt: "r1", og_hint: "1" }),
      "http://auth.internal",
      { hint },
    );
    expect(session.outcome).toBe("unavailable");
    expect(session.apply(NextResponse.next()).headers.getSetCookie()).toEqual(
      [],
    );
  });

  it("is left alone by every other app", async () => {
    identity.mockResolvedValue(new Response(null, { status: 401 }));
    const session = await refreshSession(
      visit("/", { og_rt: "revoked", og_hint: "1" }),
      "http://auth.internal",
    );
    expect(setCookies(session.apply(NextResponse.next())).og_hint).toBe(
      undefined,
    );
  });
});

describe("refreshSession in an app that signs in silently", () => {
  const silent = { silent: true };
  /** The calls to Identity, by path. */
  const paths = () =>
    identity.mock.calls.map(([url]) => new URL(String(url)).pathname);

  it("leaves a live session alone: no mark for a session the visitor asked for", async () => {
    const session = await refreshSession(
      visit("/", { og_at: token(240), og_rt: "r1" }),
      "http://auth.internal",
      silent,
    );
    expect(session.outcome).toBe("fresh");
    expect(session.apply(NextResponse.next()).headers.getSetCookie()).toEqual(
      [],
    );
  });

  it("keeps a silent session's mark as long as the session", async () => {
    identity.mockResolvedValue(Response.json(tokens));
    const session = await refreshSession(
      visit("/", { og_rt: "r1", og_silent: "silent", og_hint: "1" }),
      "http://auth.internal",
      silent,
    );
    const written = setCookies(session.apply(NextResponse.next()));
    expect(written.og_silent).toMatch(/^og_silent=silent;/);
    expect(written.og_hint).toBeUndefined();

    identity.mockResolvedValue(Response.json(tokens));
    const asked = await refreshSession(
      visit("/", { og_rt: "r1", og_hint: "1" }),
      "http://auth.internal",
      silent,
    );
    expect(setCookies(asked.apply(NextResponse.next())).og_silent).toBe(
      undefined,
    );
  });

  it("ends a silent session once the visitor signed out at Identity", async () => {
    // A shared computer: whoever comes next must not find the account here.
    identity.mockResolvedValue(new Response(null, { status: 204 }));
    const request = visit("/", {
      og_at: token(240),
      og_rt: "r1",
      og_silent: "silent",
    });
    const session = await refreshSession(
      request,
      "http://auth.internal",
      silent,
    );
    expect(session.outcome).toBe("signed-out");
    expect(paths()).toEqual(["/v1/sessions/logout"]);
    expect(JSON.parse(String(identity.mock.calls[0]?.[1]?.body))).toEqual({
      refreshToken: "r1",
    });
    const written = setCookies(session.apply(NextResponse.next()));
    expect(written.og_at).toMatch(/^og_at=;/);
    expect(written.og_rt).toMatch(/^og_rt=;/);
    // Signing in at Identity again brings the session back silently.
    expect(written.og_silent).toMatch(/^og_silent=;/);
    expect(request.cookies.has("og_at")).toBe(false);
    expect(silentSignIn(request, session.outcome, APP)).toBeNull();
  });

  it("ends it locally even when Identity cannot be told", async () => {
    identity.mockRejectedValue(new TypeError("fetch failed"));
    const session = await refreshSession(
      visit("/", { og_at: token(240), og_rt: "r1", og_silent: "silent" }),
      "http://auth.internal",
      silent,
    );
    expect(identity).toHaveBeenCalledOnce();
    expect(session.outcome).toBe("signed-out");
    expect(setCookies(session.apply(NextResponse.next())).og_at).toMatch(
      /^og_at=;/,
    );
  });

  it.each([
    ["while the hint is there", { og_silent: "silent", og_hint: "1" }],
    ["when the visitor asked for it", {}],
    ["after a sign-out here", { og_silent: "out" }],
  ])("keeps a session %s", async (_, cookies) => {
    const session = await refreshSession(
      visit("/", { og_at: token(240), og_rt: "r1", ...cookies }),
      "http://auth.internal",
      silent,
    );
    expect(session.outcome).toBe("fresh");
    expect(identity).not.toHaveBeenCalled();
  });

  it("does not bring back a session Identity refused", async () => {
    identity.mockResolvedValue(new Response(null, { status: 401 }));
    const request = visit("/", {
      og_rt: "revoked",
      og_silent: "silent",
      og_hint: "1",
    });
    const session = await refreshSession(
      request,
      "http://auth.internal",
      silent,
    );
    expect(session.outcome).toBe("signed-out");
    const out = setCookies(session.apply(NextResponse.next())).og_silent;
    expect(out).toMatch(/^og_silent=out;/);
    expect(out).toMatch(/Max-Age=31536000/);
    expect(out).toMatch(/HttpOnly/i);
    expect(out).not.toMatch(/Domain=/i);
    // Not even on this very request.
    expect(silentSignIn(request, session.outcome, APP)).toBeNull();
  });
});

describe("silentSignIn", () => {
  const hinted = { og_hint: "1" };
  const silent = (
    request: NextRequest,
    outcome: RefreshOutcome = "anonymous",
  ) => silentSignIn(request, outcome, APP);

  it("sends a visitor signed in at Identity through silent sign-in, back to the same page", () => {
    const response = silent(visit("/leaderboard?season=3", hinted));
    expect(response?.status).toBe(303);
    const target = new URL(response?.headers.get("location") ?? "");
    expect(`${target.origin}${target.pathname}`).toBe(`${APP}/auth/sign-in`);
    expect(target.searchParams.get("returnTo")).toBe("/leaderboard?season=3");
    expect(target.searchParams.get("silent")).toBe("1");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    // The sign-in route marks the attempt, not the proxy.
    expect(response?.headers.getSetCookie()).toEqual([]);
  });

  it("tries again once this app's session is gone", () => {
    expect(silent(visit("/", hinted), "signed-out")).not.toBeNull();
  });

  it("does nothing for a visitor without the hint", () => {
    expect(silent(visit("/"))).toBeNull();
  });

  it.each([
    ["tried", "an attempt a moment ago"],
    ["out", "a sign-out here or a session Identity refused"],
    ["known", "a mark it does not know"],
  ])("does nothing after %s: %s", (value) => {
    expect(silent(visit("/", { ...hinted, og_silent: value }))).toBeNull();
  });

  it("picks up the session at Identity again once a silent one here expired", () => {
    expect(
      silent(visit("/", { ...hinted, og_silent: "silent" })),
    ).not.toBeNull();
  });

  it.each<RefreshOutcome>(["fresh", "refreshed", "unavailable"])(
    "does nothing when the session is %s",
    (outcome) => {
      expect(silent(visit("/", hinted), outcome)).toBeNull();
    },
  );

  it.each([
    "/auth/sign-in?returnTo=%2F&silent=1",
    "/auth/callback?error=login_required&state=s",
    "/auth/error?reason=state_mismatch",
    "/auth",
    "/api/me",
  ])("never starts on %s", (path) => {
    expect(silent(visit(path, hinted))).toBeNull();
  });

  it.each<[string, Record<string, string>]>([
    [
      "the router's fetch",
      { ...navigation, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
    ],
    ["a frame", { ...navigation, "sec-fetch-dest": "iframe" }],
    ["a prefetch", { ...navigation, "sec-purpose": "prefetch" }],
    ["a prerender", { ...navigation, "sec-purpose": "prefetch;prerender" }],
    ["a legacy prefetch", { ...navigation, purpose: "prefetch" }],
    [
      "a crawler",
      {
        ...navigation,
        "user-agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
    ],
    [
      "a link preview",
      { ...navigation, "user-agent": "TelegramBot (like TwitterBot)" },
    ],
    ["no user agent", { accept: "text/html" }],
    [
      "a script without Fetch Metadata",
      { "user-agent": CHROME, accept: "*/*" },
    ],
  ])("ignores %s", (_, headers) => {
    expect(silent(visit("/", hinted, headers))).toBeNull();
  });

  it("ignores anything but GET", () => {
    expect(silent(visit("/", hinted, navigation, "POST"))).toBeNull();
    expect(silent(visit("/", hinted, navigation, "HEAD"))).toBeNull();
  });

  it("takes an HTML Accept from browsers without Fetch Metadata", () => {
    expect(
      silent(
        visit("/", hinted, { "user-agent": CHROME, accept: "text/html,*/*" }),
      ),
    ).not.toBeNull();
  });
});
