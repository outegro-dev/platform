import type { SqlResult } from "@outegro/edu-engine";
import { browserIsOnline } from "@/lib/browser";
import type { RunRequest, WorkerMessage } from "./protocol";

/** How a run ended, for the sandbox and the task check. */
export type RunOutcome =
  | { kind: "ok"; results: SqlResult[] }
  /** SQLite refused the query (syntax, missing table…). */
  | { kind: "error"; message: string }
  /** The query ran longer than QUERY_TIMEOUT_MS and was stopped. */
  | { kind: "timeout" }
  /** The query exhausted the engine's memory; the worker was replaced. */
  | { kind: "aborted" }
  /**
   * The engine could not load because the browser is offline: the next
   * run, once the connection is back, loads it.
   */
  | { kind: "offline" }
  /** The engine could not start (the worker did not load). */
  | { kind: "engine" };

/** A run that produced no result. */
export type RunFailure = Exclude<RunOutcome, { kind: "ok" }>;

/** Runs SQL on a fresh copy of a seed (the worker, or a fake in tests). */
export type SqlRunner = {
  run(seed: string, sql: string): Promise<RunOutcome>;
};

/** A query may run this long; an endless recursive CTE is stopped. */
export const QUERY_TIMEOUT_MS = 3000;
/** Loading the 1.3 MB engine on a slow connection may take this long. */
const START_TIMEOUT_MS = 30_000;

/**
 * The page's side of the SQL worker. The worker starts on the first run
 * (the engine is never downloaded for readers who do not run anything),
 * runs one query at a time, and is terminated and replaced when a query
 * runs too long or the engine aborts. An engine that fails to load while
 * the browser is offline is "offline", not broken: a worker that failed is
 * dropped, so the next run starts a new one and loads the engine again.
 */
export class SqlEngine {
  private worker: Worker | null = null;
  private sequence = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly spawn: () => Worker,
    private readonly isOnline: () => boolean = () => true,
  ) {}

  /** Runs `sql` on a fresh database built from `seed`. */
  run(seed: string, sql: string): Promise<RunOutcome> {
    const task = this.queue.then(() => this.execute(seed, sql));
    this.queue = task.catch(() => undefined);
    return task;
  }

  /** The engine did not start: offline, or broken. */
  private notStarted(): RunOutcome {
    return this.isOnline() ? { kind: "engine" } : { kind: "offline" };
  }

  private execute(seed: string, sql: string): Promise<RunOutcome> {
    return new Promise((resolve) => {
      let worker: Worker;
      try {
        this.worker ??= this.spawn();
        worker = this.worker;
      } catch {
        resolve(this.notStarted());
        return;
      }
      const id = ++this.sequence;
      let started = false;
      const finish = (outcome: RunOutcome, terminate: boolean) => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (terminate) this.terminate(worker);
        resolve(outcome.kind === "engine" ? this.notStarted() : outcome);
      };
      let timer = setTimeout(
        () => finish({ kind: "engine" }, true),
        START_TIMEOUT_MS,
      );
      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.type === "started") {
          started = true;
          clearTimeout(timer);
          timer = setTimeout(
            () => finish({ kind: "timeout" }, true),
            QUERY_TIMEOUT_MS,
          );
        } else if (message.type === "done") {
          finish({ kind: "ok", results: message.results }, false);
        } else {
          const outcome: RunOutcome = !message.fatal
            ? { kind: "error", message: message.message }
            : started
              ? { kind: "aborted" }
              : { kind: "engine" };
          finish(outcome, message.fatal);
        }
      };
      const onError = (event: ErrorEvent) => {
        event.preventDefault();
        finish({ kind: "engine" }, true);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ id, seed, sql } satisfies RunRequest);
    });
  }

  private terminate(worker: Worker) {
    worker.terminate();
    if (this.worker === worker) this.worker = null;
  }
}

let shared: SqlEngine | null = null;

/** The page's one engine (created on first use, in the browser only). */
export function sqlEngine(): SqlEngine {
  // The bundler turns this into a worker entry of its own (sql.js inside),
  // fetched from this origin only when the first query runs.
  shared ??= new SqlEngine(
    () => new Worker(new URL("./sql.worker.ts", import.meta.url)),
    browserIsOnline,
  );
  return shared;
}
