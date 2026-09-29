import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatters,
  safeTimeZone,
} from "./format";

// ICU separates amounts and symbols with no-break spaces; compare words.
const plain = (text: string) => text.replace(/[\s  ]+/g, " ");

describe("formatMoney", () => {
  it.each([
    [{ minor: "5000", currency: "RUB", scale: 2 }, "en", "₽50"],
    [{ minor: "5000", currency: "RUB", scale: 2 }, "ru", "50 ₽"],
    [{ minor: "59", currency: "USD", scale: 2 }, "en", "$0.59"],
    [{ minor: "59", currency: "USD", scale: 2 }, "ru", "0,59 $"],
    [{ minor: "52", currency: "EUR", scale: 2 }, "en", "€0.52"],
    [{ minor: "52", currency: "EUR", scale: 2 }, "ru", "0,52 €"],
    [{ minor: "150", currency: "USD", scale: 2 }, "en", "$1.50"],
  ])("%o in %s is %s", (money, locale, expected) => {
    expect(plain(formatMoney(money, locale))).toBe(expected);
  });

  it("shows every digit of the currency on receipts", () => {
    const money = { minor: "5000", currency: "RUB", scale: 2 };
    expect(plain(formatMoney(money, "en", { exact: true }))).toBe("₽50.00");
    expect(plain(formatMoney(money, "ru", { exact: true }))).toBe("50,00 ₽");
  });

  it("keeps amounts beyond Number.MAX_SAFE_INTEGER exact", () => {
    const money = { minor: "123456789012345678901", currency: "USD", scale: 2 };
    expect(formatMoney(money, "en")).toBe("$1,234,567,890,123,456,789.01");
  });

  it("follows the scale the server sends, not the currency's default", () => {
    expect(
      formatMoney({ minor: "1200", currency: "JPY", scale: 0 }, "en"),
    ).toBe("¥1,200");
    expect(
      formatMoney({ minor: "1234", currency: "KWD", scale: 3 }, "en"),
    ).toContain("1.234");
  });

  it("formats refunds (negative amounts) without losing the sign", () => {
    expect(
      formatMoney({ minor: "-5000", currency: "RUB", scale: 2 }, "en"),
    ).toBe("-₽50");
  });
});

describe("dates", () => {
  const late = "2026-09-29T21:30:00.000Z";

  it("uses the viewer's time zone, so the day can change", () => {
    expect(formatDate(late, "en", "UTC")).toBe("Sep 29, 2026");
    expect(formatDate(late, "en", "Asia/Tbilisi")).toBe("Sep 30, 2026");
  });

  it("uses the page language", () => {
    const text = plain(formatDateTime(late, "ru", "Europe/Moscow"));
    expect(text).toContain("30 сент. 2026");
    expect(text).toContain("00:30");
  });

  it("binds language and zone once", () => {
    const format = formatters("en", "UTC");
    expect(format.date(late)).toBe("Sep 29, 2026");
    expect(
      plain(format.money({ minor: "59", currency: "USD", scale: 2 })),
    ).toBe("$0.59");
  });
});

describe("safeTimeZone", () => {
  it.each([
    ["Europe/Moscow", "Europe/Moscow"],
    ["Asia/Tbilisi", "Asia/Tbilisi"],
    ["Mars/Olympus_Mons", "UTC"],
    ["", "UTC"],
    [null, "UTC"],
    ["x".repeat(80), "UTC"],
  ])("%s → %s", (input, expected) => {
    expect(safeTimeZone(input)).toBe(expected);
  });
});
