import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect.js";
import { secondsLeft } from "./session.js";

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
