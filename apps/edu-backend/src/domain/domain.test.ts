import type {
  AccessRule,
  BookAccess,
  BookStatus,
  ChapterAccess,
} from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import {
  chapterRow,
  findExercise,
  usesEventLoop,
  usesSandbox,
} from "../content/outline.js";
import {
  drillIds,
  drillSolution,
  sampleBook,
  sampleIds,
} from "../test/fixtures.js";
import {
  BookPolicy,
  type GrantRecord,
  grantInForce,
  isReadable,
  RULE_MODES,
  Viewer,
} from "./access.js";
import { BookCommands, CommandRefused, sameRule } from "./book-commands.js";
import { lastDays, utcDay } from "./calendar.js";
import { attemptFingerprint, recordAnswer, retryOf } from "./progress.js";

const NOW = new Date("2026-09-29T10:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const USER = "00000000-0000-4000-8000-00000000000a";

const grant = (overrides: Partial<GrantRecord> = {}): GrantRecord => ({
  feature: "library",
  state: "active",
  validFrom: at(-60_000),
  validUntil: null,
  ...overrides,
});

describe("grant in force (TC-EDU-03)", () => {
  it("is active inside the half-open interval [validFrom, validUntil)", () => {
    expect(grantInForce(grant({ validFrom: NOW }), NOW)).toBe(true);
    expect(grantInForce(grant({ validFrom: at(1) }), NOW)).toBe(false);
    expect(grantInForce(grant({ validUntil: NOW }), NOW)).toBe(false);
    expect(grantInForce(grant({ validUntil: at(1) }), NOW)).toBe(true);
    expect(grantInForce(grant({ validUntil: at(-1) }), NOW)).toBe(false);
  });

  it("without validUntil is perpetual", () => {
    expect(
      grantInForce(grant({ validUntil: null }), at(10 * 365 * 86_400_000)),
    ).toBe(true);
  });

  it("revoked and expired grants are never in force", () => {
    expect(grantInForce(grant({ state: "revoked" }), NOW)).toBe(false);
    expect(grantInForce(grant({ state: "expired" }), NOW)).toBe(false);
  });
});

describe("viewer", () => {
  const of = (roles: string[], grants: GrantRecord[] = []) =>
    Viewer.of({ userId: USER, roles, grants, now: NOW });

  it("is staff through edu.read only", () => {
    expect(of(["support"]).staff).toBe(true);
    expect(of(["edu_editor"]).staff).toBe(true);
    expect(of(["owner"]).staff).toBe(true);
    for (const roles of [[], ["billing_operator"], ["auditor"], ["pro"]])
      expect(of(roles).staff).toBe(false);
  });

  it("never becomes staff through a grant (INV-08)", () => {
    const paid = of([], [grant({ feature: "edu.read" }), grant()]);
    expect(paid.staff).toBe(false);
    expect(paid.holdsAny(["library"])).toBe(true);
  });

  it("holds only the features of grants in force", () => {
    const viewer = of(
      [],
      [
        grant({ feature: "book.a", validUntil: NOW }),
        grant({ feature: "book.b", state: "revoked" }),
        grant({ feature: "book.c", validFrom: at(1) }),
        grant({ feature: "book.d" }),
      ],
    );
    expect([...viewer.features]).toEqual(["book.d"]);
    expect(viewer.signedIn).toBe(true);
    expect(Viewer.anonymous().signedIn).toBe(false);
    expect(Viewer.anonymous().userId).toBeNull();
  });
});

describe("book access (TC-EDU-01, TC-EDU-02)", () => {
  const rules: Record<string, AccessRule> = {
    free: { mode: "free" },
    signedIn: { mode: "signed_in" },
    paid: {
      mode: "grant",
      features: ["library", "book.x"],
      previewChapters: 2,
    },
    paidNoPreview: { mode: "grant", features: ["book.x"], previewChapters: 0 },
  };
  const viewers: Record<string, Viewer> = {
    anonymous: Viewer.anonymous(),
    reader: Viewer.of({ userId: USER, roles: [], grants: [], now: NOW }),
    granted: Viewer.of({
      userId: USER,
      roles: [],
      grants: [grant({ feature: "book.x" })],
      now: NOW,
    }),
    otherBook: Viewer.of({
      userId: USER,
      roles: [],
      grants: [grant({ feature: "book.y" })],
      now: NOW,
    }),
    lapsed: Viewer.of({
      userId: USER,
      roles: [],
      grants: [grant({ feature: "book.x", validUntil: NOW })],
      now: NOW,
    }),
    staff: Viewer.of({
      userId: USER,
      roles: ["support"],
      grants: [],
      now: NOW,
    }),
  };

  /** [rule, viewer] → access to chapters 1, 2, 3 and to the book. */
  const matrix: [
    keyof typeof rules,
    keyof typeof viewers,
    [ChapterAccess, ChapterAccess, ChapterAccess],
    BookAccess,
  ][] = [
    ["free", "anonymous", ["open", "open", "open"], "open"],
    ["free", "reader", ["open", "open", "open"], "open"],
    ["free", "staff", ["staff", "staff", "staff"], "staff"],
    ["signedIn", "anonymous", ["sign_in", "sign_in", "sign_in"], "sign_in"],
    ["signedIn", "reader", ["open", "open", "open"], "open"],
    ["signedIn", "staff", ["staff", "staff", "staff"], "staff"],
    ["paid", "anonymous", ["sign_in", "sign_in", "sign_in"], "sign_in"],
    ["paid", "reader", ["preview", "preview", "locked"], "preview"],
    ["paid", "granted", ["granted", "granted", "granted"], "granted"],
    ["paid", "otherBook", ["preview", "preview", "locked"], "preview"],
    ["paid", "lapsed", ["preview", "preview", "locked"], "preview"],
    ["paid", "staff", ["staff", "staff", "staff"], "staff"],
    [
      "paidNoPreview",
      "anonymous",
      ["sign_in", "sign_in", "sign_in"],
      "sign_in",
    ],
    ["paidNoPreview", "reader", ["locked", "locked", "locked"], "locked"],
    ["paidNoPreview", "granted", ["granted", "granted", "granted"], "granted"],
    ["paidNoPreview", "staff", ["staff", "staff", "staff"], "staff"],
  ];

  it("follows the rule for every viewer and chapter of a published book", () => {
    for (const [rule, viewer, chapters, book] of matrix) {
      const policy = new BookPolicy("published", rules[rule] as AccessRule);
      const who = viewers[viewer] as Viewer;
      expect({
        rule,
        viewer,
        chapters: [1, 2, 3].map((n) => policy.chapter(who, n)),
        book: policy.book(who),
      }).toEqual({ rule, viewer, chapters, book });
    }
  });

  it("hides drafts and archived books from everyone but staff, whatever the rule", () => {
    const statuses: BookStatus[] = ["draft", "published", "archived"];
    for (const status of statuses)
      for (const rule of Object.values(rules))
        for (const [name, viewer] of Object.entries(viewers)) {
          const policy = new BookPolicy(status, rule);
          expect({ status, name, visible: policy.visibleTo(viewer) }).toEqual({
            status,
            name,
            visible: name === "staff" || status === "published",
          });
          if (name === "staff") expect(policy.chapter(viewer, 7)).toBe("staff");
        }
  });

  it("reads open, preview, granted and staff; never sign_in or locked", () => {
    expect(
      (
        ["open", "preview", "granted", "staff", "sign_in", "locked"] as const
      ).map(isReadable),
    ).toEqual([true, true, true, true, false, false]);
  });

  it("names the features and preview of paid books only", () => {
    const paid = new BookPolicy("published", rules.paid as AccessRule);
    expect([paid.features, paid.previewChapters]).toEqual([
      ["library", "book.x"],
      2,
    ]);
    const free = new BookPolicy("published", rules.free as AccessRule);
    expect([free.features, free.previewChapters]).toEqual([[], 0]);
  });

  it("tells the console how a reader with these features reads the book", () => {
    const paid = new BookPolicy("published", rules.paid as AccessRule);
    expect(paid.readerAccess(new Set(["library"]))).toBe("granted");
    expect(paid.readerAccess(new Set(["book.y"]))).toBe("preview");
    const closed = new BookPolicy("draft", rules.paidNoPreview as AccessRule);
    expect(closed.readerAccess(new Set())).toBe("locked");
    const open = new BookPolicy("published", rules.signedIn as AccessRule);
    expect(open.readerAccess(new Set())).toBe("open");
  });
});

describe("exercise answers (TC-EDU-05)", () => {
  it("count every attempt, keep the first solve, and stay solved", () => {
    const first = recordAnswer(null, false, at(0));
    expect(first).toEqual({ solved: false, attempts: 1, firstSolvedAt: null });
    const second = recordAnswer(first, true, at(1_000));
    expect(second).toEqual({
      solved: true,
      attempts: 2,
      firstSolvedAt: at(1_000),
    });
    const third = recordAnswer(second, false, at(2_000));
    expect(third).toEqual({
      solved: true,
      attempts: 3,
      firstSolvedAt: at(1_000),
    });
    expect(recordAnswer(third, true, at(3_000)).firstSolvedAt).toEqual(
      at(1_000),
    );
    expect(recordAnswer(null, true, at(0))).toEqual({
      solved: true,
      attempts: 1,
      firstSolvedAt: at(0),
    });
  });
});

describe("chapter outline", () => {
  it("derives sections, items and the sandbox and simulator flags", () => {
    const book = sampleBook("sample", { chapters: 3 });
    const [one, two, three] = book.chapters.map(chapterRow);
    expect(one).toMatchObject({
      n: 1,
      key: "t01",
      // The engine's sections: the ones the assistant explains.
      sections: [{ id: "t01-intro", title: "Intro `x`" }],
      exerciseIds: [sampleIds.exercise(1)],
      cardIds: [sampleIds.card(1)],
      cards: [{ id: sampleIds.card(1), front: ["Q"], back: ["A"] }],
      // The query sits inside a note.
      usesSandbox: true,
      usesEventLoop: false,
    });
    expect(two).toMatchObject({ usesSandbox: false, usesEventLoop: true });
    expect(three).toMatchObject({ usesSandbox: false, usesEventLoop: false });
    expect(usesSandbox([{ t: "schema" }])).toBe(true);
    expect(
      usesSandbox([
        {
          t: "sqlTask",
          id: "t01-t-00000001",
          q: [],
          hint: null,
          solution: "select 1",
          ordered: false,
          expected: { columns: 1, rows: 1, fingerprint: "0123456789abcdef" },
        },
      ]),
    ).toBe(true);
    expect(
      usesEventLoop([
        {
          t: "explain",
          topic: "Loop",
          views: [{ kind: "steps", body: [{ t: "eventLoop" }] }],
        },
      ]),
    ).toBe(true);
  });
});

describe("finding an exercise in a chapter", () => {
  it("walks nested blocks and knows only exercises", () => {
    const [chapter] = sampleBook("sample", { drills: true }).chapters;
    const blocks = chapter?.blocks ?? [];
    expect(findExercise(blocks, drillIds.sql)).toMatchObject({
      t: "sqlTask",
      solution: drillSolution,
    });
    expect(findExercise(blocks, sampleIds.exercise(1))?.t).toBe("quiz");
    expect(
      findExercise(
        [{ t: "note", tone: "tip", title: "x", body: blocks }],
        drillIds.order,
      )?.t,
    ).toBe("order");
    // A card id is not an exercise; nor is an id the chapter does not have.
    expect(findExercise(blocks, sampleIds.card(1))).toBeNull();
    expect(findExercise(blocks, "t01-q-ffffffff")).toBeNull();
  });
});

describe("retries (TC-EDU-09)", () => {
  it("replay the same body under the last key, refuse another, start anew otherwise", () => {
    const last = { key: "k1", body: "a" };
    expect(retryOf(last, "k1", "a")).toBe("replay");
    expect(retryOf(last, "k1", "b")).toBe("conflict");
    expect(retryOf(last, "k2", "a")).toBe("new");
    expect(retryOf(last, null, "a")).toBe("new");
    expect(retryOf(null, "k1", "a")).toBe("new");
    expect(retryOf({ key: null, body: "a" }, "k1", "a")).toBe("new");
  });

  it("fingerprint an attempt by what it says", () => {
    const a = attemptFingerprint({ kind: "quiz", selected: [0, 2] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(attemptFingerprint({ kind: "quiz", selected: [0, 2] })).toBe(a);
    expect(attemptFingerprint({ kind: "quiz", selected: [2, 0] })).not.toBe(a);
    expect(attemptFingerprint({ kind: "order", order: [0, 2] })).not.toBe(a);
  });
});

describe("book commands (TC-EDU-06)", () => {
  const commands = new BookCommands();
  const paid: AccessRule = {
    mode: "grant",
    features: ["library"],
    previewChapters: 1,
  };

  it("change the status, stamping the first publication", () => {
    expect(commands.setStatus({ status: "draft" }, "published", NOW)).toEqual({
      action: "book.status.changed",
      set: { status: "published", publishedAt: NOW },
      data: { before: { status: "draft" }, after: { status: "published" } },
    });
    expect(
      commands.setStatus({ status: "published" }, "archived", NOW).set,
    ).toEqual({ status: "archived" });
  });

  it("change the rule within the chapters the book has", () => {
    expect(commands.setAccess({ rule: paid }, { mode: "free" }, 3)).toEqual({
      action: "book.access.changed",
      set: { rule: { mode: "free" } },
      data: { before: { rule: paid }, after: { rule: { mode: "free" } } },
    });
    expect(
      commands.setAccess(
        { rule: { mode: "free" } },
        { ...paid, previewChapters: 3 },
        3,
      ).set.rule,
    ).toEqual({ ...paid, previewChapters: 3 });
  });

  it("refuse what changes nothing or previews more than the book", () => {
    const refusal = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        if (error instanceof CommandRefused) return [error.field, error.reason];
        throw error;
      }
      return null;
    };
    expect(
      refusal(() => commands.setStatus({ status: "draft" }, "draft", NOW)),
    ).toEqual(["status", "unchanged"]);
    // The same rule written in another key order is the same rule.
    expect(
      refusal(() =>
        commands.setAccess(
          { rule: paid },
          { previewChapters: 1, features: ["library"], mode: "grant" },
          3,
        ),
      ),
    ).toEqual(["rule", "unchanged"]);
    expect(
      refusal(() =>
        commands.setAccess(
          { rule: { mode: "free" } },
          { ...paid, previewChapters: 4 },
          3,
        ),
      ),
    ).toEqual(["rule.previewChapters", "more than the chapters"]);
  });

  it("take the same features in another order for the same rule: no new version, no audit row", () => {
    const both: AccessRule = {
      mode: "grant",
      features: ["library", "book.x"],
      previewChapters: 1,
    };
    for (const rule of [
      { ...both, features: ["book.x", "library"] },
      { ...both, features: ["book.x", "library", "book.x"] },
    ])
      expect(() => commands.setAccess({ rule: both }, rule, 3)).toThrow(
        "rule: unchanged",
      );
    // Another feature, preview or mode is a change.
    for (const rule of [
      { ...both, features: ["library"] },
      { ...both, features: ["library", "book.y"] },
      { ...both, previewChapters: 2 },
      { mode: "signed_in" as const },
    ])
      expect(commands.setAccess({ rule: both }, rule, 3).set.rule).toEqual(
        rule,
      );
    expect(sameRule({ mode: "free" }, { mode: "free" })).toBe(true);
    expect(sameRule({ mode: "free" }, { mode: "signed_in" })).toBe(false);
    expect(sameRule({ mode: "free" }, both)).toBe(false);
  });
});

describe("access-rule modes", () => {
  it("have a strategy for every mode of the contract", () => {
    expect(Object.keys(RULE_MODES).sort()).toEqual(
      ["free", "grant", "signed_in"].sort(),
    );
  });
});

describe("calendar", () => {
  it("names UTC days and lists the last ones oldest first", () => {
    expect(utcDay(new Date("2026-10-01T23:59:59.999Z"))).toBe("2026-10-01");
    const days = lastDays(new Date("2026-10-02T00:30:00.000Z"), 14);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-09-19");
    expect(days.at(-1)).toBe("2026-10-02");
    expect(new Set(days).size).toBe(14);
  });
});
