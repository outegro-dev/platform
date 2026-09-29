import { describe, expect, it } from "vitest";
import {
  coordinate,
  dayLabel,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatPercent,
  formatRelative,
  formatUtc,
  lastDays,
  maskEmail,
  maskEmailsIn,
  minorToDecimal,
  safeTimeZone,
  shortId,
} from "./format";

// Intl uses narrow no-break spaces in some locales; compare on plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("money from minor units", () => {
  it("places the decimal point by the currency scale, without floats", () => {
    expect(minorToDecimal("5000", 2)).toBe("50.00");
    expect(minorToDecimal("59", 2)).toBe("0.59");
    expect(minorToDecimal("5", 2)).toBe("0.05");
    expect(minorToDecimal("-150", 2)).toBe("-1.50");
    expect(minorToDecimal("1200", 0)).toBe("1200");
    expect(minorToDecimal("123456789012345678901", 2)).toBe(
      "1234567890123456789.01",
    );
  });

  it("formats with Intl in the operator's language", () => {
    expect(
      formatMoney({ minor: "5000", currency: "RUB", scale: 2 }, "en"),
    ).toBe("₽50.00");
    expect(
      plain(formatMoney({ minor: "5000", currency: "RUB", scale: 2 }, "ru")),
    ).toBe("50,00 ₽");
    expect(formatMoney({ minor: "59", currency: "USD", scale: 2 }, "en")).toBe(
      "$0.59",
    );
    expect(
      plain(formatMoney({ minor: "52", currency: "EUR", scale: 2 }, "ru")),
    ).toBe("0,52 €");
  });

  it("keeps precision beyond Number for huge amounts", () => {
    expect(
      formatMoney(
        { minor: "900719925474099312", currency: "USD", scale: 2 },
        "en",
      ),
    ).toBe("$9,007,199,254,740,993.12");
  });

  it("falls back to text for a currency Intl does not know", () => {
    expect(formatMoney({ minor: "100", currency: "XX", scale: 2 }, "en")).toBe(
      "1.00 XX",
    );
  });
});

describe("dates", () => {
  const at = "2026-09-29T14:03:12.000Z";

  it("shows exact UTC for tooltips", () => {
    expect(formatUtc(at)).toBe("2026-09-29 14:03:12 UTC");
    expect(formatUtc("not a date")).toBe("not a date");
  });

  it("renders in the operator's time zone and language", () => {
    expect(plain(formatDateTime(at, "en", "Europe/Moscow"))).toBe(
      "Sep 29, 2026, 5:03 PM",
    );
    expect(plain(formatDateTime(at, "ru", "UTC"))).toContain("14:03");
  });

  it("accepts only time zones the runtime knows", () => {
    expect(safeTimeZone("Europe/Moscow")).toBe("Europe/Moscow");
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
  });

  it("says how long ago", () => {
    const now = Date.parse(at);
    expect(formatRelative("2026-09-29T13:58:12.000Z", now, "en")).toBe(
      "5 minutes ago",
    );
    expect(formatRelative("2026-09-28T14:03:12.000Z", now, "en")).toBe(
      "yesterday",
    );
    expect(formatRelative("2026-09-29T16:03:12.000Z", now, "en")).toBe(
      "in 2 hours",
    );
  });

  it("lists the last days in UTC, oldest first", () => {
    expect(lastDays(3, Date.parse(at))).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
    ]);
    expect(dayLabel("2026-09-29", "en")).toBe("Sep 29");
  });
});

describe("numbers and text", () => {
  it("formats durations", () => {
    expect(formatDuration(45_000, "en")).toBe("45 sec");
    expect(formatDuration(95_000, "en")).toBe("1 min 35 sec");
    expect(formatDuration(2 * 3600_000, "en")).toBe("2 hr");
    expect(formatDuration(72 * 3600_000, "en")).toBe("3 days");
  });

  it("formats shares", () => {
    expect(formatPercent(0.456, "en")).toBe("46%");
    expect(formatPercent(0.456, "en", 1)).toBe("45.6%");
  });

  it("masks emails for roles without PII access", () => {
    expect(maskEmail("anna@example.com")).toBe("a***@example.com");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmailsIn('{"buyer":{"email":"kraken.fan@example.net"}}')).toBe(
      '{"buyer":{"email":"k***@example.net"}}',
    );
  });

  it("names board cells like players do", () => {
    expect(coordinate(0, 0)).toBe("A1");
    expect(coordinate(4, 4)).toBe("E5");
    expect(coordinate(9, 9)).toBe("J10");
  });

  it("shortens ids", () => {
    expect(shortId("5b449591-0000-4000-8000-000000000000")).toBe("5b449591");
    expect(shortId("abc")).toBe("abc");
  });
});
