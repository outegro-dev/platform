import { describe, expect, it } from "vitest";
import { timezoneOf } from "./browser-pool.js";

describe("timezoneOf", () => {
  it("turns a GMT or UTC offset into an Etc zone with the POSIX sign", () => {
    expect(timezoneOf("GMT+4")).toBe("Etc/GMT-4");
    expect(timezoneOf("UTC-3")).toBe("Etc/GMT+3");
    expect(timezoneOf("utc +05:00")).toBe("Etc/GMT-5");
    expect(timezoneOf("GMT+0")).toBe("UTC");
  });

  it("keeps a valid IANA name and falls back to UTC otherwise", () => {
    expect(timezoneOf("Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(timezoneOf("Mars/Olympus")).toBe("UTC");
    expect(timezoneOf("GMT+5:30")).toBe("UTC");
    expect(timezoneOf(null)).toBe("UTC");
    expect(timezoneOf(undefined)).toBe("UTC");
  });
});
