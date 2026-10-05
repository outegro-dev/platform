import type { SqlResult } from "@outegro/edu-engine";

/** What the page asks the SQL worker: run `sql` on a fresh copy of `seed`. */
export type RunRequest = { id: number; seed: string; sql: string };

/** What the SQL worker answers, in order: started, then done or error. */
export type WorkerMessage =
  | { id: number; type: "started" }
  | { id: number; type: "done"; results: SqlResult[] }
  /** `fatal`: the engine aborted (out of memory) and this worker is spent. */
  | { id: number; type: "error"; message: string; fatal: boolean };
