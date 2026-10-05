import { randomUUID } from "node:crypto";
import {
  bookResponseSchema,
  chapterResponseSchema,
  deckResponseSchema,
  type ExerciseAttempt,
  libraryResponseSchema,
  prefaceResponseSchema,
  progressResponseSchema,
} from "@outegro/contracts/edu";
import { reportOf, type SqlResult } from "@outegro/edu-engine";
import { and, asc, eq, sql as query } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assistUsage,
  books,
  cardStatesTable,
  chapters,
  exerciseResults,
  grants,
  readerDays,
  readerProgress,
  understandingChecks,
  users,
} from "./db/schema.js";
import { Viewer } from "./domain/access.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { ProgressService } from "./progress/progress.service.js";
import {
  attemptsFor,
  drillIds,
  drillSolutionResult,
  sampleBook,
  sampleIds,
  seedBook,
  storedExercise,
} from "./test/fixtures.js";
import { type Harness, startHarness } from "./test/harness.js";
import { gate } from "./test/scripted-model.js";

let h: Harness;
type Outline = { n: number; exerciseIds: string[]; cardIds: string[] }[];
let node: Outline;
let sql: Outline;

async function outlineOf(slug: string): Promise<Outline> {
  return h.db
    .select({
      n: chapters.n,
      exerciseIds: chapters.exerciseIds,
      cardIds: chapters.cardIds,
    })
    .from(chapters)
    .innerJoin(books, eq(books.id, chapters.bookId))
    .where(eq(books.slug, slug))
    .orderBy(asc(chapters.n));
}

/** The n-th exercise or card id of a chapter (1-based chapter number). */
const item = (outline: Outline, n: number, kind: "exerciseIds" | "cardIds") =>
  outline[n - 1]?.[kind][0] ?? "missing";

beforeAll(async () => {
  h = await startHarness();
  const now = h.clock.now();
  const grantRule = (slug: string, previewChapters: number) => ({
    mode: "grant" as const,
    features: [`book.${slug}`],
    previewChapters,
  });
  await seedBook(h.db, {
    document: sampleBook("sample-draft"),
    status: "draft",
    rule: grantRule("sample-draft", 1),
    now,
  });
  await seedBook(h.db, {
    document: sampleBook("sample-archived"),
    status: "archived",
    rule: { mode: "free" },
    now,
  });
  await seedBook(h.db, {
    document: sampleBook("sample-free", { preface: true }),
    status: "published",
    rule: { mode: "free" },
    now,
  });
  await seedBook(h.db, {
    document: sampleBook("sample-members"),
    status: "published",
    rule: { mode: "signed_in" },
    now,
  });
  await seedBook(h.db, {
    document: sampleBook("sample-closed", { preface: true }),
    status: "published",
    rule: grantRule("sample-closed", 0),
    now,
  });
  // One exercise of every kind in chapter 1 (a preview); chapter 2 is paid.
  await seedBook(h.db, {
    document: sampleBook("sample-drills", { drills: true }),
    status: "published",
    rule: grantRule("sample-drills", 1),
    now,
  });
  node = await outlineOf("nodejs-internals");
  sql = await outlineOf("sql-internals");
});
afterAll(() => h?.close());

async function get(path: string, userId?: string, roles: string[] = []) {
  const call = h.http().get(path);
  return userId ? call.set(await h.auth(userId, roles)) : call;
}

async function put(
  path: string,
  userId: string,
  body: object,
  headers: Record<string, string> = {},
) {
  return h
    .http()
    .put(path)
    .set({ ...(await h.auth(userId)), ...headers })
    .send(body);
}

async function patch(path: string, userId: string, body: object) {
  return h
    .http()
    .patch(path)
    .set(await h.auth(userId))
    .send(body);
}

/** POST an attempt at an exercise, optionally with an Idempotency-Key. */
async function attempt(
  slug: string,
  exerciseId: string,
  userId: string,
  body: object,
  key?: string,
) {
  return h
    .http()
    .post(`/v1/me/books/${slug}/exercises/${exerciseId}/attempts`)
    .set({
      ...(await h.auth(userId)),
      ...(key === undefined ? {} : { "idempotency-key": key }),
    })
    .send(body);
}

/** The right and a wrong attempt at a stored exercise. */
const attemptsAt = async (slug: string, exerciseId: string) =>
  attemptsFor(await storedExercise(h.db, slug, exerciseId));

async function grantTo(
  userId: string,
  feature = "library",
  extra: Partial<Parameters<Harness["grantEvent"]>[0]> = {},
) {
  return h
    .get(GrantsConsumer)
    .apply(h.grantEvent({ userId, feature, ...extra }));
}

const library = async (userId?: string, roles: string[] = []) => {
  const response = await get("/v1/books", userId, roles);
  expect(response.status).toBe(200);
  return libraryResponseSchema.parse(response.body).books;
};
const accessOf = (list: { slug: string; access: string }[]) =>
  Object.fromEntries(list.map((book) => [book.slug, book.access]));

const resultOf = async (userId: string, exerciseId: string) =>
  (
    await h.db
      .select()
      .from(exerciseResults)
      .where(
        and(
          eq(exerciseResults.userId, userId),
          eq(exerciseResults.exerciseId, exerciseId),
        ),
      )
  )[0];

const daysOf = async (userId: string) =>
  (
    await h.db
      .select({ day: readerDays.day })
      .from(readerDays)
      .where(eq(readerDays.userId, userId))
      .orderBy(asc(readerDays.day))
  ).map((row) => row.day);

const placeOf = async (userId: string) =>
  (
    await h.db
      .select()
      .from(readerProgress)
      .where(eq(readerProgress.userId, userId))
  )[0];

describe("library", () => {
  it("signed out: published books only, paid ones asking to sign in (TC-EDU-01)", async () => {
    const list = await library();
    expect(accessOf(list)).toEqual({
      "nodejs-internals": "sign_in",
      "sql-internals": "sign_in",
      "sample-free": "open",
      "sample-members": "sign_in",
      "sample-closed": "sign_in",
      "sample-drills": "sign_in",
    });
    expect(list.find((book) => book.slug === "nodejs-internals")).toMatchObject(
      {
        title: "Node.js изнутри",
        locale: "ru",
        status: "published",
        contentVersion: 1,
        features: ["library", "book.nodejs-internals"],
        previewChapters: 1,
        progress: null,
        stats: { chapters: 13, exercises: 76, cards: 122 },
        cover: expect.stringMatching(/^<svg /),
      },
    );
    expect(list.find((book) => book.slug === "sample-free")).toMatchObject({
      features: [],
      previewChapters: 0,
    });
  });

  it("signed in: preview or locked without a grant, granted with one (TC-EDU-01)", async () => {
    const reader = randomUUID();
    expect(accessOf(await library(reader))).toEqual({
      "nodejs-internals": "preview",
      "sql-internals": "preview",
      "sample-free": "open",
      "sample-members": "open",
      "sample-closed": "locked",
      "sample-drills": "preview",
    });
    expect((await library(reader))[0]?.progress).toEqual({
      exercisesSolved: 0,
      cardsKnown: 0,
      lastChapter: null,
    });
    await grantTo(reader, "book.sql-internals");
    expect(accessOf(await library(reader))).toMatchObject({
      "nodejs-internals": "preview",
      "sql-internals": "granted",
    });
    await grantTo(reader, "library");
    expect(accessOf(await library(reader))).toMatchObject({
      "nodejs-internals": "granted",
      "sql-internals": "granted",
      "sample-closed": "locked",
    });
  });

  it("staff see drafts and archived books too, with staff access (TC-EDU-02)", async () => {
    const staff = await library(randomUUID(), ["support"]);
    expect(new Set(Object.values(accessOf(staff)))).toEqual(new Set(["staff"]));
    expect(staff.map((book) => book.slug)).toEqual(
      expect.arrayContaining(["sample-draft", "sample-archived"]),
    );
    expect(staff.find((book) => book.slug === "sample-draft")?.status).toBe(
      "draft",
    );
    for (const roles of [["billing_operator"], ["auditor"]])
      expect(
        (await library(randomUUID(), roles)).map((book) => book.slug),
      ).not.toContain("sample-draft");
  });

  it("a bad token is 401, not signed out", async () => {
    for (const authorization of ["Bearer nope", "Basic abc"]) {
      const response = await h
        .http()
        .get("/v1/books")
        .set("authorization", authorization);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }
  });
});

describe("table of contents", () => {
  it("lists every chapter with its sections, counts and access", async () => {
    const reader = randomUUID();
    const response = await get("/v1/books/nodejs-internals", reader);
    expect(response.status).toBe(200);
    const book = bookResponseSchema.parse(response.body);
    expect(book.chapters).toHaveLength(13);
    expect(book.chapters.map((chapter) => chapter.access)).toEqual([
      "preview",
      ...Array(12).fill("locked"),
    ]);
    expect(book.chapters[0]).toMatchObject({
      n: 1,
      id: "n01",
      short: "Устройство",
      exercises: node[0]?.exerciseIds.length,
      cards: node[0]?.cardIds.length,
    });
    expect(book.chapters[0]?.sections[0]).toEqual({
      id: expect.any(String),
      title: "Runtime, а не язык",
    });
    expect(book.chapters.reduce((sum, c) => sum + c.exercises, 0)).toBe(76);
    expect(book.chapters.reduce((sum, c) => sum + c.cards, 0)).toBe(122);
    expect(book).toMatchObject({
      preface: null,
      hasSandbox: false,
      deck: { title: "Карточки по всей книге" },
      note: [expect.stringContaining("Node.js 22")],
      book: { slug: "nodejs-internals", access: "preview" },
    });
    const sqlBook = bookResponseSchema.parse(
      (await get("/v1/books/sql-internals")).body,
    );
    expect(sqlBook).toMatchObject({
      preface: { id: "db", kicker: "Перед началом", title: "Учебная база" },
      hasSandbox: true,
      book: { access: "sign_in", progress: null },
    });
    expect(new Set(sqlBook.chapters.map((c) => c.access))).toEqual(
      new Set(["sign_in"]),
    );
  });

  it("is 404 for unknown, malformed and hidden books; staff open drafts (TC-EDU-02)", async () => {
    const reader = randomUUID();
    for (const path of [
      "/v1/books/no-such-book",
      "/v1/books/Not_A_Slug",
      "/v1/books/sample-draft",
      "/v1/books/sample-archived",
    ]) {
      expect([path, (await get(path, reader)).status]).toEqual([path, 404]);
      expect([path, (await get(path)).status]).toEqual([path, 404]);
    }
    const draft = await get("/v1/books/sample-draft", randomUUID(), [
      "edu_editor",
    ]);
    expect(draft.status).toBe(200);
    expect(
      bookResponseSchema.parse(draft.body).chapters.map((c) => c.access),
    ).toEqual(["staff", "staff", "staff"]);
  });
});

describe("chapters", () => {
  it("follow the access matrix: preview, locked, sign in, granted, hidden (TC-EDU-01, TC-EDU-02)", async () => {
    const reader = randomUUID();
    const preview = await get("/v1/books/nodejs-internals/chapters/1", reader);
    expect(preview.status).toBe(200);
    expect(chapterResponseSchema.parse(preview.body).access).toBe("preview");
    const locked = await get("/v1/books/nodejs-internals/chapters/3", reader);
    expect(locked.status).toBe(403);
    expect(locked.body.error).toMatchObject({
      code: "FORBIDDEN",
      fieldErrors: { access: ["locked"] },
    });
    for (const n of [1, 3]) {
      const signedOut = await get(`/v1/books/nodejs-internals/chapters/${n}`);
      expect(signedOut.status).toBe(401);
      expect(signedOut.body.error).toMatchObject({
        code: "UNAUTHENTICATED",
        fieldErrors: { access: ["sign_in"] },
      });
    }
    const buyer = randomUUID();
    await grantTo(buyer, "book.nodejs-internals");
    const granted = await get("/v1/books/nodejs-internals/chapters/3", buyer);
    expect(granted.status).toBe(200);
    expect(granted.body.access).toBe("granted");
    expect((await get("/v1/books/sample-draft/chapters/1", buyer)).status).toBe(
      404,
    );
    const staff = await get("/v1/books/sample-draft/chapters/1", buyer, [
      "support",
    ]);
    expect(staff.status).toBe(200);
    expect(staff.body.access).toBe("staff");
    expect((await get("/v1/books/sample-free/chapters/2")).body.access).toBe(
      "open",
    );
    expect((await get("/v1/books/sample-members/chapters/2")).status).toBe(401);
    expect(
      (await get("/v1/books/sample-members/chapters/2", reader)).body.access,
    ).toBe("open");
    for (const n of ["99", "0", "01", "abc", "1.0", "-1"])
      expect([
        n,
        (await get(`/v1/books/nodejs-internals/chapters/${n}`, buyer)).status,
      ]).toEqual([n, 404]);
  });

  it("carry the simulator and the sandbox only where the chapter uses them", async () => {
    const buyer = randomUUID();
    await grantTo(buyer, "library");
    const chapter = async (slug: string, n: number) => {
      const response = await get(`/v1/books/${slug}/chapters/${n}`, buyer);
      expect(response.status).toBe(200);
      return chapterResponseSchema.parse(response.body);
    };
    const simulator = await chapter("nodejs-internals", 4);
    expect(simulator.eventLoop?.scenarios).toHaveLength(5);
    expect(simulator.sandbox).toBeNull();
    for (const n of [1, 3, 5, 13]) {
      const plain = await chapter("nodejs-internals", n);
      expect([n, plain.eventLoop, plain.sandbox]).toEqual([n, null, null]);
    }
    for (const n of [1, 7, 13]) {
      const query = await chapter("sql-internals", n);
      expect(query.sandbox).toMatchObject({
        engine: "sqlite",
        seed: expect.stringContaining("CREATE TABLE"),
      });
      expect(query.eventLoop).toBeNull();
    }
    const [one, two, three] = await Promise.all(
      [1, 2, 3].map((n) => chapter("sample-free", n)),
    );
    expect([one?.sandbox?.engine, one?.eventLoop]).toEqual(["sqlite", null]);
    expect([two?.sandbox, two?.eventLoop?.scenarios.length]).toEqual([null, 1]);
    expect([three?.sandbox, three?.eventLoop]).toEqual([null, null]);
  });

  it("link their neighbours and keep the document as imported", async () => {
    const buyer = randomUUID();
    await grantTo(buyer, "library");
    const first = chapterResponseSchema.parse(
      (await get("/v1/books/nodejs-internals/chapters/1", buyer)).body,
    );
    expect(first).toMatchObject({
      prev: null,
      next: { n: 2, short: "Модули" },
      book: {
        slug: "nodejs-internals",
        title: "Node.js изнутри",
        contentVersion: 1,
        locale: "ru",
      },
      chapter: { id: "n01", n: 1, short: "Устройство" },
    });
    const [stored] = await h.db
      .select({ document: chapters.document })
      .from(chapters)
      .innerJoin(books, eq(books.id, chapters.bookId))
      .where(and(eq(books.slug, "nodejs-internals"), eq(chapters.n, 1)));
    expect(first.chapter).toEqual(stored?.document);
    const last = chapterResponseSchema.parse(
      (await get("/v1/books/nodejs-internals/chapters/13", buyer)).body,
    );
    expect([last.prev?.n, last.next]).toEqual([12, null]);
  });

  it("reading never moves the reader's place; the paywall is counted", async () => {
    const counted = (access: string) =>
      h.metric("edu_chapter_requests_total", { access });
    const before = {
      preview: await counted("preview"),
      locked: await counted("locked"),
    };
    const reader = randomUUID();
    await get("/v1/books/nodejs-internals/chapters/1", reader);
    await get("/v1/books/nodejs-internals/chapters/2", reader);
    await get("/v1/books/nodejs-internals", reader);
    await get("/v1/books/nodejs-internals/cards", reader);
    expect(
      await h.db
        .select()
        .from(readerProgress)
        .where(eq(readerProgress.userId, reader)),
    ).toEqual([]);
    expect({
      preview: (await counted("preview")) - before.preview,
      locked: (await counted("locked")) - before.locked,
    }).toEqual({ preview: 1, locked: 1 });
  });
});

describe("preface", () => {
  it("has the access of chapter 1", async () => {
    const reader = randomUUID();
    const preface = await get("/v1/books/sql-internals/preface", reader);
    expect(preface.status).toBe(200);
    expect(prefaceResponseSchema.parse(preface.body)).toMatchObject({
      book: { slug: "sql-internals" },
      preface: { id: "db", title: "Учебная база" },
      sandbox: { engine: "sqlite" },
    });
    expect((await get("/v1/books/sql-internals/preface")).status).toBe(401);
    expect(
      (await get("/v1/books/nodejs-internals/preface", reader)).status,
    ).toBe(404);
    // No preview chapters: the preface is locked like chapter 1.
    const closed = await get("/v1/books/sample-closed/preface", reader);
    expect(closed.status).toBe(403);
    await grantTo(reader, "book.sample-closed");
    expect((await get("/v1/books/sample-closed/preface", reader)).status).toBe(
      200,
    );
    const free = await get("/v1/books/sample-free/preface");
    expect(free.status).toBe(200);
    expect(free.body.sandbox).toMatchObject({ engine: "sqlite" });
  });
});

describe("deck", () => {
  it("has the cards of readable chapters and counts the locked ones", async () => {
    const total = node.reduce((sum, c) => sum + c.cardIds.length, 0);
    const first = node[0]?.cardIds.length ?? 0;
    const reader = randomUUID();
    const preview = deckResponseSchema.parse(
      (await get("/v1/books/nodejs-internals/cards", reader)).body,
    );
    expect(preview.chapters.map((c) => [c.n, c.short, c.cards.length])).toEqual(
      [[1, "Устройство", first]],
    );
    expect(preview.chapters[0]?.cards.map((card) => card.id)).toEqual(
      node[0]?.cardIds,
    );
    expect(preview.lockedCards).toBe(total - first);
    const signedOut = deckResponseSchema.parse(
      (await get("/v1/books/nodejs-internals/cards")).body,
    );
    expect([signedOut.chapters, signedOut.lockedCards]).toEqual([[], total]);
    await grantTo(reader, "library");
    const granted = deckResponseSchema.parse(
      (await get("/v1/books/nodejs-internals/cards", reader)).body,
    );
    expect(granted.chapters).toHaveLength(13);
    expect(granted.chapters.reduce((sum, c) => sum + c.cards.length, 0)).toBe(
      total,
    );
    expect(granted.lockedCards).toBe(0);
    expect((await get("/v1/books/sample-draft/cards", reader)).status).toBe(
      404,
    );
  });
});

describe("attempts: the server judges (TC-EDU-05, TC-EDU-09)", () => {
  const base = "/v1/me/books/nodejs-internals";

  it("solved stays solved after a wrong attempt; every attempt counts (TC-EDU-05)", async () => {
    const reader = randomUUID();
    const id = item(node, 1, "exerciseIds");
    const { right, wrong } = await attemptsAt("nodejs-internals", id);
    const first = await attempt("nodejs-internals", id, reader, wrong);
    expect([first.status, first.body]).toEqual([
      200,
      { correct: false, solved: false },
    ]);
    h.clock.advance(1_000);
    const solvedAt = h.clock.now();
    expect((await attempt("nodejs-internals", id, reader, right)).body).toEqual(
      {
        correct: true,
        solved: true,
      },
    );
    h.clock.advance(1_000);
    expect((await attempt("nodejs-internals", id, reader, wrong)).body).toEqual(
      {
        correct: false,
        solved: true,
      },
    );
    expect(await resultOf(reader, id)).toMatchObject({
      exerciseId: id,
      solved: true,
      attempts: 3,
      firstSolvedAt: solvedAt,
      lastCorrect: false,
      lastAttemptKey: null,
      updatedAt: h.clock.now(),
    });
    expect(
      progressResponseSchema.parse(
        (await get(`${base}/progress`, reader)).body,
      ),
    ).toEqual({
      exercises: { [id]: true },
      cards: {},
      lastChapter: null,
      explainView: null,
      understanding: {},
    });
    expect(await placeOf(reader)).toMatchObject({
      startedAt: new Date(solvedAt.getTime() - 1_000),
      lastActiveAt: h.clock.now(),
    });
    expect(await daysOf(reader)).toEqual(["2026-09-29"]);
  });

  it("judges every kind from the book: single and multiple choice, order, sort", async () => {
    const reader = randomUUID();
    await grantTo(reader, "library");
    // Real exercises of the Node book, and one of each kind in the drill book.
    const kinds = new Map<string, [string, string]>();
    for (const n of [1, 2]) {
      for (const id of node[n - 1]?.exerciseIds ?? []) {
        const exercise = await storedExercise(h.db, "nodejs-internals", id);
        const key =
          exercise.t === "quiz"
            ? new Set(exercise.answer).size > 1
              ? "multi"
              : "single"
            : exercise.t;
        if (!kinds.has(key)) kinds.set(key, ["nodejs-internals", id]);
      }
    }
    expect([...kinds.keys()].sort()).toEqual([
      "multi",
      "order",
      "single",
      "sort",
    ]);
    for (const id of [drillIds.multi, drillIds.order, drillIds.sort])
      kinds.set(`drill ${id}`, ["sample-drills", id]);
    for (const [kind, [slug, id]] of kinds) {
      const { right, wrong } = await attemptsAt(slug, id);
      const no = await attempt(slug, id, reader, wrong);
      expect([kind, no.status, no.body]).toEqual([
        kind,
        200,
        { correct: false, solved: false },
      ]);
      const yes = await attempt(slug, id, reader, right);
      expect([kind, yes.body]).toEqual([kind, { correct: true, solved: true }]);
    }
    // The multiple-choice drill: every right option, in any order, and only those.
    const extra = await attempt("sample-drills", drillIds.multi, randomUUID(), {
      kind: "quiz",
      selected: [2, 1, 0],
    });
    expect(extra.body).toEqual({ correct: false, solved: false });
    const reversed = await attempt(
      "sample-drills",
      drillIds.multi,
      randomUUID(),
      {
        kind: "quiz",
        selected: [2, 0],
      },
    );
    expect(reversed.body).toEqual({ correct: true, solved: true });
  });

  it("an SQL task counts when the reported result matches the fingerprint, order included (TC-EDU-07)", async () => {
    const reader = randomUUID();
    const report = (result: SqlResult) => ({
      kind: "sqlTask",
      ...reportOf(result),
    });
    const send = (body: object) =>
      attempt("sample-drills", drillIds.sql, reader, body);
    const swapped: SqlResult = {
      columns: ["n", "sum"],
      values: [...drillSolutionResult.values].reverse(),
    };
    const wrong = [
      // The same rows in another order: this task says order matters.
      report(swapped),
      // A value off by more than the cents the engine rounds to.
      report({
        ...drillSolutionResult,
        values: [
          [1, 10.6],
          [2, null],
          [3, 7.25],
        ],
      }),
      // NULL is not the string "NULL".
      report({
        ...drillSolutionResult,
        values: [
          [1, 10.5],
          [2, "NULL"],
          [3, 7.25],
        ],
      }),
      // Counts that do not add up: a forged report.
      { ...report(drillSolutionResult), rowCount: 4 },
      { ...report(drillSolutionResult), columns: 3 },
      {
        ...report(drillSolutionResult),
        rows: report(drillSolutionResult).rows.slice(1),
      },
    ];
    for (const body of wrong)
      expect([body, (await send(body)).body]).toEqual([
        body,
        { correct: false, solved: false },
      ]);
    // Column names do not matter, cents of rounding do not either.
    const right = report({
      columns: ["order_id", "amount"],
      values: [
        [1, 10.500001],
        [2, null],
        [3, 7.2499],
      ],
    });
    expect((await send(right)).body).toEqual({ correct: true, solved: true });
    expect((await resultOf(reader, drillIds.sql))?.attempts).toBe(
      wrong.length + 1,
    );

    // A real task of the SQL book: right counts, rows made up.
    const taskId =
      sql[0]?.exerciseIds.find((id) => id.includes("-t-")) ?? "missing";
    const task = await storedExercise(h.db, "sql-internals", taskId);
    if (task.t !== "sqlTask") throw new Error("expected an SQL task");
    const forged = {
      kind: "sqlTask",
      columns: task.expected.columns,
      rowCount: task.expected.rows,
      rows: Array.from({ length: task.expected.rows }, (_, i) =>
        Array.from({ length: task.expected.columns }, () => String(i)),
      ),
    };
    expect(
      (await attempt("sql-internals", task.id, reader, forged)).body,
    ).toEqual({
      correct: false,
      solved: false,
    });
  });

  it("an attempt that does not fit its exercise is 400 and recorded nowhere (TC-EDU-09)", async () => {
    const reader = randomUUID();
    // A single-choice quiz of chapter 1: one option is the whole answer.
    let quiz = "";
    let options = 0;
    for (const id of node[0]?.exerciseIds ?? []) {
      const exercise = await storedExercise(h.db, "nodejs-internals", id);
      if (exercise.t === "quiz" && new Set(exercise.answer).size === 1) {
        quiz = id;
        options = exercise.options.length;
        break;
      }
    }
    expect(options).toBeGreaterThan(1);
    const cases: [string, string, object, string][] = [
      [
        "nodejs-internals",
        quiz,
        { kind: "order", order: [0, 1] },
        "a order answer to a quiz",
      ],
      [
        "nodejs-internals",
        quiz,
        { kind: "quiz", selected: [options] },
        "no such option",
      ],
      [
        "nodejs-internals",
        quiz,
        { kind: "quiz", selected: [0, 0] },
        "an option chosen twice",
      ],
      [
        "nodejs-internals",
        quiz,
        { kind: "quiz", selected: [0, 1] },
        "one option expected",
      ],
      [
        "sample-drills",
        drillIds.order,
        { kind: "order", order: [0, 0, 1] },
        "every item exactly once",
      ],
      [
        "sample-drills",
        drillIds.order,
        { kind: "order", order: [0, 1] },
        "every item exactly once",
      ],
      [
        "sample-drills",
        drillIds.sort,
        { kind: "sort", placement: ["v8", "uv"] },
        "one bucket per item",
      ],
      [
        "sample-drills",
        drillIds.sort,
        { kind: "sort", placement: ["v8", "uv", "zlib"] },
        "no such bucket",
      ],
      [
        "sample-drills",
        drillIds.sql,
        { kind: "quiz", selected: [0] },
        "a quiz answer to a sqlTask",
      ],
    ];
    for (const [slug, id, body, reason] of cases) {
      const response = await attempt(slug, id, reader, body);
      expect([body, response.status, response.body.error]).toEqual([
        body,
        400,
        expect.objectContaining({
          code: "VALIDATION_FAILED",
          fieldErrors: { attempt: [reason] },
        }),
      ]);
    }
    expect(
      await h.db
        .select()
        .from(exerciseResults)
        .where(eq(exerciseResults.userId, reader)),
    ).toEqual([]);
    expect(await placeOf(reader)).toBeUndefined();
    expect(await daysOf(reader)).toEqual([]);
  });

  it("refuses ids that are not the book's (404) and chapters not open to the reader (403)", async () => {
    const reader = randomUUID();
    const quizAttempt: ExerciseAttempt = { kind: "quiz", selected: [0] };
    for (const id of [
      "n01-q-ffffffff",
      "not-an-id",
      item(sql, 1, "exerciseIds"),
      item(node, 1, "cardIds"),
    ])
      expect([
        id,
        (await attempt("nodejs-internals", id, reader, quizAttempt)).status,
      ]).toEqual([id, 404]);
    expect(
      (
        await put(`${base}/cards/${item(node, 1, "exerciseIds")}`, reader, {
          state: "know",
        })
      ).status,
    ).toBe(404);
    const locked = await attempt(
      "nodejs-internals",
      item(node, 3, "exerciseIds"),
      reader,
      quizAttempt,
    );
    expect(locked.status).toBe(403);
    expect(locked.body.error.fieldErrors).toEqual({ access: ["locked"] });
    const lockedDrill = await attempt(
      "sample-drills",
      sampleIds.exercise(2),
      reader,
      quizAttempt,
    );
    expect(lockedDrill.status).toBe(403);
    expect(
      (
        await put(`${base}/cards/${item(node, 3, "cardIds")}`, reader, {
          state: "know",
        })
      ).status,
    ).toBe(403);
    expect(
      (await patch(`${base}/progress`, reader, { lastChapter: 3 })).status,
    ).toBe(403);
    expect(
      (await patch(`${base}/progress`, reader, { lastChapter: 99 })).status,
    ).toBe(404);
    expect(
      (
        await attempt(
          "sample-draft",
          sampleIds.exercise(1),
          reader,
          quizAttempt,
        )
      ).status,
    ).toBe(404);
    // Nothing of the refused writes was stored.
    expect(await placeOf(reader)).toBeUndefined();
  });

  it("is the reader's own: nobody else sees or writes it (INV-10, TC-EDU-05)", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const id = item(node, 1, "exerciseIds");
    const { right } = await attemptsAt("nodejs-internals", id);
    await attempt("nodejs-internals", id, owner, right);
    await patch(`${base}/progress`, owner, { lastChapter: 1 });
    expect((await get(`${base}/progress`, other)).body).toEqual({
      exercises: {},
      cards: {},
      lastChapter: null,
      explainView: null,
      understanding: {},
    });
    expect(
      (await library(other)).find((book) => book.slug === "nodejs-internals")
        ?.progress,
    ).toEqual({ exercisesSolved: 0, cardsKnown: 0, lastChapter: null });
    // A body naming someone else is refused, not obeyed.
    expect(
      (
        await attempt("nodejs-internals", id, other, {
          ...right,
          userId: owner,
        })
      ).status,
    ).toBe(400);
    expect(
      (await library(owner)).find((book) => book.slug === "nodejs-internals")
        ?.progress,
    ).toEqual({ exercisesSolved: 1, cardsKnown: 0, lastChapter: 1 });
    expect(await resultOf(other, id)).toBeUndefined();
  });

  it("needs a token and valid bodies", async () => {
    const reader = randomUUID();
    const id = item(node, 1, "exerciseIds");
    await h.http().get(`${base}/progress`).expect(401);
    await h
      .http()
      .post(`${base}/exercises/${id}/attempts`)
      .send({ kind: "quiz", selected: [0] })
      .expect(401);
    for (const body of [
      {},
      // The old client's verdict is not an answer.
      { solved: true },
      { kind: "quiz" },
      { kind: "quiz", selected: [] },
      { kind: "quiz", selected: [-1] },
      { kind: "quiz", selected: [0], extra: 1 },
      { kind: "essay", text: "…" },
      { kind: "sqlTask", columns: 1, rowCount: 1 },
    ])
      expect([
        body,
        (await attempt("nodejs-internals", id, reader, body)).status,
      ]).toEqual([body, 400]);
    // The old route is gone.
    expect(
      (await put(`${base}/exercises/${id}`, reader, { solved: true })).status,
    ).toBe(404);
    expect(
      (
        await put(`${base}/cards/${item(node, 1, "cardIds")}`, reader, {
          state: "maybe",
        })
      ).status,
    ).toBe(400);
    for (const body of [{ lastChapter: 0 }, { explainView: "story" }, { x: 1 }])
      expect((await patch(`${base}/progress`, reader, body)).status).toBe(400);
  });

  it("counts only what the book still has", async () => {
    const reader = randomUUID();
    const [book] = await h.db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.slug, "nodejs-internals"));
    const id = item(node, 1, "exerciseIds");
    await attempt(
      "nodejs-internals",
      id,
      reader,
      (await attemptsAt("nodejs-internals", id)).right,
    );
    // Results of an exercise a later import dropped stay stored, uncounted.
    await h.db.insert(exerciseResults).values({
      userId: reader,
      bookId: book?.id ?? "",
      exerciseId: "n01-q-00000000",
      solved: true,
      attempts: 1,
      firstSolvedAt: h.clock.now(),
      updatedAt: h.clock.now(),
    });
    await h.db.insert(understandingChecks).values([
      {
        userId: reader,
        bookId: book?.id ?? "",
        chapter: 1,
        bestScore: 8,
        lastScore: 6,
        checks: 2,
        updatedAt: h.clock.now(),
      },
      {
        userId: reader,
        bookId: book?.id ?? "",
        chapter: 99,
        bestScore: 10,
        lastScore: 10,
        checks: 1,
        updatedAt: h.clock.now(),
      },
    ]);
    const progress = progressResponseSchema.parse(
      (await get(`${base}/progress`, reader)).body,
    );
    expect(Object.keys(progress.exercises)).toEqual([id]);
    expect(progress.understanding).toEqual({ "1": 8 });
    expect(
      (await library(reader)).find((b) => b.slug === "nodejs-internals")
        ?.progress?.exercisesSolved,
    ).toBe(1);
  });
});

describe("retries with an Idempotency-Key (TC-EDU-09)", () => {
  it("replay the stored outcome: no new attempt, no activity; another body is 409", async () => {
    const reader = randomUUID();
    const id = item(node, 1, "exerciseIds");
    const { right, wrong } = await attemptsAt("nodejs-internals", id);
    const key = randomUUID();
    const first = await attempt("nodejs-internals", id, reader, wrong, key);
    expect(first.body).toEqual({ correct: false, solved: false });
    const activeAt = (await placeOf(reader))?.lastActiveAt;
    // The retry comes a day later (a client back online): still a replay.
    h.clock.advance(24 * 3600_000);
    for (const sent of [key, key.toUpperCase()]) {
      const again = await attempt("nodejs-internals", id, reader, wrong, sent);
      expect([again.status, again.body]).toEqual([
        200,
        { correct: false, solved: false },
      ]);
    }
    expect((await resultOf(reader, id))?.attempts).toBe(1);
    expect((await placeOf(reader))?.lastActiveAt).toEqual(activeAt);
    expect(await daysOf(reader)).toHaveLength(1);
    const conflict = await attempt("nodejs-internals", id, reader, right, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await resultOf(reader, id))?.attempts).toBe(1);
    // A new key is a new attempt.
    const next = await attempt(
      "nodejs-internals",
      id,
      reader,
      right,
      randomUUID(),
    );
    expect(next.body).toEqual({ correct: true, solved: true });
    expect((await resultOf(reader, id))?.attempts).toBe(2);
    expect(await daysOf(reader)).toHaveLength(2);
    for (const bad of ["abc", "1234", `${key},${key}`]) {
      const response = await attempt(
        "nodejs-internals",
        id,
        reader,
        right,
        bad,
      );
      expect([bad, response.status, response.body.error.fieldErrors]).toEqual([
        bad,
        400,
        { "Idempotency-Key": ["a UUID"] },
      ]);
    }
  });

  it("concurrent retries of one attempt count it once", async () => {
    const reader = randomUUID();
    const id = item(node, 1, "exerciseIds");
    const { right } = await attemptsAt("nodejs-internals", id);
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        attempt("nodejs-internals", id, reader, right, key),
      ),
    );
    expect(responses.map((response) => response.body)).toEqual(
      Array(5).fill({ correct: true, solved: true }),
    );
    expect((await resultOf(reader, id))?.attempts).toBe(1);
  });

  it("make a card mark safe to retry too", async () => {
    const reader = randomUUID();
    const card = `/v1/me/books/nodejs-internals/cards/${item(node, 1, "cardIds")}`;
    const key = randomUUID();
    expect(
      (await put(card, reader, { state: "know" }, { "idempotency-key": key }))
        .body,
    ).toEqual({
      state: "know",
    });
    const activeAt = (await placeOf(reader))?.lastActiveAt;
    h.clock.advance(24 * 3600_000);
    const again = await put(
      card,
      reader,
      { state: "know" },
      { "idempotency-key": key },
    );
    expect([again.status, again.body]).toEqual([200, { state: "know" }]);
    expect((await placeOf(reader))?.lastActiveAt).toEqual(activeAt);
    expect(await daysOf(reader)).toHaveLength(1);
    const conflict = await put(
      card,
      reader,
      { state: "again" },
      { "idempotency-key": key },
    );
    expect(conflict.status).toBe(409);
    expect((await put(card, reader, { state: "again" })).body).toEqual({
      state: "again",
    });
    expect(await daysOf(reader)).toHaveLength(2);
  });
});

describe("reading position and preferences", () => {
  const base = "/v1/me/books/nodejs-internals";

  it("marks cards and moves the reading position", async () => {
    const reader = randomUUID();
    const card = item(node, 1, "cardIds");
    expect(
      (await put(`${base}/cards/${card}`, reader, { state: "again" })).body,
    ).toEqual({ state: "again" });
    expect(
      (await put(`${base}/cards/${card}`, reader, { state: "know" })).body,
    ).toEqual({ state: "know" });
    const moved = await patch(`${base}/progress`, reader, {
      lastChapter: 1,
      explainView: "code",
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toEqual({ lastChapter: 1, explainView: "code" });
    expect(
      (await patch(`${base}/progress`, reader, { explainView: "analogy" }))
        .body,
    ).toEqual({ lastChapter: 1, explainView: "analogy" });
    expect((await patch(`${base}/progress`, reader, {})).body).toEqual({
      lastChapter: 1,
      explainView: "analogy",
    });
    expect(
      progressResponseSchema.parse(
        (await get(`${base}/progress`, reader)).body,
      ),
    ).toEqual({
      exercises: {},
      cards: { [card]: "know" },
      lastChapter: 1,
      explainView: "analogy",
      understanding: {},
    });
    const summary = (await library(reader)).find(
      (book) => book.slug === "nodejs-internals",
    );
    expect(summary?.progress).toEqual({
      exercisesSolved: 0,
      cardsKnown: 1,
      lastChapter: 1,
    });
  });

  it("a change of the favourite explanation is not reading activity", async () => {
    const reader = randomUUID();
    await patch(`${base}/progress`, reader, { lastChapter: 1 });
    const activeAt = (await placeOf(reader))?.lastActiveAt;
    expect(await daysOf(reader)).toHaveLength(1);
    h.clock.advance(24 * 3600_000);
    const days = await daysOf(reader);
    expect(
      (await patch(`${base}/progress`, reader, { explainView: "deep" })).body,
    ).toEqual({ lastChapter: 1, explainView: "deep" });
    expect(await placeOf(reader)).toMatchObject({
      explainView: "deep",
      lastActiveAt: activeAt,
    });
    expect(await daysOf(reader)).toEqual(days);
    // Reaching a chapter is.
    await patch(`${base}/progress`, reader, { lastChapter: 1 });
    expect((await placeOf(reader))?.lastActiveAt).toEqual(h.clock.now());
    expect(await daysOf(reader)).toHaveLength(days.length + 1);
  });
});

describe("grants from Payments", () => {
  it("a grant delivered through RabbitMQ opens the paid chapters (TC-EDU-01)", async () => {
    const reader = randomUUID();
    const path = "/v1/books/sql-internals/chapters/5";
    expect((await get(path, reader)).status).toBe(403);
    await h.publish(
      h.grantEvent({ userId: reader, feature: "book.sql-internals" }),
    );
    await vi.waitFor(
      async () => expect((await get(path, reader)).status).toBe(200),
      { timeout: 15_000, interval: 100 },
    );
  });

  it("ignores other services; an older version never overwrites a newer one (INV-11, TC-EDU-03)", async () => {
    const consumer = h.get(GrantsConsumer);
    const reader = randomUUID();
    const grantId = randomUUID();
    const path = "/v1/books/nodejs-internals/chapters/2";
    expect(await grantTo(reader, "library", { service: "battleship" })).toBe(
      false,
    );
    expect(
      await h.db.select().from(grants).where(eq(grants.userId, reader)),
    ).toEqual([]);
    expect((await get(path, reader)).status).toBe(403);
    const revoked = h.grantEvent({
      userId: reader,
      grantId,
      version: 2,
      state: "revoked",
    });
    const stale = h.grantEvent({ userId: reader, grantId, version: 1 });
    expect(await consumer.apply(revoked)).toBe(true);
    expect(await consumer.apply(stale)).toBe(false);
    expect(await consumer.apply(revoked)).toBe(false);
    expect((await get(path, reader)).status).toBe(403);
  });

  it("a revoked grant locks the paid chapters again (TC-EDU-03)", async () => {
    const reader = randomUUID();
    const grantId = randomUUID();
    const path = "/v1/books/nodejs-internals/chapters/2";
    await grantTo(reader, "library", { grantId, version: 1 });
    expect((await get(path, reader)).status).toBe(200);
    await grantTo(reader, "library", { grantId, version: 2, state: "revoked" });
    expect((await get(path, reader)).status).toBe(403);
    expect(
      (await library(reader)).find((b) => b.slug === "nodejs-internals")
        ?.access,
    ).toBe("preview");
  });

  it("an ended grant locks without any event (INV-12, TC-EDU-03)", async () => {
    const reader = randomUUID();
    const path = "/v1/books/nodejs-internals/chapters/2";
    await grantTo(reader, "library", {
      validUntil: new Date(h.clock.now().getTime() - 1).toISOString(),
    });
    expect((await get(path, reader)).status).toBe(403);
    const later = randomUUID();
    await grantTo(later, "library", {
      validUntil: new Date(h.clock.now().getTime() + 3600_000).toISOString(),
    });
    expect((await get(path, later)).status).toBe(200);
    h.clock.advance(3600_000 - 1);
    expect((await get(path, later)).status).toBe(200);
    h.clock.advance(1);
    expect((await get(path, later)).status).toBe(403);
  });
});

describe("accounts from Identity (TC-EDU-08)", () => {
  /** How many rows of each kind of reading data the user has. */
  const left = async (userId: string) => ({
    progress: (
      await h.db
        .select()
        .from(readerProgress)
        .where(eq(readerProgress.userId, userId))
    ).length,
    answers: (
      await h.db
        .select()
        .from(exerciseResults)
        .where(eq(exerciseResults.userId, userId))
    ).length,
    cards: (
      await h.db
        .select()
        .from(cardStatesTable)
        .where(eq(cardStatesTable.userId, userId))
    ).length,
    days: (
      await h.db.select().from(readerDays).where(eq(readerDays.userId, userId))
    ).length,
    scores: (
      await h.db
        .select()
        .from(understandingChecks)
        .where(eq(understandingChecks.userId, userId))
    ).length,
    assist: (
      await h.db
        .select()
        .from(assistUsage)
        .where(eq(assistUsage.userId, userId))
    ).length,
    grants: (await h.db.select().from(grants).where(eq(grants.userId, userId)))
      .length,
  });
  const purged = {
    progress: 0,
    answers: 0,
    cards: 0,
    days: 0,
    scores: 0,
    assist: 0,
    grants: 0,
  };
  /** What the sessions of this database are waiting for (lock types). */
  const lockWaits = async () =>
    (
      await h.db.execute<{ wait_event: string }>(
        query`select wait_event from pg_stat_activity
            where wait_event_type = 'Lock' and datname = current_database()`,
      )
    ).rows.map((row) => row.wait_event);

  it("a suspended reader gets 403 on every reader endpoint until reactivated", async () => {
    const reader = randomUUID();
    const id = item(node, 1, "exerciseIds");
    const { right } = await attemptsAt("nodejs-internals", id);
    await attempt("nodejs-internals", id, reader, right);
    await h.publish(h.statusEvent(reader, "suspended", 2));
    await vi.waitFor(
      async () => expect((await get("/v1/books", reader)).status).toBe(403),
      { timeout: 15_000, interval: 100 },
    );
    const refused = [
      await get("/v1/books", reader),
      await get("/v1/books/nodejs-internals", reader),
      await get("/v1/books/nodejs-internals/chapters/1", reader),
      await get("/v1/books/sql-internals/preface", reader),
      await get("/v1/books/nodejs-internals/cards", reader),
      await get("/v1/me/books/nodejs-internals/progress", reader),
      await attempt("nodejs-internals", id, reader, right),
      await put(
        `/v1/me/books/nodejs-internals/cards/${item(node, 1, "cardIds")}`,
        reader,
        { state: "know" },
      ),
      await patch("/v1/me/books/nodejs-internals/progress", reader, {
        lastChapter: 1,
      }),
      await get("/v1/me/assist", reader),
    ];
    expect(refused.map((response) => response.status)).toEqual(
      Array(refused.length).fill(403),
    );
    // Signed out, the public routes still answer.
    expect((await get("/v1/books")).status).toBe(200);
    const identity = h.get(IdentityConsumer);
    expect(await identity.apply(h.statusEvent(reader, "active", 1))).toBe(
      false,
    );
    expect((await get("/v1/books", reader)).status).toBe(403);
    expect(await identity.apply(h.statusEvent(reader, "active", 3))).toBe(true);
    expect(
      (await get("/v1/me/books/nodejs-internals/progress", reader)).body,
    ).toMatchObject({ exercises: { [id]: true } });
  });

  it("role changes move the access version but never decide the status", async () => {
    const identity = h.get(IdentityConsumer);
    const reader = randomUUID();
    // Identity: suspended (3), reactivated (4), a role granted (5); the role
    // change overtakes the reactivation.
    await identity.apply(h.statusEvent(reader, "suspended", 3));
    expect(await identity.apply(h.roleEvent(reader, "support", 5))).toBe(true);
    expect(await identity.apply(h.statusEvent(reader, "active", 4))).toBe(true);
    const [stored] = await h.db
      .select()
      .from(users)
      .where(eq(users.userId, reader));
    expect(stored).toMatchObject({
      status: "active",
      accessVersion: 5,
      statusVersion: 4,
    });
    expect((await get("/v1/books", reader)).status).toBe(200);
  });

  it("a deleted reader's progress, answers, cards, days, scores, assistant history and grants are purged", async () => {
    const reader = randomUUID();
    const neighbour = randomUUID();
    await grantTo(reader, "library");
    const [book] = await h.db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.slug, "nodejs-internals"));
    const bookId = book?.id ?? "";
    const id = item(node, 1, "exerciseIds");
    const { right } = await attemptsAt("nodejs-internals", id);
    for (const userId of [reader, neighbour]) {
      await attempt("nodejs-internals", id, userId, right);
      await put(
        `/v1/me/books/sql-internals/cards/${item(sql, 1, "cardIds")}`,
        userId,
        { state: "again" },
      );
      await h.db.insert(understandingChecks).values({
        userId,
        bookId,
        chapter: 1,
        bestScore: 7,
        lastScore: 7,
        checks: 1,
        updatedAt: h.clock.now(),
      });
      await h.db.insert(assistUsage).values({
        userId,
        kind: "explain",
        bookId,
        chapter: 1,
        cached: false,
        outcome: "ok",
        tokensIn: 100,
        tokensOut: 50,
        at: h.clock.now(),
      });
    }
    expect(
      await h.get(IdentityConsumer).apply(h.statusEvent(reader, "deleted", 1)),
    ).toBe(true);
    expect(await left(reader)).toEqual(purged);
    expect(await left(neighbour)).toEqual({
      progress: 2,
      answers: 1,
      cards: 1,
      days: 1,
      scores: 1,
      assist: 1,
      grants: 0,
    });
    expect((await get("/v1/books", reader)).status).toBe(403);
    // A grant event that comes late does not bring the data back.
    expect(await grantTo(reader, "library")).toBe(false);
    expect((await left(reader)).grants).toBe(0);
  });

  it("a write checked before the purge and run after it is refused and stores nothing", async () => {
    const reader = randomUUID();
    const id = item(node, 1, "exerciseIds");
    const { right } = await attemptsAt("nodejs-internals", id);
    // The request passed its account check while the account was active…
    const viewer = Viewer.of({
      userId: reader,
      roles: [],
      grants: [],
      now: h.clock.now(),
    });
    // …and gets to its write once the account is deleted and purged.
    await h.get(IdentityConsumer).apply(h.statusEvent(reader, "deleted", 1));
    const progress = h.get(ProgressService);
    const writes: [string, () => Promise<unknown>][] = [
      [
        "attempt",
        () => progress.attempt(viewer, "nodejs-internals", id, right),
      ],
      [
        "card",
        () =>
          progress.markCard(
            viewer,
            "nodejs-internals",
            item(node, 1, "cardIds"),
            "know",
          ),
      ],
      [
        "position",
        () => progress.move(viewer, "nodejs-internals", { lastChapter: 1 }),
      ],
      [
        "preference",
        () =>
          progress.move(viewer, "nodejs-internals", { explainView: "steps" }),
      ],
    ];
    for (const [name, write] of writes)
      expect([name, await write().catch((error: unknown) => error)]).toEqual([
        name,
        expect.objectContaining({ code: "FORBIDDEN" }),
      ]);
    expect(await left(reader)).toEqual(purged);
  });

  it("a purge waits for a write in flight and takes it with the rest", async () => {
    const reader = randomUUID();
    const id = item(node, 1, "exerciseIds");
    const { right, wrong } = await attemptsAt("nodejs-internals", id);
    await attempt("nodejs-internals", id, reader, wrong);
    // Another session holds the reader's result row, so the next attempt
    // stops inside its transaction, holding the reader's account lock.
    const held = gate();
    const holding = h.db.transaction(async (tx) => {
      await tx
        .select()
        .from(exerciseResults)
        .where(
          and(
            eq(exerciseResults.userId, reader),
            eq(exerciseResults.exerciseId, id),
          ),
        )
        .for("update");
      await held.promise;
    });
    const inFlight = attempt("nodejs-internals", id, reader, right);
    let purge: Promise<boolean> | undefined;
    try {
      await vi.waitFor(
        async () => expect(await lockWaits()).toContain("transactionid"),
        { timeout: 10_000, interval: 20 },
      );
      // The account is deleted meanwhile: the purge waits for that write.
      purge = h
        .get(IdentityConsumer)
        .apply(h.statusEvent(reader, "deleted", 1));
      await vi.waitFor(
        async () => expect(await lockWaits()).toContain("advisory"),
        { timeout: 10_000, interval: 20 },
      );
    } finally {
      // Pass or fail, nothing is left waiting on the held row.
      held.open();
      await holding;
    }
    // The write got in first and committed; the purge took it too.
    expect((await inFlight).body).toEqual({ correct: true, solved: true });
    expect(await purge).toBe(true);
    expect(await left(reader)).toEqual(purged);
  });
});
