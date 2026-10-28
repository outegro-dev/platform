import { dailySettingsCommandSchema } from "@outegro/contracts/daily-bonus";
import {
  rouletteColorSchema,
  roulettePhaseSchema,
  rouletteUnit,
  tableSettingsSchema,
} from "@outegro/contracts/roulette";
import { describe, expect, it } from "vitest";
import {
  auditTargetOf,
  chancesSumToOne,
  expectedPrize,
  exposureOf,
  grm,
  isVoidable,
  phaseEndsAt,
  prizeTableOf,
  rouletteColors,
  roulettePhases,
  roundParam,
  roundTotals,
  rowsOf,
  samePrizes,
  secondsUntil,
  tableDiff,
  tableFields,
} from "./roulette";

const AT_LATER = "2026-10-28T11:00:00.000Z";
const settings = tableSettingsSchema.parse({
  minBet: 10,
  maxBet: 50_000,
  betsPerRound: 5,
  payoutLimitPerColor: 1_000_000,
  paused: false,
  maintenance: false,
  version: 7,
  updatedAt: "2026-10-28T10:00:00.000Z",
});

describe("roulette in the console's terms", () => {
  it("knows the contract's colours, phases and unit", () => {
    expect([...rouletteColors]).toEqual(rouletteColorSchema.options);
    expect([...roulettePhases]).toEqual(roulettePhaseSchema.options);
    expect(grm).toBe(rouletteUnit);
    // Every setting of the form is a setting of the contract.
    for (const field of tableFields)
      expect(tableSettingsSchema.shape).toHaveProperty(field);
  });

  it("marks a colour close to the limit over 80 %, full at the limit", () => {
    const [red, black, green] = exposureOf(
      { red: 800_000, black: 800_001, green: 1_000_000 },
      1_000_000,
    );
    expect(red).toMatchObject({ color: "red", ratio: 0.8, near: false });
    expect(black).toMatchObject({ near: true, full: false });
    expect(green).toMatchObject({ near: true, full: true, ratio: 1 });
    // No limit: nothing to compare against.
    expect(exposureOf({ red: 5, black: 0, green: 0 }, 0)[0]).toMatchObject({
      ratio: 0,
      near: false,
      full: false,
    });
  });

  it("sums the round's bets over every colour", () => {
    const totals = (count: number, sum: number) => ({ count, sum, top: [] });
    expect(
      roundTotals({
        totals: {
          red: totals(3, 300),
          black: totals(2, 150),
          green: totals(1, 5),
        },
      }),
    ).toEqual({ count: 6, sum: 455 });
  });

  it("counts down to the end of the current phase", () => {
    const round = {
      bettingEndsAt: "2026-10-28T10:00:20.000Z",
      rollingAt: "2026-10-28T10:00:22.000Z",
      settleAt: "2026-10-28T10:00:28.000Z",
      nextRoundAt: "2026-10-28T10:00:31.000Z",
    };
    expect(phaseEndsAt({ ...round, phase: "betting" })).toBe(
      round.bettingEndsAt,
    );
    expect(phaseEndsAt({ ...round, phase: "locked" })).toBe(round.rollingAt);
    expect(phaseEndsAt({ ...round, phase: "rolling" })).toBe(round.settleAt);
    expect(phaseEndsAt({ ...round, phase: "settled" })).toBe(round.nextRoundAt);
    const now = Date.parse("2026-10-28T10:00:08.300Z");
    expect(secondsUntil(round.bettingEndsAt, now)).toBe(12);
    expect(secondsUntil(round.bettingEndsAt, now + 60_000)).toBe(0);
    expect(secondsUntil(null, now)).toBeNull();
  });

  it("voids only rounds that are not paid out or voided yet", () => {
    expect(roulettePhases.filter(isVoidable)).toEqual([
      "betting",
      "locked",
      "rolling",
    ]);
  });

  it("lists what a table command changes, nothing for the same settings", () => {
    // Only the settings count: a new version alone changes nothing.
    const next = { ...settings, version: 8, updatedAt: AT_LATER };
    expect(tableDiff(settings, next)).toEqual([]);
    expect(
      tableDiff(settings, { ...settings, maxBet: 20_000, paused: true }),
    ).toEqual([
      { field: "maxBet", before: 50_000, after: 20_000 },
      { field: "paused", before: false, after: true },
    ]);
  });
});

describe("the prize table of the bonus of the day", () => {
  it("reads typed percents as the contract's chances", () => {
    const table = prizeTableOf([
      { amount: "10", percent: "70" },
      { amount: "50", percent: "25,5" },
      { amount: " 500 ", percent: "4.5" },
    ]);
    expect(table).toEqual({
      ok: true,
      prizes: [
        { amount: 10, chance: 0.7 },
        { amount: 50, chance: 0.255 },
        { amount: 500, chance: 0.045 },
      ],
    });
    if (!table.ok) return;
    // The service's own rule accepts it.
    expect(
      dailySettingsCommandSchema.safeParse({
        enabled: true,
        streaksEnabled: false,
        prizes: table.prizes,
        expectedVersion: 1,
        reason: "New table",
      }).success,
    ).toBe(true);
    expect(expectedPrize(table.prizes)).toBeCloseTo(7 + 12.75 + 22.5, 9);
  });

  it("names what is wrong with a table", () => {
    expect(prizeTableOf([])).toEqual({ ok: false, problem: "empty" });
    const row = { amount: "1", percent: "5" };
    expect(prizeTableOf(Array.from({ length: 21 }, () => row))).toEqual({
      ok: false,
      problem: "too-many",
    });
    expect(prizeTableOf([{ amount: "1.5", percent: "100" }])).toEqual({
      ok: false,
      problem: "amount",
    });
    expect(prizeTableOf([{ amount: "0", percent: "100" }])).toEqual({
      ok: false,
      problem: "amount",
    });
    expect(prizeTableOf([{ amount: "5", percent: "" }])).toEqual({
      ok: false,
      problem: "chance",
    });
    expect(prizeTableOf([{ amount: "5", percent: "120" }])).toEqual({
      ok: false,
      problem: "chance",
    });
    expect(
      prizeTableOf([
        { amount: "5", percent: "60" },
        { amount: "9", percent: "30" },
      ]),
    ).toEqual({ ok: false, problem: "sum" });
  });

  it("sums chances like the contract, a float's rounding aside", () => {
    expect(
      chancesSumToOne([{ chance: 0.1 }, { chance: 0.2 }, { chance: 0.7 }]),
    ).toBe(true);
    expect(chancesSumToOne([{ chance: 0.5 }, { chance: 0.4999 }])).toBe(false);
  });

  it("shows stored chances as short percents and tells tables apart", () => {
    const prizes = [
      { amount: 10, chance: 0.7 },
      { amount: 50, chance: 0.3 },
    ];
    expect(rowsOf(prizes)).toEqual([
      { amount: "10", percent: "70" },
      { amount: "50", percent: "30" },
    ]);
    expect(samePrizes(prizes, [...prizes])).toBe(true);
    expect(samePrizes(prizes, [...prizes].reverse())).toBe(false);
    expect(samePrizes(prizes, prizes.slice(1))).toBe(false);
  });
});

describe("roulette audit targets", () => {
  it("point at a round, the table or the bonus", () => {
    expect(auditTargetOf("round:184")).toEqual({
      targetType: "round",
      targetId: "184",
    });
    expect(auditTargetOf("table")).toEqual({
      targetType: "settings",
      targetId: "table",
    });
    expect(auditTargetOf("daily")).toEqual({
      targetType: "settings",
      targetId: "daily",
    });
    // Something newer is shown as written.
    expect(auditTargetOf("player:abc")).toEqual({
      targetType: "player",
      targetId: "abc",
    });
    expect(auditTargetOf("everything")).toEqual({
      targetType: "subject",
      targetId: "everything",
    });
  });

  it("read a round number from the URL and nothing else", () => {
    expect(roundParam("184")).toBe(184);
    expect(roundParam("0")).toBeNull();
    expect(roundParam("-1")).toBeNull();
    expect(roundParam("1e3")).toBeNull();
    expect(roundParam("12345678901234")).toBeNull();
  });
});
