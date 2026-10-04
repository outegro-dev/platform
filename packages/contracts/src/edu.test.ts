import { describe, expect, it } from "vitest";
import {
  accessRuleSchema,
  type BookDocument,
  bookDocumentSchema,
  eduFeatures,
  progressResponseSchema,
  setBookAccessSchema,
  setBookStatusSchema,
} from "./edu.js";
import { permissionsOf, platformRoles, producers } from "./index.js";

const book: BookDocument = {
  schemaVersion: 1,
  slug: "nodejs-internals",
  locale: "ru",
  title: "Node.js изнутри",
  kicker: "Книга",
  lead: ["Как устроен ", { t: "code", v: "node" }],
  cover: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
  theme: { accent: "#0E7490", accentDark: "#4FC0D8" },
  chapters: [
    {
      id: "n01",
      n: 1,
      short: "Устройство",
      kicker: "Глава 1",
      title: "Что такое Node.js",
      lead: ["Лид"],
      blocks: [
        { t: "h3", id: "n01-runtime", c: ["Runtime"] },
        { t: "p", c: ["Текст ", { t: "b", c: ["жирный"] }] },
        {
          t: "explain",
          topic: "Тема",
          views: [
            {
              kind: "analogy",
              body: [
                {
                  t: "quiz",
                  id: "n01-q-0a1b2c3d",
                  q: [{ t: "p", c: ["Вопрос внутри объяснения"] }],
                  options: [["да"], ["нет"]],
                  answer: [0],
                  why: [],
                },
              ],
            },
          ],
        },
        {
          t: "quiz",
          id: "n01-q-11111111",
          q: [{ t: "p", c: ["Вопрос?"] }],
          options: [["A"], ["B"], ["C"]],
          answer: [0, 2],
          why: [{ t: "p", c: ["Потому что"] }],
        },
        {
          t: "cards",
          cards: [{ id: "n01-c-22222222", front: ["Q"], back: ["A"] }],
        },
        { t: "eventLoop" },
      ],
    },
  ],
  deck: { kicker: "Повторение", title: "Карточки", intro: [["Все карточки"]] },
  eventLoop: {
    scenarios: [
      {
        name: "Порядок",
        code: ["console.log('A');", "setTimeout(() => console.log('B'));"],
        steps: [
          { l: 1, ph: "main", stack: ["главный модуль"], out: ["A"] },
          { l: 2, timers: ["log('B')"] },
          { ph: "timers", stack: ["log('B')"], timers: [], out: ["A", "B"] },
        ],
      },
    ],
  },
  stats: {
    chapters: 1,
    figures: 0,
    exercises: 2,
    explain: 1,
    sandboxes: 0,
    cards: 1,
  },
};

describe("edu book document", () => {
  it("accepts a well-formed book", () => {
    expect(bookDocumentSchema.parse(book)).toEqual(book);
  });

  it("rejects HTML smuggled into a figure or a link", () => {
    const withScript = structuredClone(book);
    withScript.chapters[0]?.blocks.push({
      t: "figure",
      svg: "<script>alert(1)</script>",
      caption: [],
    });
    expect(bookDocumentSchema.safeParse(withScript).success).toBe(false);

    const withLink = structuredClone(book);
    withLink.chapters[0]?.blocks.push({
      t: "p",
      c: [{ t: "a", href: "javascript:alert(1)", c: ["x"] }],
    });
    expect(bookDocumentSchema.safeParse(withLink).success).toBe(false);
  });
});

describe("edu access", () => {
  it("names one feature per book next to the library", () => {
    expect(eduFeatures.library).toBe("library");
    expect(eduFeatures.book("sql-internals")).toBe("book.sql-internals");
  });

  it("validates access rules", () => {
    expect(
      accessRuleSchema.safeParse({
        mode: "grant",
        features: ["library", "book.sql-internals"],
        previewChapters: 1,
      }).success,
    ).toBe(true);
    expect(
      accessRuleSchema.safeParse({
        mode: "grant",
        features: [],
        previewChapters: 1,
      }).success,
    ).toBe(false);
    expect(accessRuleSchema.safeParse({ mode: "public" }).success).toBe(false);
  });

  it("needs a reason and the expected version for admin commands", () => {
    expect(
      setBookStatusSchema.safeParse({
        status: "published",
        reason: "ok",
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      setBookStatusSchema.safeParse({
        status: "published",
        reason: "Готово к чтению",
        expectedVersion: 0,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      setBookAccessSchema.safeParse({
        rule: { mode: "grant", features: ["library"], previewChapters: 1 },
        reason: "Открываем по подписке",
        expectedVersion: 3,
      }).success,
    ).toBe(true);
  });

  it("keeps editing books apart from reading them", () => {
    expect([...permissionsOf(["edu_editor"])]).toEqual([
      "edu.read",
      "edu.manage",
    ]);
    expect(permissionsOf(["support"]).has("edu.read")).toBe(true);
    expect(permissionsOf(["support"]).has("edu.manage")).toBe(false);
    expect(permissionsOf(["owner"]).has("edu.manage")).toBe(true);
    expect(Object.keys(platformRoles)).toContain("edu_editor");
    expect(producers).toContain("edu");
  });
});

describe("edu progress", () => {
  it("keys understanding scores by chapter number, chapters 10+ included", () => {
    const progress = (understanding: Record<string, number>) =>
      progressResponseSchema.safeParse({
        exercises: {},
        cards: {},
        lastChapter: null,
        explainView: null,
        understanding,
      }).success;
    expect(progress({ "1": 7, "10": 9, "13": 1 })).toBe(true);
    for (const key of ["0", "01", "1a", "x", ""])
      expect(progress({ [key]: 5 }), key).toBe(false);
    expect(progress({ "2": 11 })).toBe(false);
  });
});
