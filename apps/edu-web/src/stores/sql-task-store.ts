import {
  type Comparison,
  compareResults,
  lastResult,
  reportOf,
  type SqlResult,
  type SqlTaskBlock,
} from "@outegro/edu-engine";
import { makeAutoObservable, observable, runInAction } from "mobx";
import type { KeyValueStorage } from "@/lib/browser";
import type { RunFailure, SqlRunner } from "@/lib/sql/engine";
import type { AttemptStore } from "./attempt-store";

/** A new task starts the query with this. */
export const FIRST_LINE = "SELECT ";
/** The task editor's rows: this many at first, growing with the query up to MAX. */
export const EDITOR_ROWS = 5;
export const EDITOR_MAX_ROWS = 16;

/** Rows for a query the reader is writing: its lines plus one, 5 to 16. */
export function taskEditorRows(query: string): number {
  return Math.min(
    EDITOR_MAX_ROWS,
    Math.max(EDITOR_ROWS, query.split("\n").length + 1),
  );
}

/** What the reader's last check ran into, on this device; `sql` is the query checked. */
export type TaskRun =
  /** The query ran: the reader's result, then the solution's to compare. */
  | {
      kind: "result";
      sql: string;
      mine: SqlResult;
      /** null until the solution ran, or when it could not run. */
      expected: SqlResult | null;
      /** What differs from the solution's result; it never decides. */
      comparison: Exclude<Comparison, { ok: true }> | null;
      referenceRan: boolean;
      /** Why the solution did not run here, when it did not. */
      referenceFailure: RunFailure | null;
    }
  /** The query ran and returned nothing: not an attempt yet. */
  | { kind: "no-result"; sql: string }
  /** The query did not run (an SQLite error, too slow, the engine). */
  | { kind: "failed"; sql: string; failure: RunFailure };

/** Why a result is not the solution's, as the comparison on this device sees it. */
export type WrongReason =
  | { kind: "columns" | "rows"; mine: number; expected: number }
  | { kind: "values" | "order" | "no-result" }
  /** The solution did not run here: no difference to show, only why. */
  | { kind: "reference-failed"; failure: RunFailure };

/** What the result line says about the last check. */
export type TaskOutcome =
  | { kind: "checking" }
  /** The query returned nothing: not an attempt yet. */
  | { kind: "no-result" }
  | { kind: "right" }
  | { kind: "wrong"; reason: WrongReason | null };

type Deps = {
  runner: SqlRunner;
  seed: string | null;
  /** Where the draft is kept in this browser. */
  drafts: KeyValueStorage;
  draftKey: string;
};

/**
 * An SQL task. The reader's query runs on this device; its result goes to
 * the attempt, and edu-backend compares it with the solution's fingerprint
 * (the server decides). The solution also runs here, only to say WHAT
 * differs: columns, rows, values or order. A check the engine could not
 * run because the browser was offline runs again, with the same query,
 * once the connection is back (or when the reader retries). The draft
 * stays in this browser; the hint and the solution open and close.
 */
export class SqlTaskStore {
  query = FIRST_LINE;
  running = false;
  run: TaskRun | null = null;
  /** The output panel is shown (from the first check on). */
  opened = false;
  hintOpen = false;
  solutionOpen = false;
  /** Bumped when the editor should take focus (after inserting the solution). */
  editorFocus = 0;
  /** Checks so far on this page: a new one starts a new result. */
  checks = 0;
  /**
   * The editor's rows: the same at first whatever the draft (nothing moves
   * on load), then growing with what the reader writes, up to 16.
   */
  editorRows = EDITOR_ROWS;
  readonly task: SqlTaskBlock;
  readonly attempt: AttemptStore;
  private readonly deps: Deps;

  constructor(task: SqlTaskBlock, attempt: AttemptStore, deps: Deps) {
    this.task = task;
    this.attempt = attempt;
    this.deps = deps;
    makeAutoObservable<this, "deps">(
      this,
      { run: observable.ref, task: false, attempt: false, deps: false },
      { autoBind: true },
    );
  }

  /** A check is under way: the query runs here or the server is checking. */
  get busy(): boolean {
    return this.running || this.attempt.checking;
  }

  /** The last check could not load the engine: the browser was offline. */
  get offline(): boolean {
    return this.run?.kind === "failed" && this.run.failure.kind === "offline";
  }

  /** The solution's result, shown next to the reader's once it is wrong. */
  get expectedShown(): SqlResult | null {
    const verdict = this.attempt.verdict;
    if (this.run?.kind !== "result" || verdict?.state !== "decided")
      return null;
    return verdict.correct ? null : this.run.expected;
  }

  /**
   * The verdict is the attempt's (the server's when it answered); the
   * reason it is wrong comes from the comparison on this device.
   */
  get outcome(): TaskOutcome | null {
    if (this.busy) return { kind: "checking" };
    const run = this.run;
    if (run?.kind === "no-result") return { kind: "no-result" };
    const verdict = this.attempt.verdict;
    if (run?.kind !== "result" || verdict?.state !== "decided") return null;
    if (verdict.correct) return { kind: "right" };
    const comparison = run.comparison;
    if (comparison)
      return {
        kind: "wrong",
        reason:
          comparison.reason === "columns" || comparison.reason === "rows"
            ? {
                kind: comparison.reason,
                mine: comparison.mine,
                expected: comparison.expected,
              }
            : { kind: comparison.reason },
      };
    return {
      kind: "wrong",
      reason:
        run.referenceRan && !run.expected && run.referenceFailure
          ? { kind: "reference-failed", failure: run.referenceFailure }
          : null,
    };
  }

  /** The draft kept in this browser, once the page runs. */
  restoreDraft() {
    const draft = this.deps.drafts.get(this.deps.draftKey);
    if (draft !== null) this.query = draft;
  }

  /** The reader edits the query: the draft is kept, the editor grows with it. */
  setQuery(text: string) {
    this.query = text;
    this.editorRows = taskEditorRows(text);
    this.deps.drafts.set(this.deps.draftKey, text);
  }

  toggleHint() {
    this.hintOpen = !this.hintOpen;
  }

  toggleSolution() {
    this.solutionOpen = !this.solutionOpen;
  }

  insertSolution() {
    this.setQuery(this.task.solution);
    this.editorFocus += 1;
  }

  /** Checks the query in the editor. */
  check() {
    return this.checkQuery(this.query);
  }

  /** Checks again the query the offline engine could not run. */
  retry() {
    const run = this.run;
    if (!this.offline || run === null) return Promise.resolve();
    return this.checkQuery(run.sql);
  }

  /** The connection is back: a check the offline engine could not run runs now. */
  reconnected() {
    void this.retry();
  }

  private async checkQuery(sql: string) {
    if (this.busy) return;
    // A new check: the last verdict no longer speaks for the query.
    this.attempt.clear();
    this.opened = true;
    this.checks += 1;
    const { seed, runner } = this.deps;
    if (!seed) {
      this.run = { kind: "failed", sql, failure: { kind: "engine" } };
      return;
    }
    this.running = true;
    const mine = await runner.run(seed, sql);
    const result = mine.kind === "ok" ? lastResult(mine.results) : null;
    runInAction(() => {
      if (mine.kind !== "ok") {
        this.running = false;
        this.run = { kind: "failed", sql, failure: mine };
        return;
      }
      if (!result) {
        this.running = false;
        this.run = { kind: "no-result", sql };
        return;
      }
      this.run = Object.freeze({
        kind: "result",
        sql,
        mine: Object.freeze(result),
        expected: null,
        comparison: null,
        referenceRan: false,
        referenceFailure: null,
      });
      this.attempt.submit({ kind: "sqlTask", ...reportOf(result) });
    });
    if (!result) return;
    const reference = await runner.run(seed, this.task.solution);
    runInAction(() => {
      this.running = false;
      const current = this.run;
      if (current?.kind !== "result" || current.mine !== result) return;
      const expected =
        reference.kind === "ok" ? lastResult(reference.results) : null;
      const comparison = expected
        ? compareResults(result, expected, this.task.ordered)
        : null;
      this.run = Object.freeze({
        ...current,
        expected: expected ? Object.freeze(expected) : null,
        comparison: comparison && !comparison.ok ? comparison : null,
        referenceRan: true,
        referenceFailure: reference.kind === "ok" ? null : reference,
      });
    });
  }
}
