import type { AssistSqlHint } from "@outegro/contracts/edu";
import { normalizedRows, type SqlResult } from "@outegro/edu-engine";
import { makeAutoObservable, reaction } from "mobx";
import { jsonBytes } from "@/lib/body-size";
import type { AnswerStore } from "./answer-store";
import type { SqlTaskStore } from "./sql-task-store";

/** The reader's result the hint sends: the first rows only… */
export const HINT_ROWS = 8;
/**
 * …and at most this many bytes of them (as JSON), so the whole hint stays
 * far under edu-backend's limit whatever the cells hold.
 */
export const HINT_PREVIEW_BYTES = 16 * 1024;
const MAX_COLUMNS = 50;
const MAX_CELL = 200;
/** Rows kept before cells are shortened, and the shortest a cell gets. */
const FEW_ROWS = 3;
const SHORT_CELL = 20;
const MAX_SQL = 4000;
const MAX_DETAIL = 500;

type Preview = NonNullable<AssistSqlHint["mine"]>;

/**
 * The start of the reader's result, cells normalized as the engine does:
 * at most HINT_ROWS rows, 50 columns and 200 characters a cell, within
 * HINT_PREVIEW_BYTES. Over the bytes, rows go first (down to a few), then
 * cells get shorter, then the last rows go too; the row count stays whole.
 */
export function resultPreview(result: SqlResult): Preview {
  const columns = result.columns.slice(0, MAX_COLUMNS);
  const rows = normalizedRows(result)
    .slice(0, HINT_ROWS)
    .map((row) => row.slice(0, MAX_COLUMNS));
  const rowCount = result.values.length;
  let kept = rows.length;
  let cell = MAX_CELL;
  const build = (): Preview => ({
    columns: columns.map((column) => column.slice(0, cell)),
    rows: rows
      .slice(0, kept)
      .map((row) => row.map((value) => value.slice(0, cell))),
    rowCount,
  });
  let preview = build();
  while (jsonBytes(preview) > HINT_PREVIEW_BYTES) {
    if (kept > FEW_ROWS) kept--;
    else if (cell > SHORT_CELL) cell = Math.max(SHORT_CELL, cell >> 1);
    else if (kept > 0) kept--;
    else break;
    preview = build();
  }
  return preview;
}

/**
 * What a hint would be asked about after the task's last check, or null
 * when there is nothing to ask: no check yet, still checking, right, a
 * failure of the sandbox itself (too slow, the engine, offline), or the
 * solution did not run here (there is no difference to explain).
 */
export function hintRequest(task: SqlTaskStore): AssistSqlHint | null {
  const run = task.run;
  if (!run || task.busy) return null;
  const base = { exerciseId: task.task.id, sql: run.sql.slice(0, MAX_SQL) };
  if (run.sql.trim() === "") return null;
  if (run.kind === "failed")
    return run.failure.kind === "error"
      ? {
          ...base,
          problem: "error",
          detail: run.failure.message.slice(0, MAX_DETAIL),
        }
      : null;
  if (run.kind === "no-result") return { ...base, problem: "empty" };
  const outcome = task.outcome;
  if (outcome?.kind !== "wrong" || !outcome.reason) return null;
  switch (outcome.reason.kind) {
    case "columns":
    case "rows":
    case "values":
    case "order":
      return {
        ...base,
        problem: outcome.reason.kind,
        mine: resultPreview(run.mine),
      };
    default:
      return null;
  }
}

/**
 * "What is wrong with my query" under an SQL task that failed its check
 * (an SQLite error, no result, or a result unlike the solution's). At most
 * one hint comes per check: once one is under way or came, the next check
 * offers it again and drops the last hint; one the reader stopped may be
 * asked again. The query sent is the one checked, not what the editor
 * holds now. The task's checks are followed between `start` and `stop`
 * (the component's effect and its cleanup).
 */
export class SqlHintStore {
  /** The check the hint was asked about. */
  private askedAt: number | null = null;
  readonly answer: AnswerStore<"sql-hint">;
  private readonly task: SqlTaskStore;
  private stopWatching: (() => void) | null = null;

  constructor(task: SqlTaskStore, answer: AnswerStore<"sql-hint">) {
    this.task = task;
    this.answer = answer;
    makeAutoObservable<this, "task" | "stopWatching">(
      this,
      { answer: false, task: false, stopWatching: false },
      { autoBind: true },
    );
  }

  /** The body a hint would be asked with now, or null when none is offered. */
  get request(): AssistSqlHint | null {
    return hintRequest(this.task);
  }

  get offered(): boolean {
    return this.request !== null;
  }

  /**
   * A hint about this check is under way or came: the button waits for the
   * next check. After Stop it may be asked again.
   */
  get used(): boolean {
    return this.askedAt === this.task.checks && this.answer.phase !== "stopped";
  }

  ask() {
    const body = this.request;
    if (!body || this.used) return;
    this.askedAt = this.task.checks;
    void this.answer.ask(body);
  }

  /** Follows the task's checks: a new check drops the hint about the last one. */
  start() {
    if (this.stopWatching) return;
    this.stopWatching = reaction(
      () => this.task.checks,
      () => this.answer.reset(),
    );
  }

  /** Stops following them and drops an answer still coming. */
  stop() {
    this.stopWatching?.();
    this.stopWatching = null;
    this.answer.dispose();
  }
}
