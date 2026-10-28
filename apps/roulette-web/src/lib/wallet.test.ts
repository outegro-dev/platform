import { describe, expect, it } from "vitest";
import { balanceOf } from "./wallet";

describe("balanceOf", () => {
  it("reads the wallet's balance as a number or a bigint string", () => {
    const wallet = { state: "active", exists: true, updatedAt: null };
    expect(balanceOf({ ...wallet, unit: "GRM", balance: 1250 })).toBe(1250);
    expect(balanceOf({ ...wallet, unit: "GRM", balance: "98000" })).toBe(
      98_000,
    );
  });

  it("says unknown for anything else", () => {
    expect(balanceOf({ unit: "GRM", balance: null })).toBeNull();
    expect(balanceOf({ unit: "GRM", balance: "-5" })).toBeNull();
    expect(balanceOf({ unit: "GRM", balance: "1e9" })).toBeNull();
    expect(balanceOf({ unit: "XYZ", balance: 10 })).toBeNull();
    expect(balanceOf(null)).toBeNull();
  });
});
