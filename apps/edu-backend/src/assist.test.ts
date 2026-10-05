import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { Logger } from "@nestjs/common";
import {
  type AssistEvent,
  adminOverviewSchema,
  assistStatusSchema,
  progressResponseSchema,
} from "@outegro/contracts/edu";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { THINKING_HEADROOM } from "./assist/assist.service.js";
import { type AssistJob, AssistLedger } from "./assist/ledger.js";
import {
  assistCache,
  assistUsage,
  books,
  chapters,
  readerDays,
  readerProgress,
  understandingChecks,
} from "./db/schema.js";
import { Slots } from "./domain/assist/slots.js";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { IdentityConsumer } from "./events/identity.consumer.js";
import { ProgressService } from "./progress/progress.service.js";
import { sampleBook, seedBook, storedExercise } from "./test/fixtures.js";
import {
  eventsOf,
  type Harness,
  startHarness,
  testTiming,
} from "./test/harness.js";
import { gate } from "./test/scripted-model.js";

/**
 * The reading assistant over HTTP (TC-EDU-10): real PostgreSQL, Valkey and
 * RabbitMQ, the scripted model in place of MiniMax.
 */

let h: Harness;
let nodeBookId: string;
/** Ids of the SQL book's tasks in chapters 1 and 2, and a quiz of chapter 1. */
let sqlTask1: string;
let sqlTask2: string;
let sqlQuiz1: string;

const NODE = "/v1/me/books/nodejs-internals/assist";
const SQL = "/v1/me/books/sql-internals/assist";
const SECTION = "n01-runtime";
const RETELLING =
  "Node.js — это среда выполнения JavaScript вне браузера: движок V8 исполняет код, а libuv даёт цикл событий и асинхронный ввод-вывод.";

beforeAll(async () => {
  h = await startHarness();
  const [book] = await h.db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.slug, "nodejs-internals"));
  nodeBookId = book?.id ?? "";
  const sqlOutline = await h.db
    .select({ n: chapters.n, exerciseIds: chapters.exerciseIds })
    .from(chapters)
    .innerJoin(books, eq(books.id, chapters.bookId))
    .where(eq(books.slug, "sql-internals"))
    .orderBy(asc(chapters.n));
  const tasksOf = (n: number) =>
    sqlOutline[n - 1]?.exerciseIds.filter((id) => id.includes("-t-")) ?? [];
  sqlTask1 = tasksOf(1)[0] ?? "";
  sqlTask2 = tasksOf(2)[0] ?? "";
  sqlQuiz1 = sqlOutline[0]?.exerciseIds.find((id) => id.includes("-q-")) ?? "";
  await seedBook(h.db, {
    document: sampleBook("sample-draft"),
    status: "draft",
    rule: { mode: "free" },
    now: h.clock.now(),
  });
});
afterAll(() => h?.close());
beforeEach(() => h.model.reset());
afterEach(() => {
  // Leave the assistant as the harness set it up.
  Object.assign(h.assistConfig, {
    enabled: true,
    apiKey: "test-key-never-sent",
    dailyLimit: 30,
    globalDailyLimit: 500,
  });
  process.env.SAFE_MODE = "false";
});

async function post(path: string, userId: string | null, body: object) {
  const call = h.http().post(path);
  return (userId ? call.set(await h.auth(userId)) : call).send(body);
}

const explain = (userId: string | null, body: object = {}) =>
  post(`${NODE}/explain`, userId, {
    chapter: 1,
    section: SECTION,
    style: "simpler",
    ...body,
  });

async function status(userId: string) {
  const response = await h
    .http()
    .get("/v1/me/assist")
    .set(await h.auth(userId));
  expect(response.status).toBe(200);
  return assistStatusSchema.parse(response.body);
}

const textOf = (events: AssistEvent[]) =>
  events.map((event) => (event.type === "text" ? event.text : "")).join("");
const doneOf = (events: AssistEvent[]) =>
  events.find((event) => event.type === "done");

const usageOf = (userId: string) =>
  h.db
    .select()
    .from(assistUsage)
    .where(eq(assistUsage.userId, userId))
    .orderBy(asc(assistUsage.at));

const requests = (kind: string, outcome: string) =>
  h.metric("edu_assist_requests_total", { kind, outcome });

/**
 * The shared error filter logs every 5xx; a 503 of a switched-off or busy
 * assistant is expected here. Returns how many such lines were swallowed.
 */
function quietErrors() {
  const spy = vi
    .spyOn(Logger.prototype, "error")
    .mockImplementation(() => undefined);
  return {
    get count() {
      return spy.mock.calls.length;
    },
    restore: () => spy.mockRestore(),
  };
}

/** Today's uncached answers already spent, as if requested earlier. */
async function spend(userId: string, count: number) {
  if (count === 0) return;
  await h.db.insert(assistUsage).values(
    Array.from({ length: count }, () => ({
      userId,
      kind: "explain" as const,
      bookId: nodeBookId,
      chapter: 1,
      cached: false,
      outcome: "ok" as const,
      at: h.clock.now(),
    })),
  );
}

/** Opens a stream on the real port; the test reads it as it comes. */
async function openStream(
  path: string,
  userId: string,
  body: object,
  signal?: AbortSignal,
) {
  const response = await fetch(`${await h.baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(await h.auth(userId)),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  let received = "";
  return {
    response,
    get received() {
      return received;
    },
    /** Reads until the text so far contains `marker`. */
    async until(marker: string) {
      while (!received.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before ${marker}: ${received}`);
        received += decoder.decode(value, { stream: true });
      }
      return received;
    },
    /** Reads to the end. */
    async rest() {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return received;
        received += decoder.decode(value, { stream: true });
      }
    },
  };
}

describe("status and switches (TC-EDU-10)", () => {
  it("is on with a key; off without one, when turned off, and in SAFE_MODE — 503 before any stream", async () => {
    const reader = randomUUID();
    expect(await status(reader)).toEqual({
      enabled: true,
      dailyLimit: 30,
      usedToday: 0,
    });
    await h.http().get("/v1/me/assist").expect(401);
    const disabledBefore = await requests("explain", "disabled");
    const quiet = quietErrors();
    const switches: [string, () => void][] = [
      ["no key", () => Object.assign(h.assistConfig, { apiKey: undefined })],
      ["turned off", () => Object.assign(h.assistConfig, { enabled: false })],
      ["SAFE_MODE", () => (process.env.SAFE_MODE = "true")],
    ];
    for (const [name, turnOff] of switches) {
      turnOff();
      expect([name, (await status(reader)).enabled]).toEqual([name, false]);
      for (const response of [
        await explain(reader),
        await post(`${NODE}/understanding`, reader, {
          chapter: 1,
          text: RETELLING,
        }),
      ]) {
        expect([name, response.status, response.type]).toEqual([
          name,
          503,
          "application/json",
        ]);
        expect(response.body.error).toMatchObject({
          code: "DEPENDENCY_UNAVAILABLE",
          fieldErrors: { assist: ["disabled"] },
          retryable: false,
        });
      }
      Object.assign(h.assistConfig, {
        enabled: true,
        apiKey: "test-key-never-sent",
      });
      process.env.SAFE_MODE = "false";
    }
    quiet.restore();
    expect(h.model.calls).toHaveLength(0);
    expect(await usageOf(reader)).toEqual([]);
    expect((await requests("explain", "disabled")) - disabledBefore).toBe(3);
    expect((await status(reader)).enabled).toBe(true);
  });
});

describe("explain it differently (TC-EDU-10)", () => {
  it("streams the answer as text events and ends with done; the request is recorded", async () => {
    const reader = randomUUID();
    const before = {
      ok: await requests("explain", "ok"),
      in: await h.metric("edu_assist_tokens_total", { direction: "in" }),
      out: await h.metric("edu_assist_tokens_total", { direction: "out" }),
    };
    h.model.script([
      { usage: { input: 300 } },
      { text: "Первая часть. " },
      { text: "Вторая часть." },
      { usage: { input: 310, output: 40 } },
    ]);
    const response = await explain(reader);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    const events = eventsOf(response.text);
    expect(events).toEqual([
      { type: "text", text: "Первая часть. " },
      { type: "text", text: "Вторая часть." },
      {
        type: "done",
        cached: false,
        truncated: false,
        usedToday: 1,
        dailyLimit: 30,
        score: null,
      },
    ]);
    // Every event is one data line and a blank line.
    expect(response.text).toBe(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    );
    const { request } = h.model.calls[0] ?? {};
    expect(request).toMatchObject({ maxTokens: 1800, thinking: false });
    expect(request?.system).toContain("Node.js 22+");
    expect(request?.prompt).toContain("Раздел: «Runtime, а не язык».");
    expect(request?.prompt).toContain(
      "Объясни суть раздела проще, как человеку, который видит это впервые.",
    );
    expect(await usageOf(reader)).toEqual([
      expect.objectContaining({
        kind: "explain",
        bookId: nodeBookId,
        chapter: 1,
        cached: false,
        outcome: "ok",
        tokensIn: 310,
        tokensOut: 40,
      }),
    ]);
    expect(await status(reader)).toMatchObject({ usedToday: 1 });
    // An answer about the book is reading activity.
    expect(
      await h.db
        .select({ day: readerDays.day })
        .from(readerDays)
        .where(eq(readerDays.userId, reader)),
    ).toHaveLength(1);
    expect({
      ok: (await requests("explain", "ok")) - before.ok,
      in:
        (await h.metric("edu_assist_tokens_total", { direction: "in" })) -
        before.in,
      out:
        (await h.metric("edu_assist_tokens_total", { direction: "out" })) -
        before.out,
    }).toEqual({ ok: 1, in: 310, out: 40 });
  });

  it("serves the same style of the same section from the cache: no model call, no limit spent", async () => {
    const first = randomUUID();
    h.model.script([{ text: "Ответ " }, { text: "для кэша." }]);
    const fresh = eventsOf((await explain(first, { style: "analogy" })).text);
    expect(textOf(fresh)).toBe("Ответ для кэша.");
    expect(h.model.calls).toHaveLength(1);
    const cachedBefore = await requests("explain", "cached");

    const second = randomUUID();
    const response = await explain(second, { style: "analogy" });
    expect(response.status).toBe(200);
    expect(eventsOf(response.text)).toEqual([
      { type: "text", text: "Ответ для кэша." },
      {
        type: "done",
        cached: true,
        truncated: false,
        usedToday: 0,
        dailyLimit: 30,
        score: null,
      },
    ]);
    expect(h.model.calls).toHaveLength(1);
    expect(await usageOf(second)).toEqual([
      expect.objectContaining({
        cached: true,
        outcome: "ok",
        tokensIn: 0,
        tokensOut: 0,
      }),
    ]);
    expect(await status(second)).toMatchObject({ usedToday: 0 });
    expect((await requests("explain", "cached")) - cachedBefore).toBe(1);
    const [entry] = await h.db.select().from(assistCache);
    expect(entry).toBeDefined();
    expect(
      (await h.db.select().from(assistCache)).find(
        (row) => row.text === "Ответ для кэша.",
      )?.hits,
    ).toBe(1);

    // Another style or another section is another answer.
    await explain(second, { style: "deep" });
    await explain(second, { style: "analogy", section: "n01-layers" });
    expect(h.model.calls).toHaveLength(3);
  });

  it("never caches a question or another version", async () => {
    const reader = randomUUID();
    const cached = async () => (await h.db.select().from(assistCache)).length;
    const before = await cached();
    const another = { style: "code", avoid: "Предыдущий ответ про кухню." };
    const question = { style: undefined, question: "А зачем тогда libuv?" };
    for (const body of [another, another, question, question]) {
      const response = await explain(reader, body);
      expect(response.status).toBe(200);
      expect(doneOf(eventsOf(response.text))).toMatchObject({ cached: false });
    }
    expect(h.model.calls).toHaveLength(4);
    expect(await cached()).toBe(before);
    expect(h.model.request(0).prompt).toContain("Предыдущий ответ про кухню.");
    expect(h.model.request(2).prompt).toContain("А зачем тогда libuv?");
    expect(await status(reader)).toMatchObject({ usedToday: 4 });
  });

  it("is refused before the stream: signed out 401, suspended 403, locked chapter 403, unknown 404, bad bodies 400", async () => {
    const reader = randomUUID();
    expect((await explain(null)).status).toBe(401);
    const locked = await explain(reader, { chapter: 3, section: "n03-x" });
    expect([locked.status, locked.body.error.fieldErrors]).toEqual([
      403,
      { access: ["locked"] },
    ]);
    const lockedCheck = await post(`${NODE}/understanding`, reader, {
      chapter: 3,
      text: RETELLING,
    });
    expect(lockedCheck.status).toBe(403);
    for (const [path, body] of [
      [`${NODE}/explain`, { chapter: 1, section: "n01-nope", style: "deep" }],
      [
        `${NODE}/explain`,
        { chapter: 1, section: "n02-modules", style: "deep" },
      ],
      [`${NODE}/explain`, { chapter: 99, section: SECTION, style: "deep" }],
      [
        "/v1/me/books/no-such-book/assist/explain",
        { chapter: 1, section: SECTION, style: "deep" },
      ],
      [
        "/v1/me/books/sample-draft/assist/explain",
        { chapter: 1, section: "t01-intro", style: "deep" },
      ],
      [`${NODE}/understanding`, { chapter: 99, text: RETELLING }],
    ] as const)
      expect([path, body, (await post(path, reader, body)).status]).toEqual([
        path,
        body,
        404,
      ]);
    for (const [path, body] of [
      [`${NODE}/explain`, { chapter: 1, section: SECTION }],
      [
        `${NODE}/explain`,
        { chapter: 1, section: SECTION, style: "deep", question: "И ещё?" },
      ],
      [`${NODE}/explain`, { chapter: 1, section: SECTION, style: "poem" }],
      [
        `${NODE}/explain`,
        { chapter: 1, section: SECTION, style: "deep", userId: reader },
      ],
      [
        `${NODE}/explain`,
        {
          chapter: 1,
          section: SECTION,
          style: "deep",
          avoid: "x".repeat(2001),
        },
      ],
      [`${NODE}/understanding`, { chapter: 1, text: "Слишком коротко." }],
      [`${NODE}/understanding`, { chapter: 1, text: "x".repeat(4001) }],
      [
        `${SQL}/sql-hint`,
        { exerciseId: "nope", sql: "select 1", problem: "rows" },
      ],
      [
        `${SQL}/sql-hint`,
        { exerciseId: sqlTask1, sql: "select 1", problem: "slow" },
      ],
    ] as const)
      expect([body, (await post(path, reader, body)).status]).toEqual([
        body,
        400,
      ]);
    await h.get(IdentityConsumer).apply(h.statusEvent(reader, "suspended", 2));
    expect((await explain(reader)).status).toBe(403);
    expect(
      (
        await h
          .http()
          .get("/v1/me/assist")
          .set(await h.auth(reader))
      ).status,
    ).toBe(403);
    expect(h.model.calls).toHaveLength(0);
    expect(await usageOf(reader)).toEqual([]);
  });
});

describe("the daily limit (TC-EDU-10)", () => {
  it("is 429 before the stream once today's answers are spent; cache, refusals and yesterday do not count", async () => {
    const reader = randomUUID();
    h.assistConfig.dailyLimit = 3;
    await spend(reader, 2);
    // Not counted: a cached answer, an answer the reader never got, yesterday's.
    await h.db.insert(assistUsage).values([
      {
        userId: reader,
        kind: "explain",
        bookId: nodeBookId,
        chapter: 1,
        cached: true,
        outcome: "ok",
        at: h.clock.now(),
      },
      {
        userId: reader,
        kind: "explain",
        bookId: nodeBookId,
        chapter: 1,
        cached: false,
        outcome: "refused",
        at: h.clock.now(),
      },
      {
        userId: reader,
        kind: "explain",
        bookId: nodeBookId,
        chapter: 1,
        cached: false,
        outcome: "ok",
        at: new Date(h.clock.now().getTime() - 24 * 3600_000),
      },
    ]);
    expect(await status(reader)).toEqual({
      enabled: true,
      dailyLimit: 3,
      usedToday: 2,
    });
    const last = await explain(reader, {
      question: "Последний вопрос на сегодня?",
      style: undefined,
    });
    expect(doneOf(eventsOf(last.text))).toMatchObject({
      usedToday: 3,
      dailyLimit: 3,
    });
    const limitedBefore = await requests("explain", "daily_limit");
    for (const response of [
      await explain(reader, { question: "Ещё один?", style: undefined }),
      await post(`${NODE}/understanding`, reader, {
        chapter: 1,
        text: RETELLING,
      }),
      await post(`${SQL}/sql-hint`, reader, {
        exerciseId: sqlTask1,
        sql: "select 1",
        problem: "rows",
      }),
    ]) {
      expect([response.status, response.type]).toEqual([
        429,
        "application/json",
      ]);
      expect(response.body.error).toMatchObject({
        code: "RATE_LIMITED",
        fieldErrors: { assist: ["daily_limit"] },
      });
    }
    expect(h.model.calls).toHaveLength(1);
    expect((await requests("explain", "daily_limit")) - limitedBefore).toBe(1);

    // A cached answer is still served: it costs nothing.
    h.model.script([{ text: "Кэшируемый ответ." }]);
    await explain(randomUUID(), { style: "mistakes" });
    const cached = await explain(reader, { style: "mistakes" });
    expect(cached.status).toBe(200);
    expect(doneOf(eventsOf(cached.text))).toMatchObject({
      cached: true,
      usedToday: 3,
    });

    // The next UTC day starts afresh.
    h.clock.advance(24 * 3600_000);
    expect(await status(reader)).toMatchObject({ usedToday: 0 });
    expect(
      (await explain(reader, { question: "Новый день?", style: undefined }))
        .status,
    ).toBe(200);
  });

  it("holds when one reader asks twice at once for the last answer", async () => {
    const reader = randomUUID();
    h.assistConfig.dailyLimit = 1;
    const responses = await Promise.all([
      explain(reader, { question: "Первый?", style: undefined }),
      explain(reader, { question: "Второй?", style: undefined }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 429,
    ]);
    expect(await status(reader)).toMatchObject({ usedToday: 1 });
  });
});

describe("the daily cap of all readers", () => {
  const ledger = () => h.get(AssistLedger);
  /** A cap the requests spent today have just reached (one is spent at least). */
  async function capReached() {
    await spend(randomUUID(), 1);
    h.assistConfig.globalDailyLimit = await ledger().spentToday();
  }
  const paused = {
    code: "DEPENDENCY_UNAVAILABLE",
    fieldErrors: { assist: ["paused"] },
    retryable: false,
  };

  it("pauses the assistant before the stream once reached: 503 paused, not retryable; cached answers are still served", async () => {
    const reader = randomUUID();
    h.model.script([{ text: "Ответ, который потом придёт из кэша." }]);
    expect(
      (await explain(randomUUID(), { style: "simpler", section: "n01-layers" }))
        .status,
    ).toBe(200);
    h.model.reset();
    await capReached();
    const before = {
      understanding: await requests("understanding", "paused"),
      hint: await requests("sql_hint", "paused"),
    };
    const quiet = quietErrors();
    const refused = [
      await post(`${NODE}/understanding`, reader, {
        chapter: 1,
        text: RETELLING,
      }),
      await post(`${SQL}/sql-hint`, reader, {
        exerciseId: sqlTask1,
        sql: "select 1",
        problem: "rows",
      }),
    ];
    quiet.restore();
    for (const response of refused) {
      expect([response.status, response.type]).toEqual([
        503,
        "application/json",
      ]);
      expect(response.body.error).toMatchObject(paused);
    }
    expect({
      understanding:
        (await requests("understanding", "paused")) - before.understanding,
      hint: (await requests("sql_hint", "paused")) - before.hint,
    }).toEqual({ understanding: 1, hint: 1 });
    expect(h.model.calls).toHaveLength(0);
    expect(await usageOf(reader)).toEqual([]);

    // A cached answer still comes, and costs nothing.
    const cached = await explain(reader, {
      style: "simpler",
      section: "n01-layers",
    });
    expect(cached.status).toBe(200);
    expect(doneOf(eventsOf(cached.text))).toMatchObject({
      cached: true,
      usedToday: 0,
    });
    // The assistant is on, only paused; the reader's own limit answers first.
    expect(await status(reader)).toMatchObject({ enabled: true });
    h.assistConfig.dailyLimit = 0;
    expect(
      (await explain(reader, { question: "А мой лимит?", style: undefined }))
        .status,
    ).toBe(429);
    h.assistConfig.dailyLimit = 30;

    // The next UTC day starts afresh.
    h.clock.advance(24 * 3600_000);
    h.model.script([{ text: "Новый день." }]);
    expect(
      (await explain(reader, { question: "Новый день?", style: undefined }))
        .status,
    ).toBe(200);
  });

  it("holds when readers ask at once for the day's last request", async () => {
    await capReached();
    h.assistConfig.globalDailyLimit += 1;
    const pausedBefore = await requests("explain", "paused");
    const quiet = quietErrors();
    const responses = await Promise.all(
      [randomUUID(), randomUUID()].map((reader) =>
        explain(reader, {
          question: "Последний на сегодня?",
          style: undefined,
        }),
      ),
    );
    quiet.restore();
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 503,
    ]);
    expect(
      responses.find((response) => response.status === 503)?.body.error,
    ).toMatchObject(paused);
    expect((await requests("explain", "paused")) - pausedBefore).toBe(1);
    expect(h.model.calls).toHaveLength(1);
    expect(await ledger().spentToday()).toBe(h.assistConfig.globalDailyLimit);
  });

  it("counts what the provider billed: answers, answers in flight, refusals with tokens; not the cache or refusals without", async () => {
    const before = await ledger().spentToday();
    const row = {
      userId: randomUUID(),
      kind: "understanding" as const,
      bookId: nodeBookId,
      chapter: 1,
      at: h.clock.now(),
    };
    await h.db.insert(assistUsage).values([
      { ...row, cached: false, outcome: "ok", tokensIn: 900, tokensOut: 200 },
      // In flight: reserved, not settled yet.
      { ...row, cached: false, outcome: "failed" },
      // The reader left while the model was thinking: billed, nothing read.
      { ...row, cached: false, outcome: "refused", tokensIn: 900 },
      { ...row, cached: false, outcome: "refused", tokensOut: 300 },
      // The provider refused outright; an answer from the cache; yesterday.
      { ...row, cached: false, outcome: "refused" },
      { ...row, cached: true, outcome: "ok" },
      {
        ...row,
        cached: false,
        outcome: "ok",
        tokensIn: 900,
        at: new Date(h.clock.now().getTime() - 24 * 3600_000),
      },
    ]);
    expect((await ledger().spentToday()) - before).toBe(4);
    // A refusal with tokens does not count against the reader's own limit.
    expect(await status(row.userId)).toMatchObject({ usedToday: 2 });
  });

  it("is off at 0", async () => {
    await capReached();
    const quiet = quietErrors();
    const reader = randomUUID();
    expect(
      (await explain(reader, { question: "Пауза?", style: undefined })).status,
    ).toBe(503);
    quiet.restore();
    h.assistConfig.globalDailyLimit = 0;
    h.model.script([{ text: "Без потолка." }]);
    const response = await explain(reader, {
      question: "Без потолка?",
      style: undefined,
    });
    expect(response.status).toBe(200);
    expect(textOf(eventsOf(response.text))).toBe("Без потолка.");
  });
});

describe("explain it in your own words (TC-EDU-10)", () => {
  const answer = (score: string) => [
    { usage: { input: 900 } },
    {
      text: "**Что верно**\n- Среда выполнения.\n**Что упущено**\n- Пул потоков.\n",
    },
    {
      text: "**Ошибки**\n- Ошибок нет.\n**Что перечитать**\n- «Из чего состоит Node»\n",
    },
    {
      text: `**Как сказать сильнее**\nNode.js — это V8 и libuv.\n**Оценка понимания:** ${score}`,
    },
    { usage: { output: 250 } },
  ];

  it("records the best score; progress shows it", async () => {
    const reader = randomUUID();
    const check = async (score: string) => {
      h.model.script(answer(score));
      const response = await post(`${NODE}/understanding`, reader, {
        chapter: 1,
        text: RETELLING,
      });
      expect(response.status).toBe(200);
      return doneOf(eventsOf(response.text));
    };
    expect(await check("7")).toMatchObject({ score: 7, cached: false });
    const request = h.model.request();
    expect(request).toMatchObject({
      thinking: true,
      maxTokens: 1800 + THINKING_HEADROOM,
    });
    expect(request.system).toContain("**Оценка понимания:** N");
    expect(request.prompt).toContain(RETELLING);
    expect(await check("5")).toMatchObject({ score: 5 });
    const progress = async () =>
      progressResponseSchema.parse(
        (
          await h
            .http()
            .get("/v1/me/books/nodejs-internals/progress")
            .set(await h.auth(reader))
        ).body,
      ).understanding;
    expect(await progress()).toEqual({ "1": 7 });
    const row = async () =>
      (
        await h.db
          .select()
          .from(understandingChecks)
          .where(
            and(
              eq(understandingChecks.userId, reader),
              eq(understandingChecks.chapter, 1),
            ),
          )
      )[0];
    expect(await row()).toMatchObject({
      bestScore: 7,
      lastScore: 5,
      checks: 2,
    });
    // No score line: nothing to record.
    h.model.script([{ text: "Разбор без оценки." }]);
    const unscored = await post(`${NODE}/understanding`, reader, {
      chapter: 1,
      text: RETELLING,
    });
    expect(doneOf(eventsOf(unscored.text))).toMatchObject({ score: null });
    expect(await row()).toMatchObject({ checks: 2 });
    // Off the scale: no score, nothing recorded.
    expect(await check("12")).toMatchObject({ score: null });
    expect(await row()).toMatchObject({
      bestScore: 7,
      lastScore: 5,
      checks: 2,
    });
    // The line in another Markdown dress is still the score.
    h.model.script([
      { text: "**Что верно**\n- Почти всё.\n" },
      { text: "**Оценка понимания**: **9** из 10" },
    ]);
    const bolded = await post(`${NODE}/understanding`, reader, {
      chapter: 1,
      text: RETELLING,
    });
    expect(doneOf(eventsOf(bolded.text))).toMatchObject({ score: 9 });
    expect(await progress()).toEqual({ "1": 9 });
    expect(await usageOf(reader)).toHaveLength(5);
    expect(
      (await usageOf(reader)).every((usage) => usage.kind === "understanding"),
    ).toBe(true);
  });
});

describe("the SQL task hint", () => {
  it("is 403 for a task of a closed chapter and 404 for what is not an SQL task of the book", async () => {
    const reader = randomUUID();
    const locked = await post(`${SQL}/sql-hint`, reader, {
      exerciseId: sqlTask2,
      sql: "SELECT 1",
      problem: "rows",
    });
    expect([locked.status, locked.body.error.fieldErrors]).toEqual([
      403,
      { access: ["locked"] },
    ]);
    for (const exerciseId of [sqlQuiz1, "s01-t-ffffffff"])
      expect(
        (
          await post(`${SQL}/sql-hint`, reader, {
            exerciseId,
            sql: "SELECT 1",
            problem: "rows",
          })
        ).status,
      ).toBe(404);
    // The task of another book is not this book's.
    expect(
      (
        await post(`${NODE}/sql-hint`, reader, {
          exerciseId: sqlTask1,
          sql: "SELECT 1",
          problem: "rows",
        })
      ).status,
    ).toBe(404);
    expect(h.model.calls).toHaveLength(0);
    await h
      .get(GrantsConsumer)
      .apply(h.grantEvent({ userId: reader, feature: "book.sql-internals" }));
    h.model.script([{ text: "Проверьте условие." }]);
    expect(
      (
        await post(`${SQL}/sql-hint`, reader, {
          exerciseId: sqlTask2,
          sql: "SELECT 1",
          problem: "rows",
        })
      ).status,
    ).toBe(200);
  });

  it("gives the model the solution for its eyes only; it never reaches the reader", async () => {
    const reader = randomUUID();
    const task = await storedExercise(h.db, "sql-internals", sqlTask1);
    if (task.t !== "sqlTask") throw new Error("expected an SQL task");
    h.model.script([
      { text: "Похоже, в WHERE нет условия на категорию. " },
      { text: "Посмотрите, какие строки остаются." },
    ]);
    const response = await post(`${SQL}/sql-hint`, reader, {
      exerciseId: sqlTask1,
      sql: "SELECT id, name, price FROM products",
      problem: "rows",
      mine: {
        columns: ["id", "name", "price"],
        rows: [["1", "Ноутбук", "\u0000NULL"]],
        rowCount: 12,
      },
    });
    expect(response.status).toBe(200);
    expect(textOf(eventsOf(response.text))).toBe(
      "Похоже, в WHERE нет условия на категорию. Посмотрите, какие строки остаются.",
    );
    expect(response.text).not.toContain(task.solution);
    expect(response.text).not.toContain("только для тебя");
    const { prompt, system, thinking, maxTokens } = h.model.request();
    // Live, without thinking the model printed the corrected query and got
    // PostgreSQL quoting wrong; hints think first.
    expect({ thinking, maxTokens }).toEqual({
      thinking: true,
      maxTokens: 1800 + THINKING_HEADROOM,
    });
    expect(prompt).toContain(
      `Эталонное решение (только для тебя, НЕ показывай его целиком):\n"""\n${task.solution}\n"""`,
    );
    expect(prompt).toContain("1 | Ноутбук | NULL");
    expect(system).toContain("решение целиком не давай никогда");
    // A failed answer does not leak the prompt either.
    h.model.script([{ fail: "invalid" }]);
    const failed = await post(`${SQL}/sql-hint`, reader, {
      exerciseId: sqlTask1,
      sql: "SELECT 1",
      problem: "error",
      detail: "near SELEC: syntax error",
    });
    expect(eventsOf(failed.text)).toEqual([
      {
        type: "error",
        code: "DEPENDENCY_UNAVAILABLE",
        messageKey: "errors.dependencyUnavailable",
        retryable: true,
      },
    ]);
    expect(failed.text).not.toContain(task.solution);
    const usage = await usageOf(reader);
    expect(
      usage.map((row) => [row.kind, row.chapter, row.outcome]).sort(),
    ).toEqual([
      ["sql_hint", 1, "ok"],
      ["sql_hint", 1, "refused"],
    ]);
  });
});

describe("failures of the model", () => {
  it("before the first words: one retry, then an error event; the reader is not charged", async () => {
    const reader = randomUUID();
    const refusedBefore = await requests("explain", "refused");
    h.model.script([{ fail: "unavailable" }], [{ fail: "unavailable" }]);
    const response = await explain(reader, {
      question: "Работает?",
      style: undefined,
    });
    expect(response.status).toBe(200);
    expect(eventsOf(response.text)).toEqual([
      {
        type: "error",
        code: "DEPENDENCY_UNAVAILABLE",
        messageKey: "errors.dependencyUnavailable",
        retryable: true,
      },
    ]);
    expect(h.model.calls).toHaveLength(2);
    expect(await usageOf(reader)).toEqual([
      expect.objectContaining({ cached: false, outcome: "refused" }),
    ]);
    expect(await status(reader)).toMatchObject({ usedToday: 0 });
    expect((await requests("explain", "refused")) - refusedBefore).toBe(1);

    // One failure and then an answer: the reader sees only the answer.
    h.model.reset();
    h.model.script([{ fail: "unavailable" }], [{ text: "Со второго раза." }]);
    const retried = eventsOf(
      (await explain(reader, { question: "Ещё раз?", style: undefined })).text,
    );
    expect(textOf(retried)).toBe("Со второго раза.");
    expect(doneOf(retried)).toMatchObject({ usedToday: 1 });
    expect(h.model.calls).toHaveLength(2);

    // The provider's own limit is not retried.
    h.model.reset();
    h.model.script([{ fail: "limit" }]);
    expect(
      eventsOf(
        (await explain(reader, { question: "Лимит?", style: undefined })).text,
      ),
    ).toEqual([
      {
        type: "error",
        code: "RATE_LIMITED",
        messageKey: "errors.rateLimited",
        retryable: true,
      },
    ]);
    expect(h.model.calls).toHaveLength(1);
  });

  it("in the middle: what came stays, an error event ends it, the answer counts and is not cached", async () => {
    const reader = randomUUID();
    const cached = (await h.db.select().from(assistCache)).length;
    h.model.script([{ text: "Начало ответа " }, { fail: "unavailable" }]);
    const response = await explain(reader, { style: "interview" });
    expect(eventsOf(response.text)).toEqual([
      { type: "text", text: "Начало ответа " },
      {
        type: "error",
        code: "DEPENDENCY_UNAVAILABLE",
        messageKey: "errors.dependencyUnavailable",
        retryable: true,
      },
    ]);
    expect(h.model.calls).toHaveLength(1);
    expect(await usageOf(reader)).toEqual([
      expect.objectContaining({ outcome: "failed" }),
    ]);
    expect(await status(reader)).toMatchObject({ usedToday: 1 });
    expect((await h.db.select().from(assistCache)).length).toBe(cached);
  });

  it("an answer cut at the length limit is marked truncated and not cached", async () => {
    const reader = randomUUID();
    const cached = (await h.db.select().from(assistCache)).length;
    h.model.script([{ text: "Очень длинный ответ…" }, { truncated: true }]);
    const response = await explain(reader, {
      style: "deep",
      section: "n01-readfile",
    });
    expect(doneOf(eventsOf(response.text))).toMatchObject({
      truncated: true,
      cached: false,
    });
    expect((await h.db.select().from(assistCache)).length).toBe(cached);
  });
});

describe("the log", () => {
  it("never gets the answer when its cache write fails; the reader still gets all of it", async () => {
    const reader = randomUUID();
    const answer = "Ответ модели, которому не место в логах: слои V8 и libuv.";
    await h.db.execute(sql`
      create function refuse_cache() returns trigger language plpgsql
        as $$ begin raise exception 'cache unavailable'; end $$`);
    await h.db.execute(sql`
      create trigger refuse_cache before insert on assist_cache
        for each row execute function refuse_cache()`);
    const logged = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    let events: AssistEvent[] = [];
    try {
      h.model.script([{ text: answer }]);
      // A style answer of a section no test has cached: it goes to the cache.
      const response = await explain(reader, {
        style: "code",
        section: "n01-layers",
      });
      expect(response.status).toBe(200);
      events = eventsOf(response.text);
      const lines = logged.mock.calls
        .map((call) => inspect(call, { depth: 10 }))
        .join("\n");
      expect(lines).not.toContain("которому не место");
      expect(lines).not.toContain("cache unavailable");
      expect(logged).toHaveBeenCalledWith(
        { error: { name: "DrizzleQueryError", code: "P0001" } },
        "Answer not cached",
      );
    } finally {
      logged.mockRestore();
      await h.db.execute(sql`drop trigger refuse_cache on assist_cache`);
      await h.db.execute(sql`drop function refuse_cache()`);
    }
    expect(textOf(events)).toBe(answer);
    expect(doneOf(events)).toMatchObject({ cached: false, usedToday: 1 });
    expect(
      (await h.db.select().from(assistCache)).some(
        (row) => row.text === answer,
      ),
    ).toBe(false);
    // Counted and recorded as an answer, as any other.
    expect(await usageOf(reader)).toEqual([
      expect.objectContaining({ outcome: "ok", cached: false }),
    ]);
  });
});

describe("the stream", () => {
  it("sends keep-alive comments until the first words", async () => {
    const reader = randomUUID();
    const open = gate();
    h.model.script([{ wait: open.promise }, { text: "Наконец ответ." }]);
    const stream = await openStream(`${NODE}/explain`, reader, {
      chapter: 1,
      section: SECTION,
      question: "Долго?",
    });
    expect(stream.response.status).toBe(200);
    await stream.until(": keep-alive\n\n");
    expect(stream.received).not.toContain("data:");
    open.open();
    const body = await stream.rest();
    expect(textOf(eventsOf(body))).toBe("Наконец ответ.");
    expect(doneOf(eventsOf(body))).toBeDefined();
    expect(body.slice(body.indexOf("data:"))).not.toContain(": keep-alive");
    expect(testTiming.keepAliveMs).toBeLessThan(1000);
  });

  it("stops the model when the reader leaves", async () => {
    const reader = randomUUID();
    const abortedBefore = await requests("explain", "aborted");
    h.model.script([{ text: "Начало" }, { hang: true }]);
    const controller = new AbortController();
    const stream = await openStream(
      `${NODE}/explain`,
      reader,
      { chapter: 1, section: SECTION, question: "Уйду?" },
      controller.signal,
    );
    await stream.until('"text":"Начало"');
    controller.abort();
    await vi.waitFor(
      async () => {
        expect(h.model.calls[0]?.signal.aborted).toBe(true);
        expect(await usageOf(reader)).toEqual([
          expect.objectContaining({ outcome: "failed" }),
        ]);
      },
      { timeout: 10_000, interval: 50 },
    );
    expect((await requests("explain", "aborted")) - abortedBefore).toBe(1);
  });

  it("waits for a free model slot, then 503 before the stream", async () => {
    const readers = [randomUUID(), randomUUID(), randomUUID()];
    const gates = [gate(), gate()];
    h.model.script(
      [{ wait: gates[0]?.promise ?? Promise.resolve() }, { text: "Первый." }],
      [{ wait: gates[1]?.promise ?? Promise.resolve() }, { text: "Второй." }],
    );
    const body = { chapter: 1, section: SECTION, question: "Занято?" };
    const holding = [
      await openStream(`${NODE}/explain`, readers[0] ?? "", body),
      await openStream(`${NODE}/explain`, readers[1] ?? "", body),
    ];
    await vi.waitFor(() => expect(h.model.calls).toHaveLength(2), {
      timeout: 5_000,
      interval: 20,
    });
    const busyBefore = await requests("explain", "busy");
    const quiet = quietErrors();
    const busy = await post(`${NODE}/explain`, readers[2] ?? "", body);
    quiet.restore();
    expect([busy.status, busy.type]).toEqual([503, "application/json"]);
    expect(busy.body.error).toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      fieldErrors: { assist: ["busy"] },
      retryable: true,
    });
    expect((await requests("explain", "busy")) - busyBefore).toBe(1);
    expect(await usageOf(readers[2] ?? "")).toEqual([]);
    for (const open of gates) open.open();
    const answers = await Promise.all(holding.map((stream) => stream.rest()));
    expect(answers.map((text) => textOf(eventsOf(text))).sort()).toEqual([
      "Второй.",
      "Первый.",
    ]);
    // The slots are free again.
    expect((await post(`${NODE}/explain`, readers[2] ?? "", body)).status).toBe(
      200,
    );
  });

  it("a reader who leaves while waiting for a slot is aborted, not busy, and no error", async () => {
    const [first, second, leaver] = [randomUUID(), randomUUID(), randomUUID()];
    const gates = [gate(), gate()];
    h.model.script(
      [{ wait: gates[0]?.promise ?? Promise.resolve() }, { text: "Первый." }],
      [{ wait: gates[1]?.promise ?? Promise.resolve() }, { text: "Второй." }],
    );
    const body = { chapter: 1, section: SECTION, question: "Подождать?" };
    const holding = [
      await openStream(`${NODE}/explain`, first, body),
      await openStream(`${NODE}/explain`, second, body),
    ];
    await vi.waitFor(() => expect(h.model.calls).toHaveLength(2), {
      timeout: 5_000,
      interval: 20,
    });
    const slots = h.get(Slots);
    const before = {
      aborted: await requests("explain", "aborted"),
      busy: await requests("explain", "busy"),
    };
    // Only leaving ends this wait.
    const slotWaitMs = testTiming.slotWaitMs;
    Object.assign(testTiming, { slotWaitMs: 60_000 });
    const errors = vi.spyOn(Logger.prototype, "error");
    try {
      const controller = new AbortController();
      const leaving = openStream(
        `${NODE}/explain`,
        leaver,
        body,
        controller.signal,
      ).catch((error: unknown) => error);
      await vi.waitFor(() => expect(slots.waiting).toBe(1), {
        timeout: 5_000,
        interval: 20,
      });
      controller.abort();
      expect(((await leaving) as { name?: string }).name).toBe("AbortError");
      await vi.waitFor(
        async () =>
          expect((await requests("explain", "aborted")) - before.aborted).toBe(
            1,
          ),
        { timeout: 5_000, interval: 20 },
      );
      expect(slots.waiting).toBe(0);
      expect((await requests("explain", "busy")) - before.busy).toBe(0);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      Object.assign(testTiming, { slotWaitMs });
      // Pass or fail, the answers holding the slots run to their end.
      for (const open of gates) open.open();
    }
    expect(await usageOf(leaver)).toEqual([]);
    expect(h.model.calls).toHaveLength(2);
    const answers = await Promise.all(holding.map((stream) => stream.rest()));
    expect(answers.map((text) => textOf(eventsOf(text))).sort()).toEqual([
      "Второй.",
      "Первый.",
    ]);
  });
});

describe("the admin overview", () => {
  const staff = randomUUID();
  /** The assistant's part of the overview, as support sees it. */
  const overview = async () =>
    adminOverviewSchema.parse(
      (
        await h
          .http()
          .get("/v1/admin/overview")
          .set(await h.auth(staff, ["support"]))
      ).body,
    ).assist;

  it("shows whether the assistant is on, its limit and the week's requests, failures and tokens", async () => {
    const before = await overview();
    expect(before).toMatchObject({ enabled: true, dailyLimit: 30 });
    const someone = randomUUID();
    const row = {
      userId: someone,
      kind: "explain" as const,
      bookId: nodeBookId,
      chapter: 1,
      at: h.clock.now(),
    };
    await h.db.insert(assistUsage).values([
      { ...row, cached: false, outcome: "ok", tokensIn: 1000, tokensOut: 200 },
      { ...row, cached: true, outcome: "ok" },
      {
        ...row,
        cached: false,
        outcome: "failed",
        tokensIn: 500,
        tokensOut: 20,
      },
      { ...row, cached: false, outcome: "refused", tokensIn: 7 },
      // Older than a week: out of the overview.
      {
        ...row,
        cached: false,
        outcome: "ok",
        tokensIn: 9999,
        tokensOut: 9999,
        at: new Date(h.clock.now().getTime() - 8 * 24 * 3600_000),
      },
    ]);
    const after = await overview();
    expect({
      requests7d: after.requests7d - before.requests7d,
      cached7d: after.cached7d - before.cached7d,
      failed7d: after.failed7d - before.failed7d,
      tokensIn7d: after.tokensIn7d - before.tokensIn7d,
      tokensOut7d: after.tokensOut7d - before.tokensOut7d,
    }).toEqual({
      requests7d: 4,
      cached7d: 1,
      failed7d: 2,
      tokensIn7d: 1507,
      tokensOut7d: 220,
    });
    h.assistConfig.enabled = false;
    h.assistConfig.dailyLimit = 12;
    expect(await overview()).toMatchObject({ enabled: false, dailyLimit: 12 });
  });

  it("shows the cap of all readers and today's requests counted against it, as the reservation counts them; 0 is no cap", async () => {
    const ledger = h.get(AssistLedger);
    const reader = randomUUID();
    const before = await overview();
    // The configured cap; the count is the ledger's, the one `reserve` checks.
    expect(before).toMatchObject({
      globalDailyLimit: 500,
      globalUsedToday: await ledger.spentToday(),
    });
    const usedSince = async () =>
      (await overview()).globalUsedToday - before.globalUsedToday;
    const ask = async (question: string) =>
      eventsOf((await explain(reader, { question, style: undefined })).text);

    // An answer from the model counts; the same answer from the cache does not.
    const sameStyle = { style: "interview", section: "n01-layers" };
    const fresh = eventsOf((await explain(reader, sameStyle)).text);
    const cached = eventsOf((await explain(reader, sameStyle)).text);
    expect(doneOf(fresh)).toMatchObject({ cached: false });
    expect(doneOf(cached)).toMatchObject({ cached: true });
    expect(await usedSince()).toBe(1);

    // Refused outright by the provider, its retry too: it cost nothing.
    h.model.script([{ fail: "unavailable" }], [{ fail: "unavailable" }]);
    expect(await ask("Работает?")).toEqual([
      expect.objectContaining({ type: "error" }),
    ]);
    expect(await usedSince()).toBe(1);

    // Refused after the provider billed tokens for it: counted.
    h.model.script([
      { usage: { input: 900 } },
      { fail: "unavailable", retryable: false },
    ]);
    expect(await ask("А теперь?")).toEqual([
      expect.objectContaining({ type: "error" }),
    ]);
    expect(await usedSince()).toBe(2);

    // An answer still streaming counts from its reservation on.
    const open = gate();
    h.model.script([{ wait: open.promise }, { text: "Наконец ответ." }]);
    const stream = await openStream(`${NODE}/explain`, reader, {
      chapter: 1,
      section: SECTION,
      question: "Долго?",
    });
    try {
      await stream.until(": keep-alive\n\n");
      expect(await usedSince()).toBe(3);
    } finally {
      open.open();
    }
    expect(textOf(eventsOf(await stream.rest()))).toBe("Наконец ответ.");

    // Yesterday's requests are not today's.
    await h.db.insert(assistUsage).values({
      userId: randomUUID(),
      kind: "explain",
      bookId: nodeBookId,
      chapter: 1,
      cached: false,
      outcome: "ok",
      tokensIn: 900,
      at: new Date(h.clock.now().getTime() - 24 * 3600_000),
    });
    const used = before.globalUsedToday + 3;
    expect(await overview()).toMatchObject({ globalUsedToday: used });
    expect(await ledger.spentToday()).toBe(used);

    // At the cap the overview shows the day spent, as the reservation sees
    // it: the assistant is paused, and the paused request is not counted.
    h.assistConfig.globalDailyLimit = used;
    const quiet = quietErrors();
    const paused = await explain(reader, {
      question: "Пауза?",
      style: undefined,
    });
    quiet.restore();
    expect(paused.status).toBe(503);
    expect(paused.body.error).toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      fieldErrors: { assist: ["paused"] },
    });
    expect(await overview()).toMatchObject({
      globalDailyLimit: used,
      globalUsedToday: used,
    });

    // 0 is no cap: nothing pauses, and today's requests are still counted.
    h.assistConfig.globalDailyLimit = 0;
    h.model.script([{ text: "Без потолка." }]);
    expect(textOf(await ask("Без потолка?"))).toBe("Без потолка.");
    expect(await overview()).toMatchObject({
      globalDailyLimit: 0,
      globalUsedToday: used + 1,
    });
  });
});

describe("a deleted reader (TC-EDU-08)", () => {
  it("loses the assistant's history and the understanding scores", async () => {
    const reader = randomUUID();
    h.model.script([{ text: "**Оценка понимания:** 6" }]);
    await post(`${NODE}/understanding`, reader, {
      chapter: 1,
      text: RETELLING,
    });
    await explain(reader, { question: "Что-нибудь ещё?", style: undefined });
    expect(await usageOf(reader)).toHaveLength(2);
    expect(
      await h.db
        .select()
        .from(understandingChecks)
        .where(eq(understandingChecks.userId, reader)),
    ).toHaveLength(1);
    await h.get(IdentityConsumer).apply(h.statusEvent(reader, "deleted", 1));
    expect(await usageOf(reader)).toEqual([]);
    expect(
      await h.db
        .select()
        .from(understandingChecks)
        .where(eq(understandingChecks.userId, reader)),
    ).toEqual([]);
    expect(
      await h.db
        .select()
        .from(readerProgress)
        .where(eq(readerProgress.userId, reader)),
    ).toEqual([]);
    expect((await explain(reader)).status).toBe(403);
  });

  /** Everything of the reader the assistant may write. */
  const leftOf = async (userId: string) => ({
    usage: (await usageOf(userId)).length,
    scores: (
      await h.db
        .select()
        .from(understandingChecks)
        .where(eq(understandingChecks.userId, userId))
    ).length,
    progress: (
      await h.db
        .select()
        .from(readerProgress)
        .where(eq(readerProgress.userId, userId))
    ).length,
    days: (
      await h.db.select().from(readerDays).where(eq(readerDays.userId, userId))
    ).length,
  });
  const nothing = { usage: 0, scores: 0, progress: 0, days: 0 };

  it("an answer that streams across the purge writes nothing back", async () => {
    const reader = randomUUID();
    const open = gate();
    h.model.script([
      { usage: { input: 900 } },
      { text: "**Что верно**\n- Почти всё.\n" },
      { wait: open.promise },
      { text: "**Оценка понимания:** 8" },
      { usage: { output: 250 } },
    ]);
    const stream = await openStream(`${NODE}/understanding`, reader, {
      chapter: 1,
      text: RETELLING,
    });
    try {
      await stream.until("Почти всё");
      // While it streams, the reservation is on the record.
      expect(await leftOf(reader)).toEqual({ ...nothing, usage: 1 });
      expect(
        await h
          .get(IdentityConsumer)
          .apply(h.statusEvent(reader, "deleted", 1)),
      ).toBe(true);
      expect(await leftOf(reader)).toEqual(nothing);
    } finally {
      open.open();
    }
    const events = eventsOf(await stream.rest());
    // The reader got the answer; its settlement, score and activity are
    // not written back.
    expect(doneOf(events)).toMatchObject({ score: 8, cached: false });
    expect(await leftOf(reader)).toEqual(nothing);
  });

  it("a request checked before the purge and writing after it writes nothing", async () => {
    const deleted = randomUUID();
    const suspended = randomUUID();
    const identity = h.get(IdentityConsumer);
    await identity.apply(h.statusEvent(deleted, "deleted", 1));
    await identity.apply(h.statusEvent(suspended, "suspended", 1));
    const ledger = h.get(AssistLedger);
    const progress = h.get(ProgressService);
    for (const userId of [deleted, suspended]) {
      const job: AssistJob = {
        kind: "understanding",
        userId,
        bookId: nodeBookId,
        chapter: 1,
      };
      await expect(ledger.reserve(job)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await ledger.recordCached(job);
      await progress.recordActivity(userId, nodeBookId);
      await progress.recordUnderstanding(userId, nodeBookId, 1, 9);
      expect([userId, await leftOf(userId)]).toEqual([userId, nothing]);
    }
  });
});
