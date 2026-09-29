import { AsyncLocalStorage } from "node:async_hooks";

/** What the work in progress is part of: an HTTP request or a consumed event. */
export type Correlation = {
  /** The whole chain: the request id, or the id of the first event. */
  correlationId: string;
  /** The direct cause of what is written now: the request or the consumed event. */
  causationId: string;
};

const current = new AsyncLocalStorage<Correlation>();
// Taken at import, outside any request or event.
const detached = AsyncLocalStorage.snapshot();

/** Runs `fn` (and everything it awaits) as part of `correlation`. */
export function runWithCorrelation<T>(correlation: Correlation, fn: () => T) {
  return current.run(correlation, fn);
}

export function currentCorrelation(): Correlation | undefined {
  return current.getStore();
}

/**
 * Runs `fn` outside any request or event context. Loops kicked from a
 * request (outbox relay, workers) schedule their timers through it, or every
 * later pass would inherit that request's correlation and log fields.
 */
export function runDetached<T>(fn: () => T): T {
  return detached(fn);
}
