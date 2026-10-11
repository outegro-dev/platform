import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/auth/callback/route";
import { GET as signIn } from "@/app/auth/sign-in/route";
import { proxy } from "@/proxy";
import { env } from "./env";

/*
 * Silent sign-in through this app's proxy and SSO routes: a reader signed
 * in at id.outegro.dev (the og_hint cookie) opens a book for the first
 * time. Identity's token endpoint is a stubbed fetch.
 */

const browser = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
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

async function toIdentity(path: string) {
  const first = await proxy(open(path, { og_hint: "1" }));
  const started = await signIn(open(location(first) ?? "", { og_hint: "1" }));
  const authorize = new URL(location(started) ?? "");
  expect(authorize.searchParams.get("prompt")).toBe("none");
  expect(authorize.searchParams.get("client_id")).toBe("edu-web");
  return {
    state: authorize.searchParams.get("state") ?? "",
    cookies: { og_hint: "1", ...jar(started) },
  };
}

describe("silent sign-in", () => {
  it("signs in a reader Identity knows and opens the same page", async () => {
    const { state, cookies } = await toIdentity("/books/sql?chapter=2");
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
    expect(location(back)).toBe(`${env.APP_URL}/books/sql?chapter=2`);
    expect(jar(back)).toMatchObject({ og_at: "access", og_silent: "silent" });
  });

  it("opens the page signed out when Identity has no session, and does not ask again", async () => {
    const { state, cookies } = await toIdentity("/books/sql");
    const back = await callback(
      open(`/auth/callback?error=login_required&state=${state}`, cookies),
    );
    expect(location(back)).toBe(`${env.APP_URL}/books/sql`);
    expect(jar(back)).toEqual({ og_sso: "" });

    const again = await proxy(
      open("/books/sql", { og_hint: "1", og_silent: "tried" }),
    );
    expect(location(again)).toBeNull();
  });

  it("costs nothing without the hint", async () => {
    const page = await proxy(open("/", {}));
    expect(location(page)).toBeNull();
    expect(page.headers.getSetCookie()).toEqual([]);
  });
});
