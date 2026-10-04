import { createHash } from "node:crypto";
import type { ExerciseAttempt } from "@outegro/contracts/edu";

/** A reader's stored result of one exercise. */
export type ExerciseResult = {
  readonly solved: boolean;
  readonly attempts: number;
  /** When the first correct answer came; null while unsolved. */
  readonly firstSolvedAt: Date | null;
};

/**
 * Applies one answer: every answer is an attempt, a solved exercise stays
 * solved whatever comes next, and the first correct answer is remembered.
 */
export function recordAnswer(
  previous: ExerciseResult | null,
  solved: boolean,
  now: Date,
): ExerciseResult {
  return {
    solved: (previous?.solved ?? false) || solved,
    attempts: (previous?.attempts ?? 0) + 1,
    firstSolvedAt: previous?.firstSolvedAt ?? (solved ? now : null),
  };
}

/**
 * What an attempt said, as a hash: a retried request with the same
 * Idempotency-Key must carry the same attempt. The attempt is the validated
 * one, so its keys come in the contract's order.
 */
export function attemptFingerprint(attempt: ExerciseAttempt): string {
  return createHash("sha256").update(JSON.stringify(attempt)).digest("hex");
}

/** The stored side of an idempotent write: the key of the last request. */
export type LastRequest<T> = {
  readonly key: string | null;
  /** What that request sent (a fingerprint or the value itself). */
  readonly body: T | null;
};

/**
 * A request with the key of the last one is a retry: the same body replays
 * the stored outcome, another body is a conflict (409). No key, or another
 * key, is a new request.
 */
export function retryOf<T>(
  last: LastRequest<T> | null,
  key: string | null,
  body: T,
): "new" | "replay" | "conflict" {
  if (key === null || last?.key !== key) return "new";
  return last.body === body ? "replay" : "conflict";
}
