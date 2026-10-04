import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  expectationOf,
  reportOf,
  resolveEventLoopSteps,
  type SqlResult,
  type SqlTaskBlock,
} from "@outegro/edu-engine";
import { describe, expect, it, vi } from "vitest";
import type { CardInput, WriteOutcome } from "@/lib/reader-api";
import type { RunOutcome, SqlRunner } from "@/lib/sql/engine";
import { DeckStore } from "./deck-store";
import { EXPLAIN_VIEW_KEY } from "./explain-preference-store";
import { createAttempt } from "./reader-stores";
import { SimulatorStore } from "./simulator-store";
import { SqlSandboxStore } from "./sql-sandbox-store";
import { SqlTaskStore } from "./sql-task-store";
import {
  deferred,
  emptyProgress,
  fakeApi,
  fakeRunner,
  flush,
  memoryStorage,
  testStores,
} from "./testing";

const chapters = [
  {
    n: 1,
    short: "Устройство",
    cards: [
      { id: "n01-c-00000001", front: ["a"], back: ["b"] },
      { id: "n01-c-00000002", front: ["c"], back: ["d"] },
    ],
  },
  {
    n: 2,
    short: "Модули",
    cards: [{ id: "n02-c-00000003", front: ["e"], back: ["f"] }],
  },
];

describe("DeckStore", () => {
  it("deals the first queue from the page's seed, so the server and the browser agree", () => {
    const { stores } = testStores();
    const deps = () => ({
      progress: stores.progress,
      sync: stores.sync,
      first: stores.firstShuffle("deck"),
      random: stores.services.random,
    });
    const a = new DeckStore(chapters, deps());
    const b = new DeckStore(chapters, deps());
    expect(a.queue).toEqual(b.queue);
    expect([...a.queue].sort()).toEqual([
      "n01-c-00000001",
      "n01-c-00000002",
      "n02-c-00000003",
    ]);
  });

  it("marks cards in the reader's progress, counts them, filters and ends", async () => {
    const { stores, api } = testStores();
    const deck = new DeckStore(chapters, {
      progress: stores.progress,
      sync: stores.sync,
      first: stores.firstShuffle("deck"),
      random: stores.services.random,
    });
    deck.mark("know");
    expect(deck.index).toBe(0);
    deck.show();
    expect(deck.focus).toBe("know");
    deck.mark("know");
    expect(deck.counts).toMatchObject({ know: 1, fresh: 2, total: 3 });
    expect(deck.position).toBe(2);
    expect(deck.focus).toBe("show");
    deck.skip();
    deck.show();
    deck.mark("again");
    expect(deck.current).toBeNull();
    expect(deck.empty).toBe("done");
    expect(deck.focus).toBe("restart");
    await flush();
    expect(api.saveCard).toHaveBeenCalledTimes(2);
    expect(deck.saves).toMatchObject({ saved: 2, unsaved: 0 });
    deck.setMode("again");
    expect(deck.queue).toHaveLength(1);
    expect(deck.index).toBe(0);
    expect(deck.shown).toBe(false);
  });

  it("counts every failed save, not only the last, and retries them all", async () => {
    const saveCard = vi
      .fn<(input: CardInput) => Promise<WriteOutcome>>()
      .mockResolvedValueOnce({ kind: "failed" })
      .mockResolvedValueOnce({ kind: "failed" })
      .mockResolvedValue({ kind: "ok" });
    const { stores } = testStores({}, { api: fakeApi({ saveCard }) });
    const deck = new DeckStore(chapters, {
      progress: stores.progress,
      sync: stores.sync,
      first: stores.firstShuffle("deck"),
      random: stores.services.random,
    });
    deck.show();
    deck.mark("know");
    deck.show();
    deck.mark("again");
    await flush();
    expect(deck.saves).toMatchObject({ unsaved: 2, saved: 0 });
    deck.retryUnsaved();
    await vi.waitFor(() => expect(deck.saves).toMatchObject({ saved: 2 }));
    expect(saveCard).toHaveBeenCalledTimes(4);
  });

  it("Retry takes its button away: focus goes to the status line, unless marks are still offline", async () => {
    const saveCard = vi
      .fn<(input: CardInput) => Promise<WriteOutcome>>()
      .mockResolvedValueOnce({ kind: "failed" })
      .mockResolvedValue({ kind: "ok" });
    const { stores, connection } = testStores(
      {},
      { api: fakeApi({ saveCard }) },
    );
    const deck = new DeckStore(chapters, {
      progress: stores.progress,
      sync: stores.sync,
      first: stores.firstShuffle("deck"),
      random: stores.services.random,
    });
    deck.show();
    deck.mark("know");
    await flush();
    expect(deck.saves.unsaved).toBe(1);
    deck.focusDone();
    // Still offline: the marks stay unsaved and the button stays focused.
    connection.online = false;
    deck.retryUnsaved();
    expect(deck.saves).toMatchObject({ unsaved: 1, offline: true });
    expect(deck.focus).toBeNull();
    // Online: the marks are saving, the button goes, the status line takes focus.
    connection.online = true;
    deck.retryUnsaved();
    expect(deck.saves).toMatchObject({ unsaved: 0, saving: 1 });
    expect(deck.focus).toBe("status");
  });

  it("says why it is empty", () => {
    const { stores } = testStores({
      progress: { ...emptyProgress, cards: { "n02-c-00000003": "know" } },
    });
    const deck = new DeckStore([], {
      progress: stores.progress,
      sync: stores.sync,
      first: stores.firstShuffle("x"),
      random: stores.services.random,
    });
    expect(deck.empty).toBe("none-open");
    const full = new DeckStore(chapters, {
      progress: stores.progress,
      sync: stores.sync,
      first: stores.firstShuffle("x"),
      random: stores.services.random,
    });
    full.setMode("again");
    expect(full.empty).toBe("none-again");
    full.setFilter(2);
    full.setMode("new");
    expect(full.empty).toBe("none-new");
  });
});

describe("SimulatorStore", () => {
  const steps = resolveEventLoopSteps({
    name: "Порядок",
    code: ["console.log('A');", "setTimeout(() => console.log('B'));"],
    steps: [
      { l: 1, ph: "main", stack: ["главный модуль"], out: ["A"] },
      { l: 2, timers: ["log('B')"] },
      { ph: "timers", stack: ["log('B')"], timers: [], out: ["A", "B"] },
    ],
  });
  const scenarios = [
    { name: "Порядок", lines: ["a", "b"], steps },
    { name: "Ещё", lines: ["c"], steps: steps.slice(0, 1) },
  ];

  it("steps through a scenario and reads each state", () => {
    const sim = new SimulatorStore(scenarios);
    expect(sim.atStart).toBe(true);
    sim.back();
    expect(sim.step).toBe(0);
    expect(sim.strip.find((item) => item.on)?.item).toBe("main");
    expect(sim.isHot("stack")).toBe(true);
    sim.next();
    sim.next();
    expect(sim.atEnd).toBe(true);
    sim.next();
    expect(sim.step).toBe(2);
    expect(sim.isHot("timers")).toBe(true);
    expect(sim.fresh).toEqual([false, true]);
    sim.first();
    expect(sim.step).toBe(0);
  });

  it("starts another scenario from its first step", () => {
    const sim = new SimulatorStore(scenarios);
    sim.next();
    sim.pick(1);
    expect(sim.scenario?.name).toBe("Ещё");
    expect(sim.step).toBe(0);
    expect(sim.total).toBe(1);
    sim.pick(7);
    expect(sim.scenarioIndex).toBe(1);
  });
});

const rows = (values: SqlResult["values"]): SqlResult => ({
  columns: ["id", "name"],
  values,
});

describe("SqlSandboxStore", () => {
  it("opens the output on the first run and shows the last result", async () => {
    const runner = fakeRunner((_, sql) =>
      sql.includes("nothing")
        ? { kind: "ok", results: [] }
        : sql.includes("broken")
          ? { kind: "error", message: "no such table: x" }
          : { kind: "ok", results: [rows([[1, "a"]]), rows([[2, "b"]])] },
    );
    const sandbox = new SqlSandboxStore("SELECT 1", { runner, seed: "seed" });
    expect(sandbox.opened).toBe(false);
    const run = sandbox.run();
    expect(sandbox.opened).toBe(true);
    expect(sandbox.running).toBe(true);
    await run;
    expect(sandbox.output).toEqual({
      kind: "result",
      result: rows([[2, "b"]]),
    });
    expect(sandbox.rows).toBe(1);
    sandbox.setQuery("SELECT nothing");
    await sandbox.run();
    expect(sandbox.output).toEqual({ kind: "empty" });
    sandbox.setQuery("broken");
    await sandbox.run();
    expect(sandbox.output).toEqual({
      kind: "failed",
      failure: { kind: "error", message: "no such table: x" },
    });
    sandbox.reset();
    expect(sandbox.query).toBe("SELECT 1");
    expect(runner.run).toHaveBeenLastCalledWith("seed", "SELECT 1");
  });

  it("runs once by itself when it comes near, and announces only the reader's runs", async () => {
    const runner = fakeRunner(() => ({
      kind: "ok",
      results: [rows([[1, "a"]])],
    }));
    const sandbox = new SqlSandboxStore("SELECT 1", { runner, seed: "seed" });
    sandbox.runFirst();
    expect(sandbox.opened).toBe(true);
    expect(sandbox.announced).toBe(false);
    await flush();
    expect(sandbox.rows).toBe(1);
    // Near again (another tab shown, a scroll back): it already ran.
    sandbox.runFirst();
    expect(runner.run).toHaveBeenCalledTimes(1);
    await sandbox.run();
    expect(sandbox.announced).toBe(true);
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it("keeps a run asked for during the first one, with the query as it is then", async () => {
    const first = deferred<RunOutcome>();
    const runner = {
      run: vi
        .fn<SqlRunner["run"]>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue({ kind: "ok", results: [rows([[2, "b"]])] }),
    };
    const sandbox = new SqlSandboxStore("SELECT 1", { runner, seed: "seed" });
    sandbox.runFirst();
    sandbox.setQuery("SELECT 2");
    void sandbox.run();
    expect(runner.run).toHaveBeenCalledTimes(1);
    first.resolve({ kind: "ok", results: [rows([[1, "a"]])] });
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(2));
    expect(runner.run).toHaveBeenLastCalledWith("seed", "SELECT 2");
    await vi.waitFor(() =>
      expect(sandbox.output).toEqual({
        kind: "result",
        result: rows([[2, "b"]]),
      }),
    );
    expect(sandbox.announced).toBe(true);
  });

  it("restores the original only when the reader's own run is not under way", async () => {
    const run = deferred<RunOutcome>();
    const runner = {
      run: vi
        .fn<SqlRunner["run"]>()
        .mockReturnValueOnce(run.promise)
        .mockResolvedValue({ kind: "ok", results: [rows([[1, "a"]])] }),
    };
    const sandbox = new SqlSandboxStore("SELECT 1", { runner, seed: "seed" });
    sandbox.setQuery("SELECT slow");
    void sandbox.run();
    expect(sandbox.busy).toBe(true);
    // From the keyboard too: nothing happens while it runs.
    sandbox.reset();
    expect(sandbox.query).toBe("SELECT slow");
    run.resolve({ kind: "timeout" });
    await vi.waitFor(() => expect(sandbox.busy).toBe(false));
    expect(runner.run).toHaveBeenCalledTimes(1);
    sandbox.reset();
    expect(sandbox.query).toBe("SELECT 1");
    expect(runner.run).toHaveBeenLastCalledWith("seed", "SELECT 1");
  });

  it("offline, says so and runs again once the connection is back", async () => {
    let online = false;
    const runner = fakeRunner(
      (): RunOutcome =>
        online
          ? { kind: "ok", results: [rows([[1, "a"]])] }
          : { kind: "offline" },
    );
    const sandbox = new SqlSandboxStore("SELECT 1", { runner, seed: "seed" });
    sandbox.runFirst();
    await flush();
    expect(sandbox.offline).toBe(true);
    expect(sandbox.announced).toBe(false);
    // Still offline: the retry fails the same way.
    sandbox.reconnected();
    await flush();
    expect(sandbox.offline).toBe(true);
    online = true;
    sandbox.reconnected();
    await flush();
    expect(sandbox.offline).toBe(false);
    expect(sandbox.rows).toBe(1);
    // The automatic run stays unannounced.
    expect(sandbox.announced).toBe(false);
    // Nothing to run again once it ran.
    sandbox.reconnected();
    expect(runner.run).toHaveBeenCalledTimes(3);
  });

  it("says the engine is missing when the page has no database", async () => {
    const sandbox = new SqlSandboxStore("SELECT 1", {
      runner: fakeRunner(() => ({ kind: "ok", results: [] })),
      seed: null,
    });
    await sandbox.run();
    expect(sandbox.output).toEqual({
      kind: "failed",
      failure: { kind: "engine" },
    });
  });
});

describe("SqlTaskStore", () => {
  const solutionResult = rows([
    [1, "Анна"],
    [2, "Борис"],
  ]);
  const task: SqlTaskBlock = {
    t: "sqlTask",
    id: "s01-t-00000001",
    q: [],
    hint: null,
    solution: "SELECT id, name FROM customers",
    ordered: false,
    expected: expectationOf(solutionResult, false),
  };
  const runner = fakeRunner((_, sql) => {
    if (sql === task.solution) return { kind: "ok", results: [solutionResult] };
    if (sql.includes("one"))
      return { kind: "ok", results: [rows([[1, "Анна"]])] };
    if (sql.includes("empty")) return { kind: "ok", results: [] };
    return { kind: "error", message: "near SELEC: syntax error" };
  });

  function make(signedIn = true) {
    const drafts = memoryStorage({ "edu.sql.b.t": "SELECT one" });
    const { stores, api } = testStores({ signedIn, sandboxSeed: "seed" });
    const store = new SqlTaskStore(task, createAttempt(stores, task), {
      runner,
      seed: "seed",
      drafts,
      draftKey: "edu.sql.b.t",
    });
    return { store, api, drafts };
  }

  it("keeps the draft in this browser", () => {
    const { store, drafts } = make();
    expect(store.query).toBe("SELECT ");
    store.restoreDraft();
    expect(store.query).toBe("SELECT one");
    store.setQuery("SELECT 2");
    expect(drafts.data.get("edu.sql.b.t")).toBe("SELECT 2");
    store.insertSolution();
    expect(store.query).toBe(task.solution);
    expect(store.editorFocus).toBe(1);
  });

  it("sends the result to the server and explains locally what differs", async () => {
    const { store, api } = make();
    store.setQuery("SELECT one");
    const check = store.check();
    expect(store.busy).toBe(true);
    await check;
    await flush();
    expect(api.submitAttempt.mock.calls[0]?.[0].attempt).toEqual({
      kind: "sqlTask",
      ...reportOf(rows([[1, "Анна"]])),
    });
    // The fake server says right: the server decides, the comparison only explains.
    expect(store.attempt.verdict).toMatchObject({
      correct: true,
      source: "server",
    });
    expect(store.run).toMatchObject({
      kind: "result",
      sql: "SELECT one",
      comparison: { ok: false, reason: "rows", mine: 1, expected: 2 },
      referenceRan: true,
      referenceFailure: null,
    });
    expect(store.expectedShown).toBeNull();
    expect(store.outcome).toEqual({ kind: "right" });
  });

  it("says what differs when the server calls it wrong", async () => {
    const { stores } = testStores(
      { sandboxSeed: "seed" },
      {
        api: fakeApi({
          submitAttempt: vi.fn(async () => ({
            kind: "ok" as const,
            correct: false,
            solved: false,
          })),
        }),
      },
    );
    const store = new SqlTaskStore(task, createAttempt(stores, task), {
      runner,
      seed: "seed",
      drafts: memoryStorage(),
      draftKey: "k",
    });
    store.setQuery("SELECT one");
    const check = store.check();
    expect(store.outcome).toEqual({ kind: "checking" });
    await check;
    await flush();
    expect(store.outcome).toEqual({
      kind: "wrong",
      reason: { kind: "rows", mine: 1, expected: 2 },
    });
    expect(store.expectedShown).toEqual(solutionResult);
    store.setQuery("SELECT empty");
    await store.check();
    expect(store.outcome).toEqual({ kind: "no-result" });
  });

  it("does not send a query that failed or returned nothing", async () => {
    const { store, api } = make();
    store.setQuery("SELEC");
    await store.check();
    expect(store.run).toEqual({
      kind: "failed",
      sql: "SELEC",
      failure: { kind: "error", message: "near SELEC: syntax error" },
    });
    store.setQuery("SELECT empty");
    await store.check();
    expect(store.run).toEqual({ kind: "no-result", sql: "SELECT empty" });
    expect(store.checks).toBe(2);
    expect(api.submitAttempt).not.toHaveBeenCalled();
  });

  it("offline, the check waits: the same query is checked again once the connection is back", async () => {
    let online = false;
    const offlineRunner = fakeRunner((seed, sql) =>
      online ? runner.run(seed, sql) : { kind: "offline" },
    );
    const { stores, api } = testStores({ sandboxSeed: "seed" });
    const store = new SqlTaskStore(task, createAttempt(stores, task), {
      runner: offlineRunner,
      seed: "seed",
      drafts: memoryStorage(),
      draftKey: "k",
    });
    store.setQuery("SELECT one");
    await store.check();
    expect(store.offline).toBe(true);
    expect(store.run).toEqual({
      kind: "failed",
      sql: "SELECT one",
      failure: { kind: "offline" },
    });
    expect(store.outcome).toBeNull();
    expect(api.submitAttempt).not.toHaveBeenCalled();
    // The reader edits meanwhile; the retry checks the query that waited.
    store.setQuery("SELECT edited");
    online = true;
    store.reconnected();
    await vi.waitFor(() => expect(store.run?.kind).toBe("result"));
    expect(store.run?.sql).toBe("SELECT one");
    expect(store.checks).toBe(2);
    await vi.waitFor(() => expect(api.submitAttempt).toHaveBeenCalledTimes(1));
    // Nothing waits any more.
    await store.retry();
    expect(store.checks).toBe(2);
  });

  it("signed out, judges by the fingerprint on this device", async () => {
    const { store, api } = make(false);
    store.setQuery("SELECT one");
    await store.check();
    expect(store.attempt.verdict).toEqual({
      state: "decided",
      correct: false,
      source: "local",
    });
    expect(store.expectedShown).toEqual(solutionResult);
    store.setQuery(task.solution);
    await store.check();
    expect(store.attempt.verdict).toMatchObject({
      correct: true,
      source: "local",
    });
    expect(api.submitAttempt).not.toHaveBeenCalled();
  });

  it("says why the solution did not run, with SQLite's own words", async () => {
    const broken: SqlTaskBlock = { ...task, solution: "SELECT broken" };
    const { stores } = testStores({ signedIn: false, sandboxSeed: "seed" }, {});
    const store = new SqlTaskStore(broken, createAttempt(stores, broken), {
      runner: fakeRunner((_, sql) =>
        sql === "SELECT broken"
          ? { kind: "error", message: "no such column: broken" }
          : { kind: "ok", results: [rows([[1, "Анна"]])] },
      ),
      seed: "seed",
      drafts: memoryStorage(),
      draftKey: "k",
    });
    store.setQuery("SELECT one");
    await store.check();
    expect(store.outcome).toEqual({
      kind: "wrong",
      reason: {
        kind: "reference-failed",
        failure: { kind: "error", message: "no such column: broken" },
      },
    });
  });

  it("grows the editor with the query, not with the draft it restores", () => {
    const { store } = make();
    expect(store.editorRows).toBe(5);
    store.restoreDraft();
    expect(store.editorRows).toBe(5);
    const lines = (count: number) =>
      Array.from({ length: count }, (_, i) => `-- ${i}`).join("\n");
    store.setQuery(lines(9));
    expect(store.editorRows).toBe(10);
    store.setQuery(lines(40));
    expect(store.editorRows).toBe(16);
    store.setQuery("SELECT 1");
    expect(store.editorRows).toBe(5);
  });

  it("opens and closes the hint and the solution", () => {
    const { store } = make();
    store.toggleHint();
    store.toggleSolution();
    expect([store.hintOpen, store.solutionOpen]).toEqual([true, true]);
    store.toggleHint();
    store.toggleSolution();
    expect([store.hintOpen, store.solutionOpen]).toEqual([false, false]);
  });
});

describe("ExplainPreferenceStore", () => {
  it("signed out, keeps a valid view in this browser only", () => {
    const storage = memoryStorage({ [EXPLAIN_VIEW_KEY]: "steps" });
    const { stores, api } = testStores(
      { signedIn: false, progress: null },
      { storage },
    );
    expect(stores.explain.view).toBeNull();
    stores.explain.restore();
    expect(stores.explain.view).toBe("steps");
    stores.explain.choose("deep");
    expect(storage.data.get(EXPLAIN_VIEW_KEY)).toBe("deep");
    expect(api.savePosition).not.toHaveBeenCalled();
    storage.data.set(EXPLAIN_VIEW_KEY, "nonsense");
    stores.explain.restore();
    expect(stores.explain.view).toBe("deep");
  });

  it("signed in, comes with the page and is saved to the account", () => {
    const storage = memoryStorage({ [EXPLAIN_VIEW_KEY]: "steps" });
    const { stores, api } = testStores(
      { progress: { ...emptyProgress, explainView: "code" } },
      { storage },
    );
    stores.explain.restore();
    expect(stores.explain.view).toBe("code");
    stores.explain.choose("analogy");
    expect(api.savePosition).toHaveBeenCalledWith({
      slug: "nodejs-internals",
      explainView: "analogy",
    });
    expect(storage.data.get(EXPLAIN_VIEW_KEY)).toBe("steps");
  });
});

describe("MobX observers and the React Compiler", () => {
  it('every observer component opts out with "use no memo"', () => {
    const root = path.resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".tsx")) files.push(full);
      }
    };
    walk(root);
    const offenders: string[] = [];
    let observers = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(
        /observer\(\s*function\s+(\w+)\s*\(/g,
      )) {
        observers++;
        // Skip the parameter list (it may hold parentheses of its own).
        let depth = 1;
        let i = (match.index ?? 0) + match[0].length;
        while (depth > 0 && i < text.length) {
          if (text[i] === "(") depth++;
          else if (text[i] === ")") depth--;
          i++;
        }
        const body = text.slice(text.indexOf("{", i) + 1).trimStart();
        if (!/^["']use no memo["']/.test(body))
          offenders.push(`${path.relative(root, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(observers).toBeGreaterThan(10);
  });
});
