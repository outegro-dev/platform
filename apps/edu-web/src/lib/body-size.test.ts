import { describe, expect, it } from "vitest";
import { fitsBody, jsonBytes, MAX_BODY_BYTES, textBytes } from "./body-size";

describe("body size", () => {
  it("stays under edu-backend's 100 kB with room to spare", () => {
    expect(MAX_BODY_BYTES).toBe(96 * 1024);
    expect(MAX_BODY_BYTES).toBeLessThan(100 * 1024);
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(textBytes("abc")).toBe(3);
    expect(textBytes("абв")).toBe(6);
    expect(jsonBytes({ a: "я" })).toBe('{"a":"я"}'.length + 1);
    // Control characters are escaped in JSON: six bytes each.
    expect(jsonBytes("\u0001")).toBe(8);
  });

  it("lets a body up to the limit through, and nothing larger", () => {
    // `"…"`: two quotes around the text.
    const atLimit = "x".repeat(MAX_BODY_BYTES - 2);
    expect(fitsBody(atLimit)).toBe(true);
    expect(fitsBody(`${atLimit}x`)).toBe(false);
    // Russian text is twice as large on the wire.
    expect(fitsBody("я".repeat(MAX_BODY_BYTES / 2))).toBe(false);
  });
});
