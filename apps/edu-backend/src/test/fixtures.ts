import {
  type AccessRule,
  type Block,
  type BookDocument,
  type BookStatus,
  bookDocumentSchema,
  type Chapter,
  type ExerciseAttempt,
} from "@outegro/contracts/edu";
import {
  type ExerciseBlock,
  expectationOf,
  type SqlResult,
} from "@outegro/edu-engine";
import { and, arrayContains, eq } from "drizzle-orm";
import type { Executor } from "../common/database.js";
import { chapterRow, findExercise, metaOf } from "../content/outline.js";
import { books, chapters } from "../db/schema.js";

const pad = (n: number) => String(n).padStart(2, "0");

/** Ids of the sample book's items: they follow the contract's id format. */
export const sampleIds = {
  exercise: (n: number) => `t${pad(n)}-q-0000000${n % 10}`,
  card: (n: number) => `t${pad(n)}-c-0000000${n % 10}`,
};

/** Exercises the drill book adds to chapter 1, one of every kind. */
export const drillIds = {
  multi: "t01-q-0000000b",
  order: "t01-o-0000000c",
  sort: "t01-s-0000000d",
  sql: "t01-t-0000000e",
} as const;

/**
 * The drill book's SQL task: the result its solution gives on the seed,
 * written out by hand (the server never runs SQL; the book stores this
 * result's fingerprint). Order matters in this task.
 */
export const drillSolutionResult: SqlResult = {
  columns: ["id", "total"],
  values: [
    [1, 10.5],
    [2, null],
    [3, 7.25],
  ],
};
export const drillSolution = "SELECT id, total FROM orders ORDER BY id";

const drills: Block[] = [
  { t: "h3", id: "t01-drills", c: ["Drills"] },
  {
    t: "quiz",
    id: drillIds.multi,
    q: [{ t: "p", c: ["Pick both right ones"] }],
    options: [["right"], ["wrong"], ["also right"]],
    answer: [0, 2],
    why: [],
  },
  {
    t: "order",
    id: drillIds.order,
    q: [{ t: "p", c: ["Put in order"] }],
    items: [["first"], ["second"], ["third"]],
    why: [],
  },
  {
    t: "sort",
    id: drillIds.sort,
    q: [{ t: "p", c: ["Sort out"] }],
    buckets: [
      { key: "v8", c: ["V8"] },
      { key: "uv", c: ["libuv"] },
    ],
    items: [
      { key: "v8", c: ["GC"] },
      { key: "uv", c: ["epoll"] },
      { key: "v8", c: ["JIT"] },
    ],
    why: [],
  },
  {
    t: "sqlTask",
    id: drillIds.sql,
    q: [{ t: "p", c: ["List the orders by id with their totals."] }],
    hint: ["Use ", { t: "code", v: "ORDER BY" }],
    solution: drillSolution,
    ordered: true,
    expected: expectationOf(drillSolutionResult, true),
  },
];

/**
 * A small valid book: every chapter has a section, a quiz and a card;
 * chapter 1 runs a query in the SQL sandbox (nested in a note) and chapter
 * 2 shows the event loop simulator. With `drills`, chapter 1 also has a
 * multiple-choice quiz, an order, a sort and an SQL task (drillIds).
 */
export function sampleBook(
  slug: string,
  options: { chapters?: number; preface?: boolean; drills?: boolean } = {},
): BookDocument {
  const count = options.chapters ?? 3;
  const chapterOf = (n: number): Chapter => ({
    id: `t${pad(n)}`,
    n,
    short: `Short ${n}`,
    kicker: `Chapter ${n}`,
    title: `Chapter ${n} title`,
    lead: ["Lead"],
    blocks: [
      { t: "h3", id: `t${pad(n)}-intro`, c: ["Intro ", { t: "code", v: "x" }] },
      { t: "p", c: ["Text"] },
      ...(n === 1
        ? [
            {
              t: "note" as const,
              tone: "tip" as const,
              title: "Try it",
              body: [{ t: "sqlPlay" as const, sql: "select 1" }],
            },
          ]
        : []),
      ...(n === 2 ? [{ t: "eventLoop" as const }] : []),
      {
        t: "quiz",
        id: sampleIds.exercise(n),
        q: [{ t: "p", c: ["Question?"] }],
        options: [["yes"], ["no"]],
        answer: [0],
        why: [],
      },
      {
        t: "cards",
        cards: [{ id: sampleIds.card(n), front: ["Q"], back: ["A"] }],
      },
      ...(n === 1 && options.drills ? drills : []),
    ],
  });
  return bookDocumentSchema.parse({
    schemaVersion: 1,
    slug,
    locale: "en",
    title: `Sample ${slug}`,
    kicker: "Book",
    lead: ["A sample book"],
    cover: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    theme: { accent: "#0E7490", accentDark: "#4FC0D8" },
    ...(options.preface
      ? {
          preface: {
            id: "intro",
            kicker: "Before",
            title: "Training base",
            blocks: [{ t: "schema" }],
          },
        }
      : {}),
    chapters: Array.from({ length: count }, (_, i) => chapterOf(i + 1)),
    deck: { kicker: "Review", title: "Cards", intro: [["All cards"]] },
    sandbox: { engine: "sqlite", seed: "create table t (x int);" },
    eventLoop: {
      scenarios: [
        { name: "Order", code: ["console.log(1)"], steps: [{ l: 1 }] },
      ],
    },
    stats: {
      chapters: count,
      figures: 0,
      exercises: count,
      explain: 0,
      sandboxes: 1,
      cards: count,
    },
  });
}

/** Stores a book the way the import does; the id of the new row. */
export async function seedBook(
  db: Executor,
  input: {
    document: BookDocument;
    status: BookStatus;
    rule: AccessRule;
    now: Date;
  },
): Promise<string> {
  const { document, now } = input;
  const [row] = await db
    .insert(books)
    .values({
      slug: document.slug,
      title: document.title,
      locale: document.locale,
      status: input.status,
      rule: input.rule,
      contentVersion: 1,
      contentHash: "seeded",
      meta: metaOf(document),
      importedAt: now,
      publishedAt: input.status === "published" ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: books.id });
  if (!row) throw new Error("seed failed");
  await db.insert(chapters).values(
    document.chapters.map((chapter) => ({
      ...chapterRow(chapter),
      bookId: row.id,
    })),
  );
  return row.id;
}

/**
 * Attempts for an exercise of the book, built from the exercise itself: the
 * right one and a wrong one of the same kind. SQL tasks have no answer here
 * (the book stores only a fingerprint of the result).
 */
export function attemptsFor(exercise: ExerciseBlock): {
  right: ExerciseAttempt;
  wrong: ExerciseAttempt;
} {
  switch (exercise.t) {
    case "quiz": {
      const answer = [...new Set(exercise.answer)].sort((a, b) => a - b);
      const other = exercise.options.findIndex((_, i) => !answer.includes(i));
      return {
        right: { kind: "quiz", selected: answer },
        wrong: {
          kind: "quiz",
          selected: answer.length > 1 ? (answer.slice(1) as number[]) : [other],
        },
      };
    }
    case "order": {
      const order = exercise.items.map((_, i) => i);
      return {
        right: { kind: "order", order },
        wrong: { kind: "order", order: [...order].reverse() },
      };
    }
    case "sort": {
      const placement = exercise.items.map((item) => item.key);
      const other = (key: string) =>
        exercise.buckets.find((bucket) => bucket.key !== key)?.key ?? key;
      return {
        right: { kind: "sort", placement },
        wrong: {
          kind: "sort",
          placement: placement.map((key, i) => (i === 0 ? other(key) : key)),
        },
      };
    }
    case "sqlTask":
      throw new Error("an SQL task's answer is only a fingerprint");
  }
}

/** An exercise of a stored book, as the server judges it. */
export async function storedExercise(
  db: Executor,
  slug: string,
  id: string,
): Promise<ExerciseBlock> {
  const rows = await db
    .select({ document: chapters.document })
    .from(chapters)
    .innerJoin(books, eq(books.id, chapters.bookId))
    .where(
      and(eq(books.slug, slug), arrayContains(chapters.exerciseIds, [id])),
    );
  for (const row of rows) {
    const found = findExercise(row.document.blocks, id);
    if (found) return found;
  }
  throw new Error(`no exercise ${id} in ${slug}`);
}
