import { describe, expect, it } from "vitest";
import { grantPhase } from "./grants";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

type State = "active" | "revoked" | "expired";
const grant = (state: State, from: number, until: number | null) => ({
  state,
  validFrom: at(from),
  validUntil: until === null ? null : at(until),
});

describe("where a grant stands", () => {
  it("is in force inside its window, with or without an end", () => {
    expect(grantPhase(grant("active", -3, null), NOW)).toBe("active");
    expect(grantPhase(grant("active", -3, 30), NOW)).toBe("active");
  });

  it("is scheduled before its window opens, though Payments says active", () => {
    expect(grantPhase(grant("active", 2, 30), NOW)).toBe("scheduled");
    expect(grantPhase(grant("active", 2, null), NOW)).toBe("scheduled");
  });

  it("has expired once its end has passed, before Payments marks it so", () => {
    expect(grantPhase(grant("active", -40, -3), NOW)).toBe("expired");
    expect(grantPhase(grant("expired", -40, -3), NOW)).toBe("expired");
  });

  it("opens at its first moment and closes at its last, [from, until)", () => {
    expect(grantPhase(grant("active", 0, null), NOW)).toBe("active");
    expect(grantPhase(grant("active", -1, 0), NOW)).toBe("expired");
    expect(grantPhase(grant("active", -1, 0), NOW - 1)).toBe("active");
    expect(grantPhase(grant("active", 0, 1), NOW - 1)).toBe("scheduled");
  });

  it("stays revoked whatever its window", () => {
    for (const [from, until] of [
      [-3, null],
      [2, 30],
      [-40, -3],
    ] as const)
      expect(grantPhase(grant("revoked", from, until), NOW)).toBe("revoked");
  });

  it("is in force exactly when Education counts it in force", () => {
    // The contract's `inForce`: active, and inside [validFrom, validUntil).
    const inForce = (value: ReturnType<typeof grant>) =>
      value.state === "active" &&
      Date.parse(value.validFrom) <= NOW &&
      (value.validUntil === null || Date.parse(value.validUntil) > NOW);
    for (const state of ["active", "revoked", "expired"] as const)
      for (const from of [-5, 0, 5])
        for (const until of [null, -2, 0, 2, 10]) {
          const value = grant(state, from, until);
          expect(
            grantPhase(value, NOW) === "active",
            JSON.stringify(value),
          ).toBe(inForce(value));
        }
  });
});
