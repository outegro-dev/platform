import { describe, expect, it } from "vitest";
import { applyQuick, checkAmount, parseAmount } from "./amount";

const limits = { balance: 1000, maxBet: 100_000 };

describe("amount", () => {
  it("applies the quick buttons", () => {
    expect(applyQuick(100, "clear", limits)).toBe(0);
    expect(applyQuick(100, "add10", limits)).toBe(110);
    expect(applyQuick(100, "add100", limits)).toBe(200);
    expect(applyQuick(100, "add1000", limits)).toBe(1100);
    expect(applyQuick(101, "half", limits)).toBe(50);
    expect(applyQuick(300, "double", limits)).toBe(600);
    expect(applyQuick(5, "max", limits)).toBe(1000);
  });

  it("never goes past the table maximum, Max never past the balance", () => {
    expect(applyQuick(90_000, "double", limits)).toBe(100_000);
    expect(applyQuick(0, "max", { balance: 250_000, maxBet: 100_000 })).toBe(
      100_000,
    );
    expect(applyQuick(0, "half", limits)).toBe(0);
  });

  it("reads what the player typed", () => {
    expect(parseAmount("1 000")).toBe(1000);
    expect(parseAmount("12 500")).toBe(12_500);
    expect(parseAmount("12.5")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("checks a stake like the server", () => {
    const table = { balance: 1000, minBet: 10, maxBet: 100_000 };
    expect(checkAmount(9, table)).toBe("bet_too_small");
    expect(checkAmount(10, table)).toBeNull();
    expect(checkAmount(1001, table)).toBe("insufficient_funds");
    expect(checkAmount(100_001, { ...table, balance: 10 ** 6 })).toBe(
      "bet_too_large",
    );
  });
});
