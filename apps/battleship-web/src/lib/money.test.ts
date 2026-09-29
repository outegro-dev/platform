import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

// Intl output uses narrow/no-break spaces; compare with plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("formatMoney", () => {
  it("formats minor units with the currency's scale", () => {
    expect(
      plain(formatMoney({ minor: "14990", currency: "RUB", scale: 2 }, "ru")),
    ).toBe("149,90 ₽");
    expect(formatMoney({ minor: "499", currency: "USD", scale: 2 }, "en")).toBe(
      "$4.99",
    );
  });

  it("uses the currency sign in any language", () => {
    expect(
      formatMoney({ minor: "5000", currency: "RUB", scale: 2 }, "en"),
    ).toBe("₽50");
    expect(
      plain(formatMoney({ minor: "52", currency: "EUR", scale: 2 }, "ru")),
    ).toBe("0,52 €");
  });

  it("drops a zero fraction", () => {
    expect(
      plain(formatMoney({ minor: "29900", currency: "RUB", scale: 2 }, "ru")),
    ).toBe("299 ₽");
    expect(formatMoney({ minor: "500", currency: "USD", scale: 2 }, "en")).toBe(
      "$5",
    );
  });

  it("handles scale 0 and 3 currencies", () => {
    expect(
      formatMoney({ minor: "1500", currency: "JPY", scale: 0 }, "en"),
    ).toBe("¥1,500");
    expect(
      plain(formatMoney({ minor: "1234", currency: "KWD", scale: 3 }, "en")),
    ).toBe("KWD 1.234");
  });

  it("keeps precision beyond the float range", () => {
    expect(
      formatMoney(
        { minor: "900719925474099312", currency: "USD", scale: 2 },
        "en",
      ),
    ).toBe("$9,007,199,254,740,993.12");
  });

  it("formats negative amounts (refunds)", () => {
    expect(
      formatMoney({ minor: "-250", currency: "EUR", scale: 2 }, "en"),
    ).toBe("-€2.50");
  });
});
