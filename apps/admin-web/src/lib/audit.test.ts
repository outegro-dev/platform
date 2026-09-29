import { describe, expect, it } from "vitest";
import {
  type AuditSource,
  decodeMergeCursor,
  encodeMergeCursor,
  type Fetcher,
  type MergeCursor,
  mergePage,
  type TimelineEntry,
} from "./audit";

const minute = 60_000;
const start = Date.parse("2026-09-29T12:00:00.000Z");

function feed(source: AuditSource, minutesAgo: number[], action = "x.y") {
  return minutesAgo.map(
    (ago, index): TimelineEntry => ({
      source,
      id: `${source}-${String(index).padStart(3, "0")}`,
      actorId: null,
      action,
      targetType: "user",
      targetId: `t-${index}`,
      reason: null,
      data: {},
      createdAt: new Date(start - ago * minute).toISOString(),
    }),
  );
}

/** A feed with opaque offset cursors, like the services (newest first). */
function fetcher(entries: TimelineEntry[], calls?: number[]): Fetcher {
  return async (cursor, limit) => {
    calls?.push(limit);
    const offset = cursor ? Number(cursor) : 0;
    const items = entries.slice(offset, offset + limit);
    return {
      items,
      nextCursor:
        offset + limit < entries.length ? String(offset + limit) : null,
    };
  };
}

async function readAll(
  sources: Partial<Record<AuditSource, Fetcher>>,
  limit: number,
  matches?: (entry: TimelineEntry) => boolean,
) {
  const pages: TimelineEntry[][] = [];
  let cursor: MergeCursor = {};
  for (let guard = 0; guard < 100; guard++) {
    const page = await mergePage({ sources, cursor, limit, matches });
    pages.push(page.items);
    if (!page.next) return pages;
    cursor = decodeMergeCursor(encodeMergeCursor(page.next));
  }
  throw new Error("did not finish");
}

describe("merged audit timeline", () => {
  it("interleaves feeds newest first", async () => {
    const identity = feed("identity", [1, 5, 9]);
    const notifications = feed("notifications", [2, 3, 20]);
    const page = await mergePage({
      sources: {
        identity: fetcher(identity),
        notifications: fetcher(notifications),
      },
      cursor: {},
      limit: 4,
    });
    expect(page.items.map((entry) => entry.id)).toEqual([
      "identity-000",
      "notifications-000",
      "notifications-001",
      "identity-001",
    ]);
    expect(page.next).not.toBeNull();
  });

  it("pages through every entry exactly once and in order", async () => {
    const identity = feed(
      "identity",
      Array.from({ length: 37 }, (_, i) => i * 3),
    );
    const battleship = feed(
      "battleship",
      Array.from({ length: 23 }, (_, i) => i * 5 + 1),
    );
    const payments = feed("payments", [7, 70, 700]);
    const pages = await readAll(
      {
        identity: fetcher(identity),
        battleship: fetcher(battleship),
        payments: fetcher(payments),
      },
      10,
    );
    const all = pages.flat();
    expect(all).toHaveLength(63);
    expect(new Set(all.map((entry) => `${entry.source}${entry.id}`)).size).toBe(
      63,
    );
    const times = all.map((entry) => entry.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("keeps the order exact when a filter hides most of one feed", async () => {
    const identity = feed(
      "identity",
      Array.from({ length: 60 }, (_, i) => i),
      "role.granted",
    ).map((entry, index) =>
      index % 7 === 0 ? entry : { ...entry, action: "other" },
    );
    const notifications = feed(
      "notifications",
      Array.from({ length: 30 }, (_, i) => i * 2 + 0.5),
    );
    const matches = (entry: TimelineEntry) => entry.action !== "other";
    const all = (
      await readAll(
        { identity: fetcher(identity), notifications: fetcher(notifications) },
        5,
        matches,
      )
    ).flat();
    expect(all).toHaveLength(30 + Math.ceil(60 / 7));
    const times = all.map((entry) => entry.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("never asks a feed for more than a hundred items", async () => {
    const calls: number[] = [];
    const identity = feed(
      "identity",
      Array.from({ length: 400 }, (_, i) => i),
    );
    const notifications = feed(
      "notifications",
      Array.from({ length: 400 }, (_, i) => 1000 + i),
    );
    await readAll(
      {
        identity: fetcher(identity, calls),
        notifications: fetcher(notifications),
      },
      50,
    );
    expect(Math.max(...calls)).toBeLessThanOrEqual(100);
  });

  it("reports a failing feed, keeps the others, and resumes it later", async () => {
    const identity = feed("identity", [1, 2, 3]);
    const broken: Fetcher = async () => {
      throw new Error("down");
    };
    const page = await mergePage({
      sources: { identity: fetcher(identity), notifications: broken },
      cursor: {},
      limit: 10,
    });
    expect(page.failed).toEqual(["notifications"]);
    expect(page.items).toHaveLength(3);
    expect(page.next?.notifications).toBeUndefined();
    expect(page.next?.identity).toBe(false);
  });

  it("skips a feed that does not exist yet without calling it an outage", async () => {
    class Missing extends Error {}
    const page = await mergePage({
      sources: {
        identity: fetcher(feed("identity", [1])),
        payments: async () => {
          throw new Missing();
        },
      },
      cursor: {},
      limit: 10,
      unsupported: (error) => error instanceof Missing,
    });
    expect(page.failed).toEqual([]);
    expect(page.unsupported).toEqual(["payments"]);
    expect(page.next).toBeNull();
  });

  it("ignores a tampered cursor", () => {
    expect(decodeMergeCursor("not-base64-json")).toEqual({});
    expect(
      decodeMergeCursor(
        Buffer.from(
          JSON.stringify({ identity: { cursor: 5, skip: -1 } }),
        ).toString("base64url"),
      ),
    ).toEqual({});
  });
});
