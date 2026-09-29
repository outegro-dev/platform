import { describe, expect, it } from "vitest";
import { clientHeaders } from "./client";
import { safeRedirectPath, safeReturnUrl } from "./safe-redirect";
import { secondsLeft } from "./session";

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
