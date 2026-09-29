import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { Operator } from "./adapters/identity";
import type { Loaded } from "./result";
import { appUrl } from "./session";
import { type SignInDeps, startSignIn } from "./sign-in";

const NOW = Date.parse("2026-09-29T12:00:00Z");
/** A JWT-shaped access token expiring `left` seconds after NOW. */
const token = (left: number) =>
  `x.${Buffer.from(JSON.stringify({ exp: Math.floor(NOW / 1000) + left })).toString("base64url")}.y`;
const session = {
  og_at: token(240),
  og_rt: "refresh-token",
  og_admin_seen: String(Math.floor(NOW / 1000) - 60),
};

const operator: Operator = {
  id: "5b449591-1c9c-4b2e-9d6f-0a1b2c3d4e5f",
  email: "nick@outegro.dev",
  displayName: "Nick Lukashik",
  locale: "en",
  status: "active",
  roles: ["owner"],
  permissions: ["users.read"],
};

function identity(answer: Loaded<Operator>) {
  const load = vi.fn(async () => answer);
  const deps: SignInDeps = { operator: load, now: () => NOW };
  return { deps, load };
}

function visit(
  returnTo: string | null,
  cookies: Record<string, string> = session,
) {
  const query =
    returnTo === null ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(`https://admin.outegro.dev/auth/sign-in${query}`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      "x-forwarded-proto": "https",
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
  const url = location(response);
  expect(`${url.origin}${url.pathname}`).toMatch(/\/authorize$/);
  expect(url.searchParams.get("client_id")).toBe("admin-web");
};

describe("/auth/sign-in", () => {
  it("starts the round trip through id.outegro.dev without a session", async () => {
    const { deps, load } = identity({ ok: false, kind: "unauthenticated" });
    const response = await startSignIn(visit("/users?query=mira", {}), deps);
    expect(response.status).toBe(303);
    toAuthorize(response);
    expect(load).not.toHaveBeenCalled();
    expect(setCookies(response).map((cookie) => cookie.split("=")[0])).toEqual([
      "og_sso",
    ]);
  });

  it("sends a session Identity accepts straight back", async () => {
    const { deps, load } = identity({ ok: true, data: operator });
    const response = await startSignIn(visit("/users?query=mira"), deps);
    expect(response.status).toBe(303);
    expect(location(response).toString()).toBe(
      appUrl("/users?query=mira").toString(),
    );
    expect(load).toHaveBeenCalledOnce();
    expect(setCookies(response)).toEqual([]);
  });

  it("drops a session Identity refuses before its cookie expires, and signs in once", async () => {
    // Revoked in another tab, by an operator, or the account suspended.
    const { deps, load } = identity({ ok: false, kind: "unauthenticated" });
    const response = await startSignIn(visit("/payments"), deps);
    expect(response.status).toBe(303);
    toAuthorize(response);
    expect(load).toHaveBeenCalledOnce();
    const cookies = setCookies(response);
    expect(cookies.filter((cookie) => !cookie.startsWith("og_sso="))).toEqual([
      "og_admin_seen=",
      "og_at=",
      "og_rt=",
    ]);
    expect(cookies.some((cookie) => /^og_sso=.+/.test(cookie))).toBe(true);
    // The pending sign-in returns to the page that was asked for.
    const pending = cookies.find((cookie) => cookie.startsWith("og_sso="));
    const state = JSON.parse(
      Buffer.from(pending?.slice("og_sso=".length) ?? "", "base64url").toString(
        "utf8",
      ),
    );
    expect(state.returnTo).toBe("/payments");
    expect(location(response).searchParams.get("state")).toBe(state.state);
  });

  it("keeps the session when Identity cannot tell", async () => {
    const { deps } = identity({
      ok: false,
      kind: "unavailable",
      requestId: null,
    });
    const response = await startSignIn(visit("/audit"), deps);
    expect(location(response).toString()).toBe(appUrl("/audit").toString());
    expect(setCookies(response)).toEqual([]);
  });

  it("has a client-side navigation load it as a document before anything happens", async () => {
    const { deps, load } = identity({ ok: false, kind: "unauthenticated" });
    const request = visit("/users");
    // What the router's fetch carries; the browser's own navigation says "document".
    request.headers.set("sec-fetch-dest", "empty");
    request.headers.set("sec-fetch-mode", "cors");
    const response = await startSignIn(request, deps);
    expect(response.status).toBe(204);
    expect(response.headers.get("location")).toBeNull();
    expect(setCookies(response)).toEqual([]);
    expect(load).not.toHaveBeenCalled();

    request.headers.set("sec-fetch-dest", "document");
    request.headers.set("sec-fetch-mode", "navigate");
    const document = await startSignIn(request, deps);
    expect(document.status).toBe(303);
    toAuthorize(document);
  });

  it("does not ask about a cookie about to expire: the proxy tried a refresh", async () => {
    const { deps, load } = identity({ ok: true, data: operator });
    const response = await startSignIn(
      visit("/", { ...session, og_at: token(20) }),
      deps,
    );
    toAuthorize(response);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    ["https://evil.test/", "/"],
    ["//evil.test", "/"],
    [null, "/"],
  ])("returns only to this console (%s)", async (returnTo, back) => {
    const { deps } = identity({ ok: true, data: operator });
    const response = await startSignIn(visit(returnTo), deps);
    expect(location(response).toString()).toBe(appUrl(back).toString());
  });
});
