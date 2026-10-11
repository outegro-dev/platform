import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/auth/callback/route";
import { GET as signIn } from "@/app/auth/sign-in/route";
import { POST as signOut } from "@/app/auth/sign-out/route";
import { proxy } from "@/proxy";
import { env } from "./env";

/*
 * Silent sign-in end to end through this app's proxy and SSO routes: a
 * visitor signed in at id.outegro.dev (the og_hint cookie) opens a page of
 * the game for the first time. Identity's token endpoint is a stubbed fetch.
 */

const browser = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
};

function open(url: string, cookies: Record<string, string>) {
  return new NextRequest(new URL(url, env.APP_URL), {
    headers: {
      ...browser,
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    },
  });
}
const location = (response: Response) => response.headers.get("location");
/** The cookies an answer sets, by name; an empty value deletes one. */
const jar = (response: Response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((cookie) => {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );

let identity: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  identity = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", identity);
});
afterEach(() => vi.unstubAllGlobals());

/** The proxy and the sign-in route, up to the browser leaving for /authorize. */
async function toIdentity(path: string) {
  const first = await proxy(open(path, { og_hint: "1" }));
  expect(first.status).toBe(303);
  const start = location(first) ?? "";
  expect(start).toBe(
    `${env.APP_URL}/auth/sign-in?returnTo=${encodeURIComponent(path)}&silent=1`,
  );
  const started = await signIn(open(start, { og_hint: "1" }));
  const authorize = new URL(location(started) ?? "");
  expect(`${authorize.origin}${authorize.pathname}`).toBe(
    new URL("/authorize", env.ID_URL).toString(),
  );
  expect(authorize.searchParams.get("prompt")).toBe("none");
  const cookies = jar(started);
  expect(cookies.og_silent).toBe("tried");
  return {
    state: authorize.searchParams.get("state") ?? "",
    cookies: { og_hint: "1", ...cookies },
  };
}

describe("silent sign-in", () => {
  it("signs in a visitor Identity knows and returns to the same page", async () => {
    const { state, cookies } = await toIdentity("/leaderboard?season=3");
    identity.mockResolvedValue(
      Response.json({
        sessionId: "s1",
        accessToken: "access",
        accessTokenExpiresAt: "2026-10-11T12:05:00.000Z",
        refreshToken: "refresh",
        refreshTokenExpiresAt: "2026-11-10T12:00:00.000Z",
      }),
    );

    const back = await callback(
      open(`/auth/callback?code=${"c".repeat(43)}&state=${state}`, cookies),
    );
    expect(location(back)).toBe(`${env.APP_URL}/leaderboard?season=3`);
    expect(jar(back)).toMatchObject({
      og_at: "access",
      og_rt: "refresh",
      og_silent: "silent",
      og_sso: "",
    });
  });

  it("lands back signed out, without an error page, when Identity has no session", async () => {
    const { state, cookies } = await toIdentity("/");
    const back = await callback(
      open(`/auth/callback?error=login_required&state=${state}`, cookies),
    );
    expect(location(back)).toBe(`${env.APP_URL}/`);
    expect(jar(back)).toEqual({ og_sso: "" });
    expect(identity).not.toHaveBeenCalled();

    // The attempt is remembered: the page renders, no second round trip.
    const again = await proxy(open("/", { og_hint: "1", og_silent: "tried" }));
    expect(location(again)).toBeNull();
    expect(again.headers.get("x-middleware-next")).toBe("1");
  });

  it("never undoes a sign-out here", async () => {
    identity.mockResolvedValue(new Response(null, { status: 204 }));
    const out = await signOut(
      new NextRequest(new URL("/auth/sign-out", env.APP_URL), {
        method: "POST",
        headers: {
          cookie: "og_at=access; og_rt=refresh; og_silent=silent; og_hint=1",
        },
      }),
    );
    expect(jar(out)).toMatchObject({ og_at: "", og_rt: "", og_silent: "out" });

    const page = await proxy(open("/", { og_hint: "1", og_silent: "out" }));
    expect(location(page)).toBeNull();
  });

  it("picks up the session at id.outegro.dev again once a silent one here expired", async () => {
    const page = await proxy(open("/", { og_hint: "1", og_silent: "silent" }));
    expect(location(page)).toBe(
      `${env.APP_URL}/auth/sign-in?returnTo=%2F&silent=1`,
    );
  });

  it("ends a silent session once the player signed out at id.outegro.dev", async () => {
    // A shared computer: the next visitor must not find the account here.
    identity.mockResolvedValue(new Response(null, { status: 204 }));
    const page = await proxy(
      open("/", { og_at: "access", og_rt: "refresh", og_silent: "silent" }),
    );
    expect(location(page)).toBeNull();
    expect(jar(page)).toMatchObject({ og_at: "", og_rt: "", og_silent: "" });
    const [url] = identity.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe("/v1/sessions/logout");
  });

  it("leaves game pages to their own sign-in, which shows Identity's page if needed", async () => {
    const page = await proxy(open("/play", { og_hint: "1" }));
    const target = new URL(location(page) ?? "");
    expect(target.pathname).toBe("/auth/sign-in");
    expect(target.searchParams.get("returnTo")).toBe("/play");
    expect(target.searchParams.has("silent")).toBe(false);
  });

  it("costs nothing without the hint", async () => {
    const page = await proxy(open("/", {}));
    expect(location(page)).toBeNull();
    expect(page.headers.getSetCookie()).toEqual([]);
  });
});
