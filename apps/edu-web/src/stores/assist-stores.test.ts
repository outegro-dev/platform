import {
  expectationOf,
  type SqlResult,
  type SqlTaskBlock,
} from "@outegro/edu-engine";
import { describe, expect, it } from "vitest";
import { fitsBody, jsonBytes } from "@/lib/body-size";
import { AnswerStore } from "./answer-store";
import { AssistStore } from "./assist-store";
import { AVOID_LENGTH } from "./explain-panel-store";
import {
  createAnswer,
  createAttempt,
  createExplainPanel,
  createSqlHint,
  createUnderstanding,
  retellingDraftKey,
} from "./reader-stores";
import { SectionSpyStore } from "./section-spy-store";
import {
  HINT_PREVIEW_BYTES,
  hintRequest,
  resultPreview,
} from "./sql-hint-store";
import { SqlTaskStore } from "./sql-task-store";
import {
  doneEvent,
  emptyProgress,
  fakeRunner,
  fakeTransport,
  flush,
  memoryStorage,
  testStores,
} from "./testing";

/** Waits until the store's answer has taken every event pushed so far. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};

describe("AssistStore", () => {
  const now = () => new Date("2026-10-04T21:30:00.000Z");

  it("knows today's answers and when they come back (midnight UTC)", () => {
    const assist = new AssistStore(
      { status: { enabled: true, dailyLimit: 30, usedToday: 28 } },
      { now },
    );
    expect(assist.remaining).toBe(2);
    expect(assist.resetsAt().toISOString()).toBe("2026-10-05T00:00:00.000Z");
    assist.answered({ usedToday: 29, dailyLimit: 30 });
    expect(assist.remaining).toBe(1);
    assist.spent();
    expect(assist.exhausted).toBe(true);
    assist.spent();
    expect(assist.quota?.usedToday).toBe(30);
  });

  it("fails closed: no helpers unless the page came with the assistant on", () => {
    // Signed out, or the status did not load: not known to be on.
    const unknown = new AssistStore({ status: null }, { now });
    expect(unknown.enabled).toBe(false);
    expect(unknown.remaining).toBeNull();
    unknown.limitReached();
    expect(unknown.quota).toBeNull();
    const off = new AssistStore(
      { status: { enabled: false, dailyLimit: 30, usedToday: 0 } },
      { now },
    );
    expect(off.enabled).toBe(false);
    const on = new AssistStore(
      { status: { enabled: true, dailyLimit: 30, usedToday: 0 } },
      { now },
    );
    expect(on.enabled).toBe(true);
    on.disable();
    expect(on.enabled).toBe(false);
  });

  it("a signed-out page has no helpers: its status is never known", () => {
    const { stores } = testStores({ signedIn: false, assist: null });
    expect(stores.assist.enabled).toBe(false);
  });
});

describe("AnswerStore", () => {
  function answerStore() {
    const fake = fakeTransport();
    const { stores, connection } = testStores({}, { assist: fake.transport });
    const answer = createAnswer(stores, "explain");
    return { answer, fake, stores, connection };
  }
  const body = { chapter: 1, section: "n01-loop", style: "simpler" as const };

  it("waits, streams the text, then is done with the server's count", async () => {
    const { answer, fake, stores } = answerStore();
    const asked = answer.ask(body);
    expect(answer.phase).toBe("waiting");
    expect(answer.started).toBe(true);
    await settle();
    expect(fake.calls[0]).toMatchObject({
      slug: "nodejs-internals",
      kind: "explain",
      body,
    });
    const stream = fake.streams[0];
    stream?.push({ type: "text", text: "Event loop — " });
    await settle();
    expect(answer.phase).toBe("streaming");
    stream?.push(
      { type: "text", text: "это цикл." },
      doneEvent({ usedToday: 3, truncated: true }),
    );
    await asked;
    expect(answer.text).toBe("Event loop — это цикл.");
    expect(answer.phase).toBe("done");
    expect(answer.truncated).toBe(true);
    expect(stores.assist.remaining).toBe(27);
  });

  it("stops: keeps what came, and the words already shown are counted", async () => {
    const { answer, fake, stores } = answerStore();
    const asked = answer.ask(body);
    await settle();
    fake.streams[0]?.push({ type: "text", text: "Часть" });
    await settle();
    answer.stop();
    expect(answer.phase).toBe("stopped");
    await asked;
    expect(answer.text).toBe("Часть");
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    expect(stores.assist.quota?.usedToday).toBe(1);
    // A late event of the stopped answer changes nothing.
    fake.streams[0]?.push({ type: "text", text: " ещё" });
    await settle();
    expect(answer.text).toBe("Часть");
  });

  it("drops the answer still coming when asked again", async () => {
    const { answer, fake } = answerStore();
    const first = answer.ask(body);
    await settle();
    fake.streams[0]?.push({ type: "text", text: "старое" });
    await settle();
    const second = answer.ask({ ...body, style: "deep" });
    expect(answer.text).toBe("");
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    await settle();
    fake.streams[1]?.push({ type: "text", text: "новое" }, doneEvent());
    await Promise.all([first, second]);
    expect(answer.text).toBe("новое");
    expect(answer.phase).toBe("done");
  });

  it("an error mid-stream keeps the text and offers a retry of the same request", async () => {
    const { answer, fake } = answerStore();
    const asked = answer.ask(body);
    await settle();
    fake.streams[0]?.push(
      { type: "text", text: "Начало" },
      {
        type: "error",
        code: "DEPENDENCY_UNAVAILABLE",
        messageKey: "errors.dependency_unavailable",
        retryable: true,
      },
    );
    await asked;
    expect(answer.phase).toBe("failed");
    expect(answer.text).toBe("Начало");
    expect(answer.failure).toEqual({ kind: "unavailable", retryable: true });
    expect(answer.canRetry).toBe(true);
    answer.retry();
    await settle();
    expect(fake.calls[1]?.body).toEqual(body);
  });

  it("a stream that ends with neither done nor error reads as broken off", async () => {
    const { answer, fake } = answerStore();
    const asked = answer.ask(body);
    await settle();
    fake.streams[0]?.push({ type: "text", text: "Обрыв" });
    fake.streams[0]?.end();
    await asked;
    expect(answer.failure).toEqual({ kind: "unavailable", retryable: true });
  });

  it("names every refusal; disabled turns the helpers off, 429 uses the day up", async () => {
    const cases = [
      ["daily-limit", { kind: "daily-limit" }],
      ["paused", { kind: "paused" }],
      ["too-large", { kind: "too-large" }],
      ["busy", { kind: "unavailable", retryable: true }],
      ["unavailable", { kind: "unavailable", retryable: true }],
      ["signed-out", { kind: "signed-out" }],
      ["forbidden", { kind: "forbidden" }],
      ["not-found", { kind: "not-found" }],
      ["invalid", { kind: "invalid" }],
      ["disabled", { kind: "unavailable", retryable: false }],
    ] as const;
    for (const [reason, failure] of cases) {
      const fake = fakeTransport(() => ({ kind: "refused", reason }));
      const { stores } = testStores({}, { assist: fake.transport });
      const answer = createAnswer(stores, "explain");
      await answer.ask(body);
      expect(answer.failure, reason).toEqual(failure);
      if (reason === "daily-limit") expect(stores.assist.exhausted).toBe(true);
      if (reason === "disabled") expect(stores.assist.enabled).toBe(false);
      else expect(stores.assist.enabled, reason).toBe(true);
    }
  });

  it("paused for the day and too large are said once, with no retry", async () => {
    for (const reason of ["paused", "too-large"] as const) {
      const fake = fakeTransport(() => ({ kind: "refused", reason }));
      const { stores } = testStores({}, { assist: fake.transport });
      const answer = createAnswer(stores, "explain");
      await answer.ask(body);
      expect(answer.phase, reason).toBe("failed");
      expect(answer.canRetry, reason).toBe(false);
      answer.retry();
      expect(fake.calls, reason).toHaveLength(1);
      // The reader's own count is not touched: other readers used the day up.
      expect(stores.assist.remaining, reason).toBe(30);
    }
  });

  it("offline: says so without a request, and so does a failed connection", async () => {
    const { answer, fake, connection } = answerStore();
    connection.online = false;
    await answer.ask(body);
    expect(fake.calls).toHaveLength(0);
    expect(answer.failure).toEqual({ kind: "offline" });
    expect(answer.canRetry).toBe(true);
    const lost = fakeTransport(() => ({ kind: "network" }));
    const { stores } = testStores({}, { assist: lost.transport });
    const other = createAnswer(stores, "explain");
    await other.ask(body);
    expect(other.failure).toEqual({ kind: "unavailable", retryable: true });
  });

  it("a transport that throws is a failed connection, not a crash", async () => {
    const fake = fakeTransport(() => {
      throw new TypeError("Failed to fetch");
    });
    const { stores } = testStores({}, { assist: fake.transport });
    const answer = new AnswerStore("explain", {
      slug: "x",
      transport: fake.transport,
      assist: stores.assist,
      isOnline: () => true,
    });
    await answer.ask(body);
    expect(answer.phase).toBe("failed");
  });
});

describe("ExplainPanelStore", () => {
  function panel() {
    const fake = fakeTransport();
    const { stores } = testStores({}, { assist: fake.transport });
    return { store: createExplainPanel(stores, 2, "n02-modules"), fake };
  }

  it("opens on the first press and toggles after; the panel is kept", () => {
    const { store } = panel();
    expect(store.mounted).toBe(false);
    store.toggle();
    expect([store.open, store.mounted]).toEqual([true, true]);
    store.toggle();
    expect([store.open, store.mounted]).toEqual([false, true]);
  });

  it("asks in a style; another version sends the start of the answer to avoid", async () => {
    const { store, fake } = panel();
    store.chooseStyle("analogy");
    await settle();
    expect(fake.calls[0]?.body).toEqual({
      chapter: 2,
      section: "n02-modules",
      style: "analogy",
    });
    expect(store.canAgain).toBe(false);
    const long = "а".repeat(AVOID_LENGTH + 300);
    fake.streams[0]?.push({ type: "text", text: long }, doneEvent());
    await settle();
    expect(store.canAgain).toBe(true);
    store.again();
    await settle();
    expect(fake.calls[1]?.body).toEqual({
      chapter: 2,
      section: "n02-modules",
      style: "analogy",
      avoid: long.slice(0, AVOID_LENGTH),
    });
  });

  it("a new style drops the running answer", async () => {
    const { store, fake } = panel();
    store.chooseStyle("simpler");
    await settle();
    store.chooseStyle("deep");
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    expect(store.style).toBe("deep");
  });

  it("a question clears the style; an empty one only puts the reader in the field", async () => {
    const { store, fake } = panel();
    store.chooseStyle("code");
    await settle();
    store.askQuestion();
    expect(store.focusQuestion).toBe(1);
    expect(store.questionProblem).toBeNull();
    store.setQuestion("ab");
    store.askQuestion();
    expect(store.questionProblem).toBe("short");
    expect(store.focusQuestion).toBe(2);
    store.setQuestion("  Зачем нужен libuv?  ");
    expect(store.questionProblem).toBeNull();
    store.askQuestion();
    await settle();
    expect(store.style).toBeNull();
    expect(store.asked).toEqual({ kind: "question" });
    expect(fake.calls[1]?.body).toEqual({
      chapter: 2,
      section: "n02-modules",
      question: "Зачем нужен libuv?",
    });
    fake.streams[1]?.push({ type: "text", text: "Ответ" }, doneEvent());
    await settle();
    // Another version is for style answers only.
    expect(store.canAgain).toBe(false);
  });
});

describe("UnderstandingStore", () => {
  function understanding(best: Record<string, number> = {}) {
    const fake = fakeTransport();
    const storage = memoryStorage({
      [retellingDraftKey("nodejs-internals", 3)]: "черновик",
    });
    const { stores } = testStores(
      { progress: { ...emptyProgress, understanding: best } },
      { assist: fake.transport, storage },
    );
    return {
      store: createUnderstanding(stores, 3),
      fake,
      stores,
      storage,
    };
  }
  const retelling =
    "Event loop берёт задачи из очередей по фазам: таймеры, ввод-вывод, check. Между фазами выполняются микрозадачи.";

  it("keeps the draft in this browser", () => {
    const { store, storage } = understanding();
    store.restoreDraft();
    expect(store.text).toBe("черновик");
    store.setText("новый текст");
    expect(storage.data.get(retellingDraftKey("nodejs-internals", 3))).toBe(
      "новый текст",
    );
  });

  it("does not send a retelling under 80 characters: says so and focuses the field", () => {
    const { store, fake } = understanding();
    store.setText("Слишком коротко.");
    store.check();
    expect(store.problem).toBe("short");
    expect(store.focusField).toBe(1);
    expect(fake.calls).toHaveLength(0);
    store.setText(retelling);
    expect(store.problem).toBeNull();
  });

  it("sends the trimmed retelling; the score joins the best one, 7 confirms the chapter", async () => {
    const { store, fake, stores } = understanding({ "3": 5 });
    expect(store.best).toBe(5);
    expect(store.understood).toBe(false);
    store.setText(`  ${retelling}  `);
    store.check();
    expect(store.answer.running).toBe(true);
    // A second press while it is checked does nothing.
    store.check();
    await settle();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.body).toEqual({ chapter: 3, text: retelling });
    fake.streams[0]?.push(
      { type: "text", text: "**Оценка понимания:** 8" },
      doneEvent({ score: 8 }),
    );
    await settle();
    expect(store.score).toBe(8);
    expect(store.best).toBe(8);
    expect(store.understood).toBe(true);
    expect(stores.progress.understandingOf(3)).toBe(8);
  });

  it("a lower score does not lower the best one", async () => {
    const { store, fake } = understanding({ "3": 9 });
    store.setText(retelling);
    store.check();
    await settle();
    fake.streams[0]?.push(doneEvent({ score: 4 }));
    await settle();
    expect(store.score).toBe(4);
    expect(store.best).toBe(9);
  });
});

describe("SqlHintStore", () => {
  const rows = (values: SqlResult["values"]): SqlResult => ({
    columns: ["id", "name"],
    values,
  });
  const solution = rows([
    [1, "Анна"],
    [2, "Борис"],
  ]);
  const task: SqlTaskBlock = {
    t: "sqlTask",
    id: "s01-t-0000000a",
    q: [],
    hint: null,
    solution: "SELECT id, name FROM customers",
    ordered: false,
    expected: expectationOf(solution, false),
  };
  const runner = fakeRunner((_, sql) => {
    if (sql === task.solution) return { kind: "ok", results: [solution] };
    if (sql.includes("one"))
      return { kind: "ok", results: [rows([[1, null]])] };
    if (sql.includes("nothing")) return { kind: "ok", results: [] };
    if (sql.includes("slow")) return { kind: "timeout" };
    return { kind: "error", message: "no such table: client" };
  });

  function hinted() {
    const fake = fakeTransport();
    const { stores } = testStores(
      { signedIn: false, sandboxSeed: "seed" },
      { assist: fake.transport },
    );
    const sql = new SqlTaskStore(task, createAttempt(stores, task), {
      runner,
      seed: "seed",
      drafts: memoryStorage(),
      draftKey: "k",
    });
    return { sql, hint: createSqlHint(stores, sql), fake };
  }

  it("is offered after an SQLite error, with its message", async () => {
    const { sql, hint } = hinted();
    expect(hint.offered).toBe(false);
    sql.setQuery("SELECT * FROM client");
    await sql.check();
    expect(hint.request).toEqual({
      exerciseId: task.id,
      sql: "SELECT * FROM client",
      problem: "error",
      detail: "no such table: client",
    });
  });

  it("is offered for no result and for a result unlike the solution's, with its start", async () => {
    const { sql, hint } = hinted();
    sql.setQuery("SELECT nothing");
    await sql.check();
    expect(hint.request).toMatchObject({ problem: "empty" });
    sql.setQuery("SELECT one");
    await sql.check();
    await flush();
    expect(hint.request).toEqual({
      exerciseId: task.id,
      sql: "SELECT one",
      problem: "rows",
      mine: {
        columns: ["id", "name"],
        rows: [["1", "\u0000NULL"]],
        rowCount: 1,
      },
    });
  });

  it("is not offered for the right result or a sandbox failure", async () => {
    const { sql, hint } = hinted();
    sql.setQuery(task.solution);
    await sql.check();
    await flush();
    expect(sql.outcome).toEqual({ kind: "right" });
    expect(hint.offered).toBe(false);
    sql.setQuery("SELECT slow");
    await sql.check();
    expect(hint.offered).toBe(false);
  });

  it("is asked once per check about the query checked; a new check drops the hint", async () => {
    const { sql, hint, fake } = hinted();
    hint.start();
    sql.setQuery("SELECT * FROM client");
    await sql.check();
    sql.setQuery("SELECT edited");
    hint.ask();
    expect(hint.used).toBe(true);
    hint.ask();
    await settle();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.body).toMatchObject({ sql: "SELECT * FROM client" });
    fake.streams[0]?.push({
      type: "text",
      text: "Таблица называется customers.",
    });
    await settle();
    await sql.check();
    expect(hint.answer.phase).toBe("idle");
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    expect(hint.used).toBe(false);
    hint.stop();
  });

  it("after Stop it may be asked again; one complete hint per check", async () => {
    const { sql, hint, fake } = hinted();
    hint.start();
    sql.setQuery("SELECT * FROM client");
    await sql.check();
    hint.ask();
    await settle();
    fake.streams[0]?.push({ type: "text", text: "Начало" });
    await settle();
    hint.answer.stop();
    expect(hint.used).toBe(false);
    hint.ask();
    await settle();
    expect(fake.calls).toHaveLength(2);
    expect(hint.used).toBe(true);
    fake.streams[1]?.push({ type: "text", text: "Полный ответ" }, doneEvent());
    await settle();
    expect(hint.answer.phase).toBe("done");
    hint.ask();
    await settle();
    expect(fake.calls).toHaveLength(2);
    hint.stop();
  });

  it("follows the checks only between start and stop, as an effect does (twice in Strict Mode)", async () => {
    const { sql, hint, fake } = hinted();
    // Strict Mode: effect, cleanup, effect.
    hint.start();
    hint.stop();
    hint.start();
    sql.setQuery("SELECT * FROM client");
    await sql.check();
    hint.ask();
    await settle();
    // A new check still drops the hint: the second start follows checks.
    await sql.check();
    expect(hint.answer.phase).toBe("idle");
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    // Unmounted: an answer still coming is dropped, checks are no longer followed.
    hint.ask();
    await settle();
    hint.stop();
    expect(fake.calls[1]?.signal.aborted).toBe(true);
    fake.streams[1]?.push({ type: "text", text: "поздно" });
    await settle();
    expect(hint.answer.text).toBe("");
  });

  it("sends at most 8 rows and cuts long cells", () => {
    const many = rows(
      Array.from({ length: 12 }, (_, i) => [i, "x".repeat(300)]),
    );
    const preview = resultPreview(many);
    expect(preview.rows).toHaveLength(8);
    expect(preview.rowCount).toBe(12);
    expect(preview.rows[0]?.[1]).toHaveLength(200);
  });

  it("keeps the preview within its bytes: fewer rows first, then shorter cells", () => {
    const wide: SqlResult = {
      columns: Array.from({ length: 50 }, (_, i) => `колонка_${i}`),
      values: Array.from({ length: 12 }, () =>
        Array.from({ length: 50 }, () => "я".repeat(200)),
      ),
    };
    const preview = resultPreview(wide);
    expect(jsonBytes(preview)).toBeLessThanOrEqual(HINT_PREVIEW_BYTES);
    expect(preview.rowCount).toBe(12);
    expect(preview.columns).toHaveLength(50);
    expect(preview.rows.length).toBeGreaterThan(0);
    expect(preview.rows[0]?.[0]?.length).toBeLessThan(200);
    // A whole hint with the longest query fits in one body for edu-backend.
    expect(
      fitsBody({
        exerciseId: task.id,
        sql: "ё".repeat(4000),
        problem: "values",
        mine: preview,
      }),
    ).toBe(true);
    // A small result is sent whole.
    expect(resultPreview(rows([[1, "Анна"]]))).toEqual({
      columns: ["id", "name"],
      rows: [["1", "Анна"]],
      rowCount: 1,
    });
  });

  it("nothing to ask before the first check", () => {
    const { sql } = hinted();
    expect(hintRequest(sql)).toBeNull();
  });
});

describe("SectionSpyStore and the reader's progress", () => {
  it("follows the section in view", () => {
    const spy = new SectionSpyStore();
    spy.show("n01-a");
    expect(spy.current).toBe("n01-a");
    spy.show(null);
    expect(spy.current).toBeNull();
  });

  it("counts the cards known in the whole book", () => {
    const { stores } = testStores({
      progress: {
        ...emptyProgress,
        cards: {
          "n01-c-00000001": "know",
          "n02-c-00000002": "again",
          "n03-c-00000003": "know",
        },
      },
      signedIn: false,
    });
    expect(stores.progress.cardsKnown).toBe(2);
    stores.progress.markCard("n02-c-00000002", "know");
    expect(stores.progress.cardsKnown).toBe(3);
  });

  it("keeps the best understanding score", () => {
    const { stores } = testStores();
    stores.progress.recordUnderstanding(4, 6);
    stores.progress.recordUnderstanding(4, 3);
    expect(stores.progress.understandingOf(4)).toBe(6);
    stores.progress.recordUnderstanding(4, 9);
    expect(stores.progress.understandingOf(4)).toBe(9);
  });

  it("first shuffles differ from page to page and agree on one page", () => {
    const a = testStores({ shuffleSeed: 1 }).stores;
    const b = testStores({ shuffleSeed: 1 }).stores;
    const c = testStores({ shuffleSeed: 2 }).stores;
    const draw = (stores: typeof a) =>
      Array.from({ length: 4 }, () => stores.firstShuffle("n01-o-1").next());
    expect(draw(a)).toEqual(draw(b));
    expect(draw(a)).not.toEqual(draw(c));
  });
});
