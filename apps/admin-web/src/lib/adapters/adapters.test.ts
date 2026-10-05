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
import { EduAdmin, isEduAuditAction } from "./edu";
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

describe("education adapter", () => {
  const book = {
    slug: "sql-internals",
    title: "SQL изнутри",
    status: "published",
    rule: {
      mode: "grant",
      features: ["library", "book.sql-internals"],
      previewChapters: 1,
    },
    contentVersion: 3,
    contentHash: "9f2c4b1d",
    stats: {
      chapters: 13,
      figures: 71,
      exercises: 120,
      explain: 66,
      sandboxes: 102,
      cards: 121,
    },
    readers: 12,
    importedAt: "2026-09-20T10:00:00.000Z",
    publishedAt: "2026-09-21T10:00:00.000Z",
    updatedAt: "2026-09-21T10:00:00.000Z",
    version: 4,
  };
  const education = (answer: Parameters<typeof transport>[0]) => {
    const { transport: t, calls } = transport(answer);
    return { admin: new EduAdmin("education", t), calls };
  };

  it("is not connected without a base URL", async () => {
    const admin = new EduAdmin("education", null);
    expect(admin.configured).toBe(false);
    await expect(admin.books()).rejects.toMatchObject({
      reason: "unconfigured",
    });
  });

  it("reads 'does not answer' as not connected; a reader without books is not an outage", async () => {
    const down = education(() => {
      throw new BackendUnavailable("ECONNREFUSED");
    }).admin;
    await expect(down.overview()).rejects.toBeInstanceOf(NotConnected);
    const missing = education(() => {
      throw apiError(404, "NOT_FOUND");
    }).admin;
    // An older build without the admin API answers 404 to its lists…
    await expect(missing.readers({})).rejects.toMatchObject({
      reason: "unreachable",
    });
    // …while a user who never read anything is a plain 404 ("not found").
    await expect(missing.reader("u-1")).rejects.toBeInstanceOf(BackendError);
    await expect(missing.book("nope")).rejects.toBeInstanceOf(BackendError);
  });

  it("parses books with the contract and refuses a drifted shape", async () => {
    const { admin, calls } = education(() => ({ items: [book] }));
    const books = await admin.books();
    expect(books[0]?.rule).toEqual(book.rule);
    expect(calls[0]?.path).toBe("/v1/admin/books");
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const drifted = education(() => ({
      items: [{ ...book, status: "hidden" }],
    })).admin;
    await expect(drifted.books()).rejects.toBeInstanceOf(ContractMismatch);
    quiet.mockRestore();
  });

  it("reads the overview with the AI assistant's week, and nothing less", async () => {
    const overview = {
      books: { published: 2, draft: 0, archived: 0 },
      readers: { total: 15, active7d: 9 },
      grants: { inForce: 5 },
      exercisesSolved7d: 70,
      activity: [{ day: "2026-10-04", readers: 6 }],
      assist: {
        enabled: true,
        dailyLimit: 30,
        globalDailyLimit: 500,
        globalUsedToday: 37,
        requests7d: 1284,
        cached7d: 321,
        failed7d: 13,
        tokensIn7d: 2486910,
        tokensOut7d: 612304,
      },
    };
    const { admin, calls } = education(() => overview);
    expect((await admin.overview()).assist).toEqual(overview.assist);
    expect(calls[0]?.path).toBe("/v1/admin/overview");
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    // A build without the assistant's numbers is a drift, not zeros.
    const { assist: _assist, ...older } = overview;
    await expect(
      education(() => older).admin.overview(),
    ).rejects.toBeInstanceOf(ContractMismatch);
    // So is one without the spending cap: never "no cap" by omission.
    const {
      globalDailyLimit: _limit,
      globalUsedToday: _used,
      ...uncapped
    } = overview.assist;
    await expect(
      education(() => ({ ...overview, assist: uncapped })).admin.overview(),
    ).rejects.toBeInstanceOf(ContractMismatch);
    quiet.mockRestore();
  });

  it("filters readers in the query string", async () => {
    const { admin, calls } = education(() => ({ items: [], nextCursor: null }));
    await admin.readers({ book: "sql-internals", limit: 10 });
    expect(calls[0]?.path).toBe(
      "/v1/admin/readers?book=sql-internals&limit=10",
    );
  });

  it("renames the audit time and keeps imports without an actor", async () => {
    const { admin, calls } = education(() => ({
      items: [
        {
          id: "0b5d6c1e-8f3a-4c2b-9d1e-2f3a4b5c6d7e",
          actorId: null,
          action: "book.imported",
          targetType: "book",
          targetId: "sql-internals",
          reason: null,
          data: { contentVersion: 3, contentHash: "9f2c4b1d" },
          at: "2026-09-20T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    }));
    const page = await admin.audit({ targetId: "sql-internals", limit: 5 });
    expect(page.items[0]).toEqual({
      id: "0b5d6c1e-8f3a-4c2b-9d1e-2f3a4b5c6d7e",
      actorId: null,
      action: "book.imported",
      targetType: "book",
      targetId: "sql-internals",
      reason: null,
      data: { contentVersion: 3, contentHash: "9f2c4b1d" },
      createdAt: "2026-09-20T10:00:00.000Z",
    });
    expect(calls[0]?.path).toBe(
      "/v1/admin/audit?targetId=sql-internals&limit=5",
    );
  });

  describe("an audit action newer than the contract", () => {
    const entry = {
      id: "0b5d6c1e-8f3a-4c2b-9d1e-2f3a4b5c6d7e",
      actorId: "5b449591-0000-4000-8000-000000000000",
      action: "book.cover.changed",
      targetType: "book",
      targetId: "sql-internals",
      reason: "New cover for the launch",
      data: { before: { cover: "v1" }, after: { cover: "v2" } },
      at: "2026-09-21T10:00:00.000Z",
    };
    const imported = {
      id: "1c6e7d2f-9a4b-4d3c-8e2f-3a4b5c6d7e8f",
      actorId: null,
      action: "book.imported",
      targetType: "book",
      targetId: "sql-internals",
      reason: null,
      data: { contentVersion: 3, contentHash: "9f2c4b1d" },
      at: "2026-09-20T10:00:00.000Z",
    };

    it("is still an entry, next to the known ones, and the feed reads on", async () => {
      const { admin } = education(() => ({
        items: [entry, imported],
        nextCursor: "next-page",
      }));
      const page = await admin.audit({});
      expect(page.nextCursor).toBe("next-page");
      expect(page.items.map((item) => item.action)).toEqual([
        "book.cover.changed",
        "book.imported",
      ]);
      expect(page.items[0]).toMatchObject({
        reason: "New cover for the launch",
        createdAt: "2026-09-21T10:00:00.000Z",
      });
      // The feed names the contract's actions and shows any other by its code.
      expect(page.items.map((item) => isEduAuditAction(item.action))).toEqual([
        false,
        true,
      ]);
    });

    it("may target something other than a book", async () => {
      const { admin } = education(() => ({
        items: [{ ...entry, targetType: "settings", targetId: "assist" }],
        nextCursor: null,
      }));
      expect((await admin.audit({})).items[0]).toMatchObject({
        targetType: "settings",
        targetId: "assist",
      });
    });

    it("refuses an entry that drifted otherwise", async () => {
      const quiet = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      for (const drifted of [
        { ...entry, action: "" },
        { ...entry, id: "not-a-uuid" },
        { ...entry, data: "before and after" },
        { ...entry, at: undefined },
      ])
        await expect(
          education(() => ({ items: [drifted], nextCursor: null })).admin.audit(
            {},
          ),
        ).rejects.toBeInstanceOf(ContractMismatch);
      quiet.mockRestore();
    });
  });

  it("sends commands with the expected version, never an actor", async () => {
    const { admin, calls } = education(() => ({}));
    await admin.setStatus("sql-internals", {
      status: "draft",
      expectedVersion: 4,
      reason: "Chapter 9 is being rewritten",
    });
    await admin.setAccess("sql-internals", {
      rule: { mode: "signed_in" },
      expectedVersion: 5,
      reason: "Open for the launch week",
    });
    expect(calls[0]?.path).toBe("/v1/admin/books/sql-internals/status");
    expect(calls[0]?.options?.method).toBe("POST");
    expect(calls[0]?.options?.accessToken).toBe("token-123");
    expect(calls[0]?.options?.body).toEqual({
      status: "draft",
      expectedVersion: 4,
      reason: "Chapter 9 is being rewritten",
    });
    expect(calls[1]?.path).toBe("/v1/admin/books/sql-internals/access");
    expect(calls[1]?.options?.body).toEqual({
      rule: { mode: "signed_in" },
      expectedVersion: 5,
      reason: "Open for the launch week",
    });
  });
});
