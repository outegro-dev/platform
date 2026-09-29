import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isApiPath, isPublicPath, orderIdFrom } from "./routes";
import { timeZoneCookie } from "./time-zone";

const ID = "6f1c2c8e-8d2a-4a57-9d8e-2f1f8f0d3a11";

describe("routes", () => {
  it("needs a session everywhere but the sign-in flow and the goodbye page", () => {
    expect(isPublicPath("/auth/sign-in")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/signed-out")).toBe(true);
    expect(isPublicPath("/orders")).toBe(false);
    expect(isPublicPath("/authx")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
    expect(isApiPath("/api/orders/1")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
  });

  it("finds the order id of a return from Lava in either spelling", () => {
    expect(
      orderIdFrom(new URLSearchParams(`orderId=${ID}&result=success`)),
    ).toBe(ID);
    expect(orderIdFrom({ order: ID.toUpperCase() })).toBe(ID);
    expect(orderIdFrom({ order: "../../admin" })).toBeNull();
    expect(orderIdFrom({ orderId: [ID] })).toBeNull();
    expect(orderIdFrom(new URLSearchParams("result=success"))).toBeNull();
  });

  it("writes the time zone cookie only for plain IANA names", () => {
    expect(timeZoneCookie("Europe/Moscow", true)).toBe(
      "og_tz=Europe/Moscow; path=/; max-age=31536000; samesite=lax; secure",
    );
    expect(timeZoneCookie("a;b=c", false)).toBeNull();
  });
});

/** Every file under src/ that imports mobx-react-lite. */
function observerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return observerFiles(full);
    if (!/\.tsx?$/.test(name) || name.endsWith(".test.ts")) return [];
    return readFileSync(full, "utf8").includes('from "mobx-react-lite"')
      ? [full]
      : [];
  });
}

describe("React Compiler and MobX", () => {
  // A compiled observer can return memoized JSX after MobX asked for a
  // re-render (the store object never changes identity): stale screens.
  it("every observer file opts out of the compiler", () => {
    const files = observerFiles(fileURLToPath(new URL("..", import.meta.url)));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files)
      expect(readFileSync(file, "utf8"), file).toMatch(
        /^"use client";[\s\S]*?"use no memo";/,
      );
  });
});
