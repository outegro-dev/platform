import { describe, expect, it } from "vitest";
import { clientHeaders } from "./client";
import { safeRedirectPath } from "./safe-redirect";
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
});
