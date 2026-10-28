import type { DailyStatus } from "@outegro/contracts/daily-bonus";
import { describe, expect, it } from "vitest";
import { dailyFailure } from "@/lib/daily";
import { countdown, prizeRibbon, RIBBON_WIN_AT } from "../daily-ribbon";
import { DailyStore } from "./daily-store";

const prizes = [
  { amount: 25, chance: 0.35 },
  { amount: 50, chance: 0.28 },
  { amount: 100, chance: 0.18 },
  { amount: 250, chance: 0.11 },
  { amount: 500, chance: 0.05 },
  { amount: 1000, chance: 0.025 },
  { amount: 5000, chance: 0.005 },
];

const NOW = Date.parse("2026-10-28T10:00:00.000Z");

function status(overrides: Partial<DailyStatus> = {}): DailyStatus {
  return {
    available: true,
    nextAt: null,
    blocked: null,
    streak: 2,
    streakBonusPercent: 20,
    prizes,
    ...overrides,
  };
}

/** The BFF's /api/daily as a script of answers. */
function fakeBff(answers: { status: number; body: unknown }[]) {
  const calls: string[] = [];
  const fetcher = async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    const answer = answers.shift() ?? { status: 503, body: {} };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
    });
  };
  return { fetcher, calls };
}

describe("DailyStore", () => {
  it("takes the bonus, spins, and changes the balance only when the ribbon stops", async () => {
    const balances: (number | null)[] = [];
    const bff = fakeBff([
      { status: 200, body: status() },
      {
        status: 200,
        body: {
          claimNo: 3,
          prizeIndex: 2,
          basePrize: 100,
          prize: 120,
          streak: 3,
          nextAt: "2026-10-29T10:00:00.000Z",
          balance: 1120,
        },
      },
    ]);
    const store = new DailyStore({
      fetcher: bff.fetcher,
      onBalance: (balance) => balances.push(balance),
    });
    await store.load();
    expect(store.isReady(NOW)).toBe(true);
    await store.take();
    expect(store.spinning).toBe(true);
    expect(store.claim?.prize).toBe(120);
    expect(balances).toEqual([]);
    expect(store.msLeft(NOW)).toBe(24 * 3600 * 1000);
    store.finishSpin();
    expect(balances).toEqual([1120]);
    expect(store.isReady(NOW)).toBe(false);
    expect(bff.calls).toEqual(["GET /api/daily", "POST /api/daily"]);
  });

  it("counts down to nextAt while it is not yet time", async () => {
    const bff = fakeBff([
      {
        status: 200,
        body: status({ available: false, nextAt: "2026-10-28T12:30:05.000Z" }),
      },
    ]);
    const store = new DailyStore({ fetcher: bff.fetcher });
    await store.load();
    expect(store.isReady(NOW)).toBe(false);
    expect(countdown(store.msLeft(NOW) ?? 0)).toBe("02:30:05");
  });

  it("on 409 shows the timer from a fresh status", async () => {
    const bff = fakeBff([
      { status: 409, body: { error: "not_yet" } },
      {
        status: 200,
        body: status({ available: false, nextAt: "2026-10-28T11:00:00.000Z" }),
      },
    ]);
    const store = new DailyStore({ fetcher: bff.fetcher });
    await store.take();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bff.calls).toEqual(["POST /api/daily", "GET /api/daily"]);
    expect(store.msLeft(NOW)).toBe(3600 * 1000);
  });

  it("explains a blocked bonus, too many claims and an outage", async () => {
    const blocked = new DailyStore({
      fetcher: fakeBff([
        { status: 403, body: { error: "blocked", reason: "email_unverified" } },
      ]).fetcher,
    });
    await blocked.take();
    expect(blocked.problem).toEqual({
      error: "blocked",
      reason: "email_unverified",
    });
    const limited = new DailyStore({
      fetcher: fakeBff([{ status: 429, body: { error: "rate_limited" } }])
        .fetcher,
    });
    await limited.take();
    expect(limited.problem).toEqual({ error: "rate_limited" });
    const down = new DailyStore({
      fetcher: fakeBff([{ status: 503, body: "oops" }]).fetcher,
    });
    await down.load();
    expect(down.problem).toEqual({ error: "unavailable" });
    // A status that says "blocked" is never ready.
    const closed = new DailyStore({
      fetcher: fakeBff([
        {
          status: 200,
          body: status({ available: false, blocked: "disabled" }),
        },
      ]).fetcher,
    });
    await closed.load();
    expect(closed.msLeft(NOW)).toBeNull();
    expect(closed.problem).toEqual({ error: "blocked", reason: "disabled" });
  });
});

describe("dailyFailure", () => {
  it("maps the backend's refusals", () => {
    expect(dailyFailure(409)).toEqual({
      status: 409,
      body: { error: "not_yet" },
    });
    expect(dailyFailure(403, { reason: ["account_too_new"] })).toEqual({
      status: 403,
      body: { error: "blocked", reason: "account_too_new" },
    });
    expect(dailyFailure(403, {}).body).toEqual({
      error: "blocked",
      reason: "account_closed",
    });
    expect(dailyFailure(429).body).toEqual({ error: "rate_limited" });
    expect(dailyFailure(500)).toEqual({
      status: 503,
      body: { error: "unavailable" },
    });
    expect(dailyFailure(401).body).toEqual({ error: "signed_out" });
  });
});

describe("prizeRibbon", () => {
  it("stops on the prize the server picked, the same for the same claim", () => {
    const ribbon = prizeRibbon(prizes, 4, 3);
    expect(ribbon.tiles[RIBBON_WIN_AT]).toBe(4);
    expect(ribbon.winAt).toBe(RIBBON_WIN_AT);
    expect(ribbon.within).toBeGreaterThanOrEqual(0.25);
    expect(ribbon.within).toBeLessThanOrEqual(0.75);
    expect(prizeRibbon(prizes, 4, 3)).toEqual(ribbon);
    expect(
      ribbon.tiles.every((tile) => tile >= 0 && tile < prizes.length),
    ).toBe(true);
  });

  it("fills the ribbon with the table's own odds", () => {
    let small = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++)
      for (const [i, tile] of prizeRibbon(prizes, 0, seed).tiles.entries())
        if (i !== RIBBON_WIN_AT) {
          total += 1;
          if (tile <= 1) small += 1;
        }
    // 25 and 50 make 63 % of the table.
    expect(small / total).toBeGreaterThan(0.55);
    expect(small / total).toBeLessThan(0.71);
  });

  it("formats the countdown", () => {
    expect(countdown(0)).toBe("00:00:00");
    expect(countdown(61_500)).toBe("00:01:02");
    expect(countdown(-5)).toBe("00:00:00");
  });
});
