import { lastResult, type SqlResult } from "@outegro/edu-engine";
import { makeAutoObservable, observable, runInAction } from "mobx";
import type { RunFailure, SqlRunner } from "@/lib/sql/engine";

export type SandboxOutput =
  | { kind: "result"; result: SqlResult }
  /** The query ran and returned no rows: nothing to show. */
  | { kind: "empty" }
  | { kind: "failed"; failure: RunFailure };

type Deps = {
  runner: SqlRunner;
  /** The book's training database; null where the page has none. */
  seed: string | null;
};

/**
 * A query the reader can edit and run on the book's training database
 * (SQLite in a worker, a fresh copy for every run). It runs once by itself
 * when it first comes near the screen (as the book's pages did), so the
 * reader finds its result there; while a run is under way the previous
 * output stays, dimmed. A run the reader asks for while another is under
 * way (the first, automatic one, still loading the engine) goes next,
 * with the query as it is then: it is never lost. "Restore the original"
 * waits for the reader's own run to end. A run the engine could not do
 * because the browser was offline runs again once the connection is back
 * (or when the reader retries). Only the reader's own runs are announced.
 */
export class SqlSandboxStore {
  query: string;
  running = false;
  output: SandboxOutput | null = null;
  /** A run was asked for (by the reader, or the first one by itself). */
  opened = false;
  /** The last run was the reader's: its result is announced. */
  announced = false;
  /** The reader asked for a run while one was under way: it goes next. */
  private queued = false;
  readonly initial: string;
  private readonly deps: Deps;

  constructor(initial: string, deps: Deps) {
    this.initial = initial;
    this.query = initial;
    this.deps = deps;
    makeAutoObservable<this, "deps" | "queued">(
      this,
      { output: observable.ref, initial: false, deps: false, queued: false },
      { autoBind: true },
    );
  }

  get rows(): number | null {
    return this.output?.kind === "result"
      ? this.output.result.values.length
      : null;
  }

  /** The reader's own run is under way: Run shows it, and the controls wait. */
  get busy(): boolean {
    return this.running && this.announced;
  }

  /** The last run could not load the engine: the browser was offline. */
  get offline(): boolean {
    return (
      this.output?.kind === "failed" && this.output.failure.kind === "offline"
    );
  }

  setQuery(text: string) {
    this.query = text;
  }

  /** The first run, once the sandbox comes near the screen; nothing if one ran. */
  runFirst() {
    if (this.opened) return;
    void this.execute(false);
  }

  /** The reader runs the query. */
  run() {
    return this.execute(true);
  }

  /** Back to the book's query, and run it — not while the reader's own run is under way. */
  reset() {
    if (this.busy) return;
    this.query = this.initial;
    void this.run();
  }

  /** The connection is back: a run the offline engine could not do runs again. */
  reconnected() {
    if (!this.offline || this.running) return;
    void this.execute(this.announced);
  }

  private async execute(byReader: boolean): Promise<void> {
    if (this.running) {
      if (byReader) this.queued = true;
      return;
    }
    this.opened = true;
    this.announced = byReader;
    const { seed, runner } = this.deps;
    if (!seed) {
      this.output = { kind: "failed", failure: { kind: "engine" } };
      return;
    }
    this.running = true;
    const outcome = await runner.run(seed, this.query);
    runInAction(() => {
      this.running = false;
      if (outcome.kind !== "ok") {
        this.output = { kind: "failed", failure: outcome };
        return;
      }
      const result = lastResult(outcome.results);
      this.output = result
        ? { kind: "result", result: Object.freeze(result) }
        : { kind: "empty" };
    });
    if (this.queued) {
      this.queued = false;
      await this.execute(true);
    }
  }
}
