import type { ExerciseAttempt } from "@outegro/contracts/edu";
import {
  type OrderBlock,
  type QuizBlock,
  SeededRandom,
  type SortBlock,
  type SqlTaskBlock,
} from "@outegro/edu-engine";
import { describe, expect, it, vi } from "vitest";
import type { AttemptInput, AttemptOutcome } from "@/lib/reader-api";
import { OrderStore } from "./order-store";
import { QuizStore } from "./quiz-store";
import { createAttempt, shufflesOf } from "./reader-stores";
import { SortStore } from "./sort-store";
import { deferred, fakeApi, flush, testStores } from "./testing";

const quiz: QuizBlock = {
  t: "quiz",
  id: "n01-q-00000001",
  q: [],
  options: [[], [], []],
  answer: [1],
  why: [],
};
const multi: QuizBlock = { ...quiz, id: "n01-q-00000002", answer: [0, 2] };
const order: OrderBlock = {
  t: "order",
  id: "n01-o-00000003",
  q: [],
  items: [[], [], []],
  why: [],
};
const sort: SortBlock = {
  t: "sort",
  id: "n01-s-00000004",
  q: [],
  buckets: [
    { key: "v8", c: [] },
    { key: "uv", c: [] },
  ],
  items: [
    { key: "v8", c: [] },
    { key: "uv", c: [] },
  ],
  why: [],
};

function verdictApi(answer: (input: AttemptInput) => AttemptOutcome) {
  return fakeApi({
    submitAttempt: vi.fn(async (input: AttemptInput) => answer(input)),
  });
}

describe("AttemptStore: the server decides", () => {
  it("checks on the server and shows its verdict, not the local one", async () => {
    // The server says right to an answer the book's key calls wrong.
    const api = verdictApi(() => ({ kind: "ok", correct: true, solved: true }));
    const { stores } = testStores({}, { api });
    const attempt = createAttempt(stores, quiz);
    attempt.submit({ kind: "quiz", selected: [0] });
    expect(attempt.verdict).toEqual({ state: "checking" });
    expect(stores.progress.isSolved(quiz.id)).toBe(false);
    await flush();
    expect(attempt.verdict).toEqual({
      state: "decided",
      correct: true,
      source: "server",
    });
    expect(stores.progress.isSolved(quiz.id)).toBe(true);
    expect(api.submitAttempt).toHaveBeenCalledWith({
      slug: "nodejs-internals",
      id: quiz.id,
      attempt: { kind: "quiz", selected: [0] },
      idempotencyKey: "key-1",
    });
  });

  it("is not solved until the server confirms it", async () => {
    const answer = deferred<AttemptOutcome>();
    const api = fakeApi({ submitAttempt: vi.fn(() => answer.promise) });
    const { stores } = testStores({}, { api });
    const attempt = createAttempt(stores, quiz);
    attempt.submit({ kind: "quiz", selected: [1] });
    expect(stores.progress.isSolved(quiz.id)).toBe(false);
    expect(stores.progress.solvedIn("n01")).toBe(0);
    answer.resolve({ kind: "ok", correct: true, solved: true });
    await flush();
    expect(stores.progress.solvedIn("n01")).toBe(1);
  });

  it("without the server, shows the local verdict as not saved and retries with the same key", async () => {
    const submitAttempt = vi
      .fn<(input: AttemptInput) => Promise<AttemptOutcome>>()
      .mockResolvedValueOnce({ kind: "failed" })
      .mockResolvedValueOnce({ kind: "ok", correct: true, solved: true });
    const { stores } = testStores({}, { api: fakeApi({ submitAttempt }) });
    const attempt = createAttempt(stores, quiz);
    attempt.submit({ kind: "quiz", selected: [1] });
    await flush();
    expect(attempt.verdict).toEqual({
      state: "decided",
      correct: true,
      source: "local",
    });
    expect(stores.progress.isSolved(quiz.id)).toBe(false);
    expect(stores.sync.canRetry(attempt.saveKey)).toBe(true);
    await stores.sync.retry(attempt.saveKey);
    expect(
      submitAttempt.mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual(["key-1", "key-1"]);
    expect(attempt.verdict).toMatchObject({ source: "server", correct: true });
    expect(stores.progress.isSolved(quiz.id)).toBe(true);
  });

  it("offline, sends nothing and keeps the attempt for a retry", async () => {
    const { stores, api, connection } = testStores();
    connection.online = false;
    const attempt = createAttempt(stores, quiz);
    attempt.submit({ kind: "quiz", selected: [0] });
    expect(attempt.verdict).toEqual({
      state: "decided",
      correct: false,
      source: "local",
    });
    expect(stores.sync.statusOf(attempt.saveKey)).toBe("offline");
    expect(api.submitAttempt).not.toHaveBeenCalled();
    connection.online = true;
    await stores.sync.retry(attempt.saveKey);
    expect(api.submitAttempt).toHaveBeenCalledTimes(1);
  });

  it("a refusal for good keeps the local verdict and offers no retry", async () => {
    const api = verdictApi(() => ({ kind: "forbidden" }));
    const { stores } = testStores({}, { api });
    const attempt = createAttempt(stores, quiz);
    attempt.submit({ kind: "quiz", selected: [1] });
    await flush();
    expect(attempt.verdict).toMatchObject({ source: "local", correct: true });
    expect(stores.sync.statusOf(attempt.saveKey)).toBe("forbidden");
    expect(stores.sync.canRetry(attempt.saveKey)).toBe(false);
  });

  it("an answer larger than edu-backend takes is too large for good: never sent, no retry", async () => {
    const task: SqlTaskBlock = {
      t: "sqlTask",
      id: "s01-t-00000009",
      q: [],
      hint: null,
      solution: "SELECT 1",
      ordered: false,
      expected: { columns: 1, rows: 1, fingerprint: "0".repeat(16) },
    };
    const { stores, api } = testStores();
    const attempt = createAttempt(stores, task);
    // 200 rows of two 480-character cells: twice the body edu-backend takes.
    const cell = "0".repeat(480);
    attempt.submit({
      kind: "sqlTask",
      columns: 2,
      rowCount: 200,
      rows: Array.from({ length: 200 }, () => [cell, cell]),
    });
    await flush();
    expect(api.submitAttempt).not.toHaveBeenCalled();
    expect(stores.sync.statusOf(attempt.saveKey)).toBe("too-large");
    expect(stores.sync.canRetry(attempt.saveKey)).toBe(false);
    expect(stores.sync.retry(attempt.saveKey)).toBeNull();
    expect(attempt.verdict).toEqual({
      state: "decided",
      correct: false,
      source: "local",
    });
    // A smaller result of the same task is sent as usual.
    attempt.clear();
    attempt.submit({
      kind: "sqlTask",
      columns: 2,
      rowCount: 1,
      rows: [["1", "2"]],
    });
    await flush();
    expect(api.submitAttempt).toHaveBeenCalledTimes(1);
  });

  it("signed out, checks on this device only", async () => {
    const { stores, api } = testStores({ signedIn: false, progress: null });
    const attempt = createAttempt(stores, quiz);
    attempt.submit({ kind: "quiz", selected: [1] });
    expect(attempt.verdict).toEqual({
      state: "decided",
      correct: true,
      source: "local",
    });
    await flush();
    expect(api.submitAttempt).not.toHaveBeenCalled();
  });

  it("a new attempt gets a new key; one being checked is not cleared", async () => {
    const answer = deferred<AttemptOutcome>();
    const submitAttempt = vi
      .fn<(input: AttemptInput) => Promise<AttemptOutcome>>()
      .mockImplementationOnce(() => answer.promise)
      .mockResolvedValue({ kind: "ok", correct: false, solved: false });
    const { stores } = testStores({}, { api: fakeApi({ submitAttempt }) });
    const attempt = createAttempt(stores, quiz);
    attempt.submit({ kind: "quiz", selected: [1] });
    attempt.clear();
    attempt.submit({ kind: "quiz", selected: [0] });
    expect(attempt.current?.answer).toEqual({ kind: "quiz", selected: [1] });
    answer.resolve({ kind: "ok", correct: true, solved: true });
    await flush();
    attempt.clear();
    attempt.submit({ kind: "quiz", selected: [0] });
    await flush();
    expect(
      submitAttempt.mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual(["key-1", "key-2"]);
    expect(attempt.verdict).toMatchObject({ correct: false, source: "server" });
    // Solved stays solved.
    expect(stores.progress.isSolved(quiz.id)).toBe(true);
  });
});

describe("QuizStore", () => {
  const make = () => {
    const { stores, api } = testStores();
    return { store: new QuizStore(quiz, createAttempt(stores, quiz)), api };
  };

  it("answers a single-choice quiz with one click, marks from the book", async () => {
    const { store, api } = make();
    store.choose(2);
    expect(store.answered).toBe(true);
    expect(store.markOf(2)).toBe("wrong");
    expect(store.markOf(1)).toBe("missed");
    await flush();
    expect(api.submitAttempt.mock.calls[0]?.[0].attempt).toEqual({
      kind: "quiz",
      selected: [2],
    });
    // The fake server says right: the verdict is its.
    expect(store.result).toBe("right");
    store.choose(0);
    expect(store.selected.has(0)).toBe(false);
  });

  it("toggles options of a multiple-choice quiz and checks the set", async () => {
    const { stores, api } = testStores(
      {},
      {
        api: verdictApi(() => ({ kind: "ok", correct: false, solved: false })),
      },
    );
    const store = new QuizStore(multi, createAttempt(stores, multi));
    store.choose(2);
    store.choose(1);
    store.choose(1);
    expect(store.answered).toBe(false);
    store.check();
    expect(store.focus).toBe("again");
    await flush();
    expect(api.submitAttempt.mock.calls[0]?.[0].attempt).toEqual({
      kind: "quiz",
      selected: [2],
    });
    expect(store.result).toBe("partly");
    store.reset();
    expect(store.answered).toBe(false);
    expect(store.selected.size).toBe(0);
    expect(store.focus).toBe("options");
  });

  it("does not check an empty selection", () => {
    const { stores } = testStores();
    const store = new QuizStore(multi, createAttempt(stores, multi));
    store.check();
    expect(store.answered).toBe(false);
  });
});

describe("OrderStore", () => {
  it("starts from the page's first shuffle, never already in order", () => {
    const { stores } = testStores();
    const shuffles = (random: number) => ({
      first: stores.firstShuffle(order.id),
      random: new SeededRandom(random),
    });
    // The same page seed: the server render and the browser agree.
    const a = new OrderStore(order, createAttempt(stores, order), shuffles(1));
    const b = new OrderStore(order, createAttempt(stores, order), shuffles(2));
    expect(a.pool).toEqual(b.pool);
    expect(a.pool).not.toEqual([0, 1, 2]);
  });

  it("starts in another order on another visit (another page seed)", () => {
    const long: OrderBlock = { ...order, items: [[], [], [], [], [], []] };
    const firstOrders = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => {
        const { stores } = testStores({ shuffleSeed: seed });
        const store = new OrderStore(
          long,
          createAttempt(stores, long),
          shufflesOf(stores, long.id),
        );
        return store.pool.join();
      }),
    );
    expect(firstOrders.size).toBeGreaterThan(1);
  });

  it("sends the order once the last item is placed; focus follows the items", async () => {
    const { stores, api } = testStores();
    const store = new OrderStore(order, createAttempt(stores, order), {
      first: new SeededRandom(3),
      random: new SeededRandom(3),
    });
    store.pick(1);
    expect(store.focus?.startsWith("pool-")).toBe(true);
    store.unpick(0);
    expect(store.picked).toEqual([]);
    expect(store.focus).toBe("pool-1");
    for (const index of [1, 0, 2]) store.pick(index);
    expect(store.complete).toBe(true);
    expect(store.stateAt(0)).toBe("wrong");
    expect(store.stateAt(2)).toBe("right");
    expect(store.focus).toBe("retry");
    await flush();
    expect(
      api.submitAttempt.mock.calls[0]?.[0].attempt,
    ).toEqual<ExerciseAttempt>({ kind: "order", order: [1, 0, 2] });
    store.retry();
    expect(store.picked).toEqual([]);
    expect(store.attempt.current).toBeNull();
  });
});

describe("SortStore", () => {
  it("keeps the first choice per item and sends the placement in book order", async () => {
    const { stores, api } = testStores();
    const store = new SortStore(sort, createAttempt(stores, sort), {
      first: new SeededRandom(4),
      random: new SeededRandom(4),
    });
    store.choose(1, "v8");
    store.choose(1, "uv");
    expect(store.answerOf(1)).toBe("v8");
    expect(store.stateOf(1)).toBe("wrong");
    expect(store.markOf(1, "uv")).toBe("should");
    expect(store.attempt.current).toBeNull();
    store.choose(0, "v8");
    expect(store.score).toMatchObject({ complete: true, right: 1, total: 2 });
    await flush();
    expect(api.submitAttempt.mock.calls[0]?.[0].attempt).toEqual({
      kind: "sort",
      placement: ["v8", "v8"],
    });
    store.retry();
    expect(store.started).toBe(false);
    expect(store.focus).toBe("first");
  });
});
