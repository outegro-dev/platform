import {
  assistStyleSchema,
  bookAccessSchema,
  eventLoopPhaseSchema,
  explainKinds,
} from "@outegro/contracts/edu";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import ru from "./ru.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/** Top-level ICU arguments of a message: {n}, {count, plural, …} → n, count. */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (char === "{") {
      if (depth === 0) {
        const name = /^\{\s*([A-Za-z0-9_]+)/.exec(message.slice(i))?.[1];
        if (name) names.add(name);
      }
      depth++;
    } else if (char === "}") {
      depth--;
    }
  }
  return [...names].sort();
}

describe("messages", () => {
  const english = flatten(en as Tree);
  const russian = flatten(ru as Tree);

  it("EN and RU have the same keys", () => {
    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
  });

  it("every translation uses the same arguments", () => {
    const mismatched = Object.keys(english).filter(
      (key) =>
        argumentsOf(english[key] ?? "").join() !==
        argumentsOf(russian[key] ?? "").join(),
    );
    expect(mismatched).toEqual([]);
  });

  it("no message is empty", () => {
    expect(
      Object.entries({ ...english, ...russian })
        .filter(([, value]) => value.trim() === "")
        .map(([key]) => key),
    ).toEqual([]);
  });

  it("names every kind of access a reader can have", () => {
    for (const access of bookAccessSchema.options)
      for (const messages of [english, russian])
        expect(messages[`bookCard.access.${access}`], access).toBeTruthy();
  });

  it("speaks Russian plurals with all their forms", () => {
    for (const [key, value] of Object.entries(russian))
      if (value.includes("plural,"))
        for (const form of ["one", "few", "many", "other"])
          expect(value, `${key}: ${form}`).toContain(`${form} {`);
  });

  it("calls the product Education / Обучение", () => {
    expect(english["brand.product"]).toBe("Education");
    expect(russian["brand.product"]).toBe("Обучение");
    expect(english["meta.title"]).toContain("Education");
    expect(russian["meta.title"]).toContain("Обучение");
  });
});

describe("the book's own words (namespace book)", () => {
  const book = (locale: "en" | "ru") =>
    createTranslator({
      locale,
      messages: locale === "en" ? en : ru,
      namespace: "book",
    });

  it("name every explanation view and every event loop phase", () => {
    for (const locale of ["en", "ru"] as const) {
      const t = book(locale);
      for (const kind of explainKinds)
        expect(t(`explain.kinds.${kind}`), kind).not.toContain("book.");
      for (const phase of eventLoopPhaseSchema.options)
        expect(t(`simulator.phases.${phase}`), phase).not.toContain("book.");
    }
    expect(book("ru")("explain.kinds.analogy")).toBe("На пальцах");
    expect(book("ru")("explain.kinds.deep")).toBe("Под капотом");
    expect(book("en")("exercise.quiz")).toBe("Check yourself");
    expect(book("ru")("exercise.quiz")).toBe("Проверь себя");
  });

  it("count rows and cards the way each language does", () => {
    const ru = book("ru");
    expect(
      [1, 3, 5, 11, 21, 24, 112].map((count) => ru("sql.rows", { count })),
    ).toEqual([
      "1 строка",
      "3 строки",
      "5 строк",
      "11 строк",
      "21 строка",
      "24 строки",
      "112 строк",
    ]);
    expect([0, 1, 2].map((count) => book("en")("sql.rows", { count }))).toEqual(
      ["0 rows", "1 row", "2 rows"],
    );
    expect(ru("deck.allChapters", { count: 122 })).toBe(
      "Все главы · 122 карточки",
    );
    expect(ru("deck.allChapters", { count: 121 })).toBe(
      "Все главы · 121 карточка",
    );
    expect(ru("save.cardsUnsaved", { count: 2 })).toBe(
      "2 отметки не сохранены.",
    );
    expect(ru("save.cardsUnsaved", { count: 5 })).toBe(
      "5 отметок не сохранено.",
    );
  });

  it("name every way the assistant explains, and its waiting line", () => {
    for (const locale of ["en", "ru"] as const) {
      const t = book(locale);
      for (const style of assistStyleSchema.options)
        expect(t(`assist.style.${style}`), style).not.toContain("book.");
    }
    const ru = book("ru");
    expect(ru("assist.waitingExplain", { what: "проще" })).toBe(
      "Помощник пишет объяснение: проще. Обычно 5–30 секунд.",
    );
    expect(ru("assist.remaining", { left: 3, limit: 30 })).toBe(
      "Осталось 3 из 30 на сегодня",
    );
    expect(ru("assist.resetsAt", { day: "tomorrow", time: "03:00" })).toBe(
      "завтра с 03:00",
    );
    expect(book("en")("assist.resetsAt", { day: "today", time: "03:00" })).toBe(
      "from 03:00 today",
    );
    expect(ru("assist.ownWords.score", { score: 8 })).toBe(
      "Оценка понимания: 8/10",
    );
  });

  it("give a letter to every option a quiz can have", () => {
    for (const locale of ["en", "ru"] as const)
      expect(book(locale)("quiz.letters").length).toBeGreaterThanOrEqual(10);
  });
});
