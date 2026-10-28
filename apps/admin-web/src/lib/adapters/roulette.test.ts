import {
  BackendError,
  BackendUnavailable,
  type RequestOptions,
} from "@outegro/bff/backend";
import { describe, expect, it, vi } from "vitest";
import { ContractMismatch, NotConnected } from "../result";
import type { Call, Transport } from "./base";
import { DailyAdmin } from "./daily";
import { RouletteAdmin } from "./roulette";

type Recorded = { path: string; options: RequestOptions | undefined };

function transport(
  answer: (path: string, options?: RequestOptions) => unknown,
) {
  const calls: Recorded[] = [];
  const call = (async (path: string, options?: RequestOptions) => {
    calls.push({ path, options });
    return answer(path, options);
  }) as Call;
  const value: Transport = { call, token: async () => "token-123" };
  return { transport: value, calls };
}

const apiError = (status: number, code: string) =>
  new BackendError(status, {
    code,
    messageKey: "errors.x",
    fieldErrors: {},
    requestId: "req-1",
    retryable: false,
  });

const AT = "2026-10-28T10:00:00.000Z";
const SEED = "a".repeat(64);
const USER = "5b449591-2f6e-4c8a-9d3b-1e7f0a2c4d6e";
const ACTOR = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const table = {
  minBet: 10,
  maxBet: 50_000,
  betsPerRound: 5,
  payoutLimitPerColor: 1_000_000,
  paused: false,
  maintenance: false,
  version: 3,
  updatedAt: AT,
};
const colour = { count: 0, sum: 0, top: [] };
const house = { rounds: 1, bets: 2, staked: 300, paidOut: 100, result: 200 };
const live = {
  round: {
    round: 184,
    phase: "betting",
    bettingEndsAt: AT,
    rollingAt: null,
    settleAt: null,
    nextRoundAt: null,
    result: null,
    totals: { red: colour, black: colour, green: colour },
    table: { paused: false, maintenance: false },
  },
  online: 12,
  table,
  exposure: { red: 0, black: 0, green: 0 },
  house: { day: house, total: house },
};

const roulette = (
  answer: (path: string, options?: RequestOptions) => unknown,
) => {
  const { transport: t, calls } = transport(answer);
  return { admin: new RouletteAdmin("roulette", t), calls };
};

describe("roulette adapter", () => {
  it("is not connected without a base URL", async () => {
    const admin = new RouletteAdmin("roulette", null);
    expect(admin.configured).toBe(false);
    await expect(admin.live()).rejects.toMatchObject({
      service: "roulette",
      reason: "unconfigured",
    });
  });

  it("reads 'does not answer' as not connected; a missing round is a missing round", async () => {
    const down = roulette(() => {
      throw new BackendUnavailable("ECONNREFUSED");
    }).admin;
    await expect(down.live()).rejects.toBeInstanceOf(NotConnected);
    const old = roulette(() => {
      throw apiError(404, "NOT_FOUND");
    }).admin;
    // An older build without the admin API.
    await expect(old.rounds({})).rejects.toMatchObject({
      reason: "unreachable",
    });
    await expect(old.round(7)).rejects.toBeInstanceOf(BackendError);
  });

  it("parses the live table with the contract and refuses a drifted shape", async () => {
    const { admin, calls } = roulette(() => live);
    const data = await admin.live();
    expect(data.round?.round).toBe(184);
    expect(calls[0]?.path).toBe("/v1/admin/live");
    expect(calls[0]?.options?.accessToken).toBe("token-123");
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const drifted = roulette(() => ({ ...live, online: "many" })).admin;
    await expect(drifted.live()).rejects.toBeInstanceOf(ContractMismatch);
    quiet.mockRestore();
  });

  it("pages rounds and searches players in the query string", async () => {
    const { admin, calls } = roulette(() => ({ items: [], nextCursor: null }));
    await admin.rounds({ cursor: "180", limit: 25 });
    await admin.players({ q: "wolf", limit: 25 });
    expect(calls.map((call) => call.path)).toEqual([
      "/v1/admin/rounds?cursor=180&limit=25",
      "/v1/admin/players?q=wolf&limit=25",
    ]);
  });

  it("previews a void first, then sends the same body without the flag", async () => {
    const { admin, calls } = roulette((_path, options) => ({
      preview:
        (options?.body as { preview?: boolean } | undefined)?.preview === true,
      round: 184,
      bets: 3,
      refunded: 450,
    }));
    expect(
      await admin.voidRound(184, { reason: "Stuck wheel", preview: true }),
    ).toEqual({ preview: true, round: 184, bets: 3, refunded: 450 });
    await admin.voidRound(184, { reason: "Stuck wheel", preview: false });
    expect(calls[0]?.path).toBe("/v1/admin/rounds/184/void");
    expect(calls[0]?.options?.method).toBe("POST");
    expect(calls[0]?.options?.body).toEqual({
      reason: "Stuck wheel",
      preview: true,
    });
    expect(calls[1]?.options?.body).toEqual({ reason: "Stuck wheel" });
    for (const call of calls)
      expect(JSON.stringify(call.options?.body)).not.toMatch(/actor/i);
  });

  it("changes the table with the expected version, never an actor", async () => {
    const { admin, calls } = roulette(() => ({
      preview: false,
      before: table,
      after: { ...table, paused: true, version: 4 },
    }));
    const result = await admin.setTable({
      minBet: 10,
      maxBet: 50_000,
      betsPerRound: 5,
      payoutLimitPerColor: 1_000_000,
      paused: true,
      maintenance: false,
      expectedVersion: 3,
      reason: "Wallet incident",
      preview: false,
    });
    expect(result.after.paused).toBe(true);
    expect(calls[0]?.path).toBe("/v1/admin/table");
    expect(calls[0]?.options?.body).toEqual({
      minBet: 10,
      maxBet: 50_000,
      betsPerRound: 5,
      payoutLimitPerColor: 1_000_000,
      paused: true,
      maintenance: false,
      expectedVersion: 3,
      reason: "Wallet incident",
    });
  });

  it("reads the audit's subject as a target the feed can name and link", async () => {
    const entry = {
      id: "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a",
      actorId: ACTOR,
      action: "round.void",
      reason: "Stuck wheel",
      subject: "round:184",
      createdAt: AT,
    };
    const { admin, calls } = roulette(() => ({
      items: [
        entry,
        { ...entry, id: USER, action: "table.update", subject: "table" },
        // A newer roulette-backend: still an entry.
        { ...entry, id: ACTOR, action: "player.limit", subject: "player:x" },
      ],
      nextCursor: "50",
    }));
    const page = await admin.audit({ limit: 30 });
    expect(calls[0]?.path).toBe("/v1/admin/audit?limit=30");
    expect(page.nextCursor).toBe("50");
    expect(page.items.map((item) => [item.targetType, item.targetId])).toEqual([
      ["round", "184"],
      ["settings", "table"],
      ["player", "x"],
    ]);
    expect(page.items[0]).toMatchObject({
      action: "round.void",
      reason: "Stuck wheel",
      createdAt: AT,
      data: {},
    });
  });

  it("reads a round with its seeds and top bets", async () => {
    const { admin } = roulette(() => ({
      round: 184,
      phase: "settled",
      number: 0,
      color: "green",
      openedAt: AT,
      bets: 1,
      staked: 100,
      paidOut: 1400,
      result: -1300,
      seed: SEED,
      previousSeed: SEED,
      commit: SEED,
      publicSeed: "bitcoin-block-1",
      linkVerified: true,
      topBets: [
        {
          betId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
          round: 184,
          userId: USER,
          nickname: "SeaWolf",
          color: "green",
          amount: 100,
          status: "won",
          payout: 1400,
          createdAt: AT,
        },
      ],
    }));
    const round = await admin.round(184);
    expect(round.linkVerified).toBe(true);
    expect(round.topBets[0]?.nickname).toBe("SeaWolf");
  });
});

describe("daily bonus adapter", () => {
  const settings = {
    enabled: true,
    streaksEnabled: false,
    prizes: [
      { amount: 10, chance: 0.9 },
      { amount: 100, chance: 0.1 },
    ],
    version: 2,
    updatedAt: AT,
  };

  it("is not connected without a base URL", async () => {
    const daily = new DailyAdmin("daily", null);
    await expect(daily.overview()).rejects.toMatchObject({
      service: "daily",
      reason: "unconfigured",
    });
  });

  it("reads the overview and previews a change with both expected prizes", async () => {
    const { transport: t, calls } = transport((path) =>
      path === "/v1/admin/daily"
        ? {
            settings,
            expectedPrize: 19,
            last24h: { claims: 4, granted: 76 },
            suspicions: [
              {
                kind: "shared_ip",
                key: "c0ffee",
                users: [USER, ACTOR],
                claims: 2,
                lastAt: AT,
              },
            ],
          }
        : {
            preview: true,
            before: settings,
            after: { ...settings, streaksEnabled: true },
            expectedPrizeBefore: 19,
            expectedPrizeAfter: 19,
          },
    );
    const daily = new DailyAdmin("daily", t);
    expect((await daily.overview()).suspicions[0]?.users).toHaveLength(2);
    const preview = await daily.setSettings({
      enabled: true,
      streaksEnabled: true,
      prizes: settings.prizes,
      expectedVersion: 2,
      reason: "Streaks for the launch",
      preview: true,
    });
    expect(preview.after.streaksEnabled).toBe(true);
    expect(calls[1]?.path).toBe("/v1/admin/daily/settings");
    expect(calls[1]?.options?.body).toEqual({
      enabled: true,
      streaksEnabled: true,
      prizes: settings.prizes,
      expectedVersion: 2,
      reason: "Streaks for the launch",
      preview: true,
    });
  });
});
