import {
  BackendError,
  BackendUnavailable,
  type RequestOptions,
} from "@outegro/bff/backend";
import { describe, expect, it, vi } from "vitest";
import { ContractMismatch, failureOf, load, NotConnected } from "../result";
import type { Call, Transport } from "./base";
import { withQuery } from "./base";
import { BattleshipAdmin } from "./battleship";
import { IdentityAdmin } from "./identity";
import { NotificationsAdmin } from "./notifications";
import { canStopRenewal, PaymentsAdmin } from "./payments";

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

const apiError = (status: number, code: string, fieldErrors = {}) =>
  new BackendError(status, {
    code,
    messageKey: "errors.x",
    fieldErrors,
    requestId: "req-1",
    retryable: false,
  });

describe("request plumbing", () => {
  it("drops empty query values", () => {
    expect(withQuery("/v1/x", { a: "1", b: undefined, c: "", d: 0 })).toBe(
      "/v1/x?a=1&d=0",
    );
    expect(withQuery("/v1/x")).toBe("/v1/x");
  });

  it("sends the operator's token and never an actor id", async () => {
    const { transport: t, calls } = transport(() => ({ id: "binding" }));
    await new IdentityAdmin(t).grantRole("user-1", {
      role: "support",
      reason: "Joined support",
      expiresAt: null,
    });
    expect(calls[0]?.path).toBe("/v1/admin/users/user-1/role-bindings");
    expect(calls[0]?.options?.accessToken).toBe("token-123");
    expect(calls[0]?.options?.method).toBe("POST");
    expect(JSON.stringify(calls[0]?.options?.body)).not.toMatch(/actor/i);
  });

  it("maps failures to states, never to empty data", async () => {
    expect(failureOf(apiError(403, "FORBIDDEN")).kind).toBe("forbidden");
    expect(failureOf(apiError(404, "NOT_FOUND")).kind).toBe("not-found");
    expect(failureOf(apiError(401, "UNAUTHENTICATED")).kind).toBe(
      "unauthenticated",
    );
    expect(failureOf(apiError(500, "INTERNAL"))).toEqual({
      kind: "unavailable",
      requestId: "req-1",
    });
    expect(failureOf(new BackendUnavailable("timeout")).kind).toBe(
      "unavailable",
    );
    expect(failureOf(new NotConnected("payments", "unconfigured"))).toEqual({
      kind: "not-connected",
      reason: "unconfigured",
    });
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(
      (await load(async () => Promise.reject(new ContractMismatch("x")))).ok,
    ).toBe(false);
    quiet.mockRestore();
  });

  it("unwraps notification templates", async () => {
    const { transport: t } = transport(() => ({
      items: [{ key: "service.test" }],
    }));
    expect(await new NotificationsAdmin(t).templates()).toEqual([
      { key: "service.test" },
    ]);
  });
});

describe("payments adapter", () => {
  const catalog = {
    checkoutEnabled: false,
    products: [
      {
        key: "battleship-premium",
        service: "battleship",
        feature: "premium",
        kind: "subscription",
        periodicity: "MONTHLY",
        graceDays: 3,
        title: { en: "Battleship Premium", ru: "Морской бой Premium" },
        description: { en: "…", ru: "…" },
        prices: [
          {
            priceId: "p1",
            version: 1,
            money: { minor: "5000", currency: "RUB", scale: 2 },
          },
        ],
      },
    ],
  };

  it("is not connected without a base URL", async () => {
    const payments = new PaymentsAdmin("payments", null);
    expect(payments.configured).toBe(false);
    await expect(payments.catalog()).rejects.toMatchObject({
      reason: "unconfigured",
    });
  });

  it("reads 'does not answer' as not connected, not as an error loop", async () => {
    const down = new PaymentsAdmin(
      "payments",
      transport(() => {
        throw new BackendUnavailable("ECONNREFUSED");
      }).transport,
    );
    await expect(down.orders({})).rejects.toBeInstanceOf(NotConnected);
    const missing = new PaymentsAdmin(
      "payments",
      transport(() => {
        throw apiError(404, "NOT_FOUND");
      }).transport,
    );
    await expect(missing.audit({})).rejects.toMatchObject({
      reason: "unreachable",
    });
    // A missing order is a missing order, not a missing service.
    await expect(missing.order("o-1")).rejects.toBeInstanceOf(BackendError);
  });

  it("parses the catalog and refuses a drifted shape", async () => {
    const ok = new PaymentsAdmin(
      "payments",
      transport(() => catalog).transport,
    );
    expect((await ok.catalog()).checkoutEnabled).toBe(false);
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const drifted = new PaymentsAdmin(
      "payments",
      transport(() => ({ products: "nope" })).transport,
    );
    await expect(drifted.catalog()).rejects.toBeInstanceOf(ContractMismatch);
    quiet.mockRestore();
  });

  it("sends a manual grant without an empty end date", async () => {
    const { transport: t, calls } = transport(() => ({}));
    await new PaymentsAdmin("payments", t).grant({
      userId: "u1",
      service: "battleship",
      feature: "premium",
      validUntil: null,
      reason: "Compensation",
    });
    expect(calls[0]?.path).toBe("/v1/admin/grants");
    expect(calls[0]?.options?.body).toEqual({
      userId: "u1",
      service: "battleship",
      feature: "premium",
      reason: "Compensation",
    });
  });

  it("offers stop renewal while Lava may still charge, also to send it again", () => {
    const stoppable = (state: string, autoRenew = true) =>
      canStopRenewal({ state, autoRenew });
    expect(stoppable("active")).toBe(true);
    expect(stoppable("past_due")).toBe(true);
    // Not confirmed by Lava yet (a failed cancel, a revoke): the retry path.
    expect(stoppable("cancel_requested")).toBe(true);
    expect(stoppable("cancel_requested", false)).toBe(false);
    expect(stoppable("cancelling", false)).toBe(false);
    expect(stoppable("expired", false)).toBe(false);
  });
});

describe("battleship adapter", () => {
  const item = {
    matchId: "m1",
    mode: "bot",
    status: "finished",
    players: { a: { userId: "u1", nickname: "SeaWolf" }, b: { bot: "hard" } },
    winner: "a",
    reason: "fleet_destroyed",
    abortReason: null,
    moves: 3,
    rated: false,
    ratingDelta: null,
    createdAt: "2026-09-29T10:00:00.000Z",
    battleStartedAt: "2026-09-29T10:01:00.000Z",
    finishedAt: "2026-09-29T10:20:00.000Z",
  };

  it("normalizes both sides of a match", async () => {
    const admin = new BattleshipAdmin(
      "battleship",
      transport(() => ({ items: [item], nextCursor: null })).transport,
    );
    const page = await admin.matches({ status: "finished" });
    expect(page.items[0]?.a).toEqual({
      kind: "human",
      userId: "u1",
      nickname: "SeaWolf",
    });
    expect(page.items[0]?.b).toEqual({ kind: "bot", level: "hard" });
  });

  it("counts shots without skipped turns in the detail", async () => {
    const admin = new BattleshipAdmin(
      "battleship",
      transport(() => ({
        ...item,
        firstTurn: "a",
        fleets: { a: [], b: null },
        moves: [
          {
            n: 1,
            side: "a",
            x: 1,
            y: 1,
            outcome: "hit",
            at: "2026-09-29T10:02:00.000Z",
          },
          {
            n: 2,
            side: "a",
            x: null,
            y: null,
            outcome: "skip",
            at: "2026-09-29T10:03:00.000Z",
          },
        ],
        live: null,
      })).transport,
    );
    const match = await admin.match("m1");
    expect(match.moves).toBe(1);
    expect(match.history).toHaveLength(2);
    expect(match.fleets.b).toBeNull();
  });

  it("is not connected without a base URL", async () => {
    await expect(
      new BattleshipAdmin("battleship", null).overview(),
    ).rejects.toBeInstanceOf(NotConnected);
  });
});
