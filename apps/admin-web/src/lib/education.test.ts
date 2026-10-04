import { accessRuleSchema } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import {
  assistCap,
  assistShares,
  assistState,
  bookChangeOf,
  bookOfFeature,
  bookTarget,
  knownBook,
  libraryTarget,
  presetFeatures,
  presetOf,
  ruleOf,
  withEducationTargets,
} from "./education";

describe("access rules in the console", () => {
  it("maps each preset to the features Payments grants", () => {
    expect(presetFeatures("either", "sql-internals")).toEqual([
      "library",
      "book.sql-internals",
    ]);
    expect(presetFeatures("library", "sql-internals")).toEqual(["library"]);
    expect(presetFeatures("book", "sql-internals")).toEqual([
      "book.sql-internals",
    ]);
  });

  it("recognises a rule's preset in any order, and nothing else", () => {
    expect(presetOf(["book.sql-internals", "library"], "sql-internals")).toBe(
      "either",
    );
    expect(presetOf(["library"], "sql-internals")).toBe("library");
    // Another book's feature is not "this book".
    expect(presetOf(["book.nodejs-internals"], "sql-internals")).toBeNull();
    expect(presetOf(["premium"], "sql-internals")).toBeNull();
  });

  it("builds a rule the contract accepts from single-value fields", () => {
    const paid = ruleOf({
      slug: "nodejs-internals",
      mode: "grant",
      features: "library",
      previewChapters: 2,
    });
    expect(paid).toEqual({
      mode: "grant",
      features: ["library"],
      previewChapters: 2,
    });
    expect(accessRuleSchema.safeParse(paid).success).toBe(true);
    // Free and signed-in rules carry nothing else, whatever the form sent.
    expect(
      ruleOf({
        slug: "nodejs-internals",
        mode: "free",
        features: "book",
        previewChapters: 3,
      }),
    ).toEqual({ mode: "free" });
    expect(ruleOf({ slug: "nodejs-internals", mode: "signed_in" })).toEqual({
      mode: "signed_in",
    });
    // A paid rule needs its features.
    expect(ruleOf({ slug: "nodejs-internals", mode: "grant" })).toBeNull();
  });
});

describe("the book filter of a list page", () => {
  const listed = {
    ok: true as const,
    data: [{ slug: "nodejs-internals" }, { slug: "sql-internals" }],
  };
  const unreadable = {
    ok: false as const,
    kind: "unavailable" as const,
    requestId: null,
  };

  it("keeps a book the list knows and drops any other", () => {
    expect(knownBook("sql-internals", listed)).toBe("sql-internals");
    expect(knownBook("go-internals", listed)).toBeUndefined();
    expect(knownBook(undefined, listed)).toBeUndefined();
  });

  it("keeps a well-formed slug while the list cannot be read, nothing else", () => {
    expect(knownBook("go-internals", unreadable)).toBe("go-internals");
    expect(knownBook("../users", unreadable)).toBeUndefined();
    expect(knownBook("SQL", unreadable)).toBeUndefined();
  });
});

describe("before and after of an audited change", () => {
  const paid = {
    mode: "grant" as const,
    features: ["library", "book.sql-internals"],
    previewChapters: 1,
  };

  it("reads a status change as edu-backend records it", () => {
    expect(
      bookChangeOf({
        action: "book.status.changed",
        data: { before: { status: "published" }, after: { status: "draft" } },
      }),
    ).toEqual({ kind: "status", before: "published", after: "draft" });
  });

  it("reads an access change as edu-backend records it", () => {
    expect(
      bookChangeOf({
        action: "book.access.changed",
        data: { before: { rule: paid }, after: { rule: { mode: "free" } } },
      }),
    ).toEqual({ kind: "rule", before: paid, after: { mode: "free" } });
  });

  it("has nothing to show for an import or another action", () => {
    expect(
      bookChangeOf({
        action: "book.imported",
        data: { contentVersion: 3, contentHash: "9f2c4b1d" },
      }),
    ).toBeNull();
    expect(
      bookChangeOf({
        action: "book.cover.changed",
        data: { before: { status: "draft" }, after: { status: "published" } },
      }),
    ).toBeNull();
  });

  it("shows nothing rather than half a change or a value it cannot name", () => {
    for (const data of [
      {},
      { after: { status: "draft" } },
      { before: { status: "published" } },
      { before: { status: "published" }, after: { status: "hidden" } },
      // The other change's shape under this action.
      { before: { rule: paid }, after: { rule: { mode: "free" } } },
    ])
      expect(bookChangeOf({ action: "book.status.changed", data })).toBeNull();
    for (const data of [
      { before: paid, after: { mode: "free" } },
      { before: { rule: paid }, after: { rule: { mode: "everyone" } } },
    ])
      expect(bookChangeOf({ action: "book.access.changed", data })).toBeNull();
  });
});

describe("the AI assistant's week", () => {
  it("shares cached and failed requests out of all of them", () => {
    expect(
      assistShares({ requests7d: 1284, cached7d: 321, failed7d: 13 }),
    ).toEqual({ cached: 0.25, failed: 13 / 1284 });
  });

  it("has no shares without requests (never a division by zero)", () => {
    expect(assistShares({ requests7d: 0, cached7d: 0, failed7d: 0 })).toEqual({
      cached: null,
      failed: null,
    });
  });
});

describe("the AI assistant today", () => {
  const on = { enabled: true, globalDailyLimit: 500, globalUsedToday: 37 };

  it("counts today's model calls against the spending cap", () => {
    expect(assistCap(on)).toEqual({ used: 37, limit: 500, reached: false });
    expect(assistCap({ ...on, globalUsedToday: 499 })?.reached).toBe(false);
    expect(assistCap({ ...on, globalUsedToday: 500 })).toEqual({
      used: 500,
      limit: 500,
      reached: true,
    });
  });

  it("stays reached when the cap is lowered below what was already spent", () => {
    expect(assistCap({ globalDailyLimit: 300, globalUsedToday: 420 })).toEqual({
      used: 420,
      limit: 300,
      reached: true,
    });
  });

  it("has no cap at 0, however many calls were made", () => {
    expect(assistCap({ globalDailyLimit: 0, globalUsedToday: 0 })).toBeNull();
    expect(
      assistCap({ globalDailyLimit: 0, globalUsedToday: 12_000 }),
    ).toBeNull();
  });

  it("is on below the cap or without one, paused at it, off whatever the cap", () => {
    expect(assistState(on)).toBe("on");
    expect(
      assistState({ ...on, globalDailyLimit: 0, globalUsedToday: 900 }),
    ).toBe("on");
    expect(assistState({ ...on, globalUsedToday: 500 })).toBe("paused");
    expect(
      assistState({ ...on, globalDailyLimit: 300, globalUsedToday: 420 }),
    ).toBe("paused");
    // Off hides it from readers: there is no answer left to pause.
    expect(assistState({ ...on, enabled: false })).toBe("off");
    expect(assistState({ ...on, enabled: false, globalUsedToday: 500 })).toBe(
      "off",
    );
  });
});

describe("features", () => {
  it("names the book a feature opens", () => {
    expect(bookOfFeature("book.sql-internals")).toBe("sql-internals");
    expect(bookOfFeature("library")).toBeNull();
    expect(bookOfFeature("book.")).toBeNull();
  });
});

describe("manual grant targets", () => {
  const names = {
    library: "Education — every book",
    book: (title: string) => `Education — ${title}`,
  };
  const catalog = [["battleship:premium", "Battleship Premium"]] as const;
  const books = [
    { slug: "nodejs-internals", title: "Node.js изнутри" },
    { slug: "sql-internals", title: "SQL изнутри" },
  ];

  it("adds the library and every book after the catalog", () => {
    expect(withEducationTargets(catalog, books, names)).toEqual([
      ["battleship:premium", "Battleship Premium"],
      ["edu:library", "Education — every book"],
      ["edu:book.nodejs-internals", "Education — Node.js изнутри"],
      ["edu:book.sql-internals", "Education — SQL изнутри"],
    ]);
    expect(libraryTarget).toBe("edu:library");
    expect(bookTarget("sql-internals")).toBe("edu:book.sql-internals");
  });

  it("offers only the catalog without the book list", () => {
    expect(withEducationTargets(catalog, null, names)).toEqual([
      ["battleship:premium", "Battleship Premium"],
    ]);
  });

  it("never lists a target twice once the catalog sells it", () => {
    const targets = withEducationTargets(
      [...catalog, ["edu:library", "Library pass"]],
      books,
      names,
    );
    expect(targets.filter(([value]) => value === "edu:library")).toEqual([
      ["edu:library", "Library pass"],
    ]);
    expect(targets).toHaveLength(4);
  });
});
