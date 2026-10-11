import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { clientHeaders } from "./client";
import { safeRedirectPath, safeReturnUrl } from "./safe-redirect";
import { clearHint, hintDomain, secondsLeft, writeHint } from "./session";

describe("safeRedirectPath", () => {
  it("keeps same-origin paths with their query", () => {
    expect(safeRedirectPath("/authorize?client_id=pay-web&state=x")).toBe(
      "/authorize?client_id=pay-web&state=x",
    );
  });

  it.each([
    "https://evil.test/",
    "//evil.test/path",
    "/\\evil.test",
    "javascript:alert(1)",
    "",
    null,
  ])("rejects %s", (value) => {
    expect(safeRedirectPath(value, "/account")).toBe("/account");
  });

  it("keeps an overlong page without its query, so the sign-in cookie fits", () => {
    const query = `?q=${"x".repeat(3000)}`;
    expect(safeRedirectPath(`/books/sql${query}`)).toBe("/books/sql");
    expect(safeRedirectPath(`/${"a".repeat(2000)}`, "/account")).toBe(
      "/account",
    );
    const fits = `/books/sql?q=${"x".repeat(1000)}`;
    expect(safeRedirectPath(fits)).toBe(fits);
  });
});

describe("safeReturnUrl", () => {
  const platform = [
    "https://battleship.outegro.dev",
    "https://id.outegro.dev",
    "http://localhost:3005",
  ];

  it("keeps a page of an allowed app with its query, without the fragment", () => {
    expect(
      safeReturnUrl("https://battleship.outegro.dev/shop?tab=1#top", platform),
    ).toBe("https://battleship.outegro.dev/shop?tab=1");
    expect(safeReturnUrl("https://id.outegro.dev", platform)).toBe(
      "https://id.outegro.dev/",
    );
    expect(safeReturnUrl("http://localhost:3005/profile", platform)).toBe(
      "http://localhost:3005/profile",
    );
  });

  it("normalizes the letter case of the host", () => {
    expect(safeReturnUrl("HTTPS://Battleship.Outegro.Dev/shop", platform)).toBe(
      "https://battleship.outegro.dev/shop",
    );
  });

  it.each([
    "https://evil.test/",
    "https://battleship.outegro.dev.evil.test/shop",
    "https://evil-battleship.outegro.dev/",
    "https://battleship.outegro.dev@evil.test/",
    "https://user:secret@battleship.outegro.dev/",
    "http://battleship.outegro.dev/",
    "https://battleship.outegro.dev:8443/",
    "https://localhost:3005/",
    "//battleship.outegro.dev/shop",
    "/shop",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://battleship.outegro.dev\\@evil.test",
    "https://battle\tship.outegro.dev/",
    " https://battleship.outegro.dev/",
    `https://battleship.outegro.dev/${"a".repeat(2100)}`,
    "",
    null,
    undefined,
  ])("refuses %s", (value) => {
    expect(safeReturnUrl(value, platform)).toBeNull();
  });

  it("refuses everything when no origin is allowed", () => {
    expect(safeReturnUrl("https://battleship.outegro.dev/", [])).toBeNull();
  });
});

describe("secondsLeft", () => {
  const token = (exp: number) =>
    `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;

  it("reads the expiry of a JWT", () => {
    expect(secondsLeft(token(1_000_100), 1_000_000_000)).toBe(100);
  });

  it("treats missing or broken tokens as expired", () => {
    expect(secondsLeft(undefined)).toBe(0);
    expect(secondsLeft("garbage")).toBe(0);
  });
});

describe("hintDomain", () => {
  it.each([
    ["https://id.outegro.dev", "outegro.dev"],
    ["https://id.staging.outegro.dev", "staging.outegro.dev"],
    ["http://id.outegro.localhost:3002", "outegro.localhost"],
  ])("puts the hint of %s on %s", (idUrl, domain) => {
    expect(hintDomain(idUrl)).toBe(domain);
  });

  it.each([
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://[::1]:3002",
    // Never a public suffix: a two-label host keeps the hint to itself.
    "https://outegro.dev",
  ])("keeps the hint of %s host-only", (idUrl) => {
    expect(hintDomain(idUrl)).toBeUndefined();
  });
});

describe("the sign-in hint", () => {
  const expires = { refreshTokenExpiresAt: "2026-11-10T12:00:00.000Z" };

  it("is written on the domain and deleted on the same domain", () => {
    const response = NextResponse.next();
    writeHint(response.cookies, expires, true, "outegro.dev");
    expect(response.headers.getSetCookie()[0]).toBe(
      "og_hint=1; Path=/; Expires=Tue, 10 Nov 2026 12:00:00 GMT; Domain=outegro.dev; Secure; HttpOnly; SameSite=lax",
    );
    clearHint(response.cookies, true, "outegro.dev");
    expect(response.headers.getSetCookie()[0]).toBe(
      "og_hint=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=outegro.dev; Secure; HttpOnly; SameSite=lax",
    );
  });

  it("stays host-only without a domain (localhost)", () => {
    const response = NextResponse.next();
    writeHint(response.cookies, expires, false, undefined);
    const cookie = response.headers.getSetCookie()[0];
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/i);
  });
});

describe("clientHeaders", () => {
  it("passes the user agent and only the proxy-appended address", () => {
    const incoming = new Headers({
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": "6.6.6.6, 203.0.113.7",
    });
    expect(clientHeaders(incoming)).toEqual({
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("sends nothing it did not receive", () => {
    expect(clientHeaders(new Headers())).toEqual({});
  });

  it("behind the Cloudflare proxy takes the visitor from CF-Connecting-IP", () => {
    const incoming = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "203.0.113.7, 172.70.1.1",
    });
    expect(clientHeaders(incoming, "cf-connecting-ip")).toEqual({
      "x-forwarded-for": "203.0.113.7",
    });
    // The Cloudflare node at the end of X-Forwarded-For is never used there.
    expect(
      clientHeaders(
        new Headers({ "x-forwarded-for": "172.70.1.1" }),
        "cf-connecting-ip",
      ),
    ).toEqual({});
  });
});
