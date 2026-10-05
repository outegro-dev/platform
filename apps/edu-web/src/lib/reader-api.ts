import type {
  CardState,
  ExerciseAttempt,
  ExplainKind,
} from "@outegro/contracts/edu";

/*
 * The reader's writes as the browser reaches them: server actions in
 * app/actions.ts (the token never leaves the server). Stores get this API
 * through their constructors, so they run on fakes in unit tests.
 */

/** Why a write did not reach the reader's account. */
export type WriteFailure =
  /** The session ended (401): sign in again. */
  | "signed-out"
  /** The network or the service failed: the same request may be sent again. */
  | "failed"
  /** The chapter is no longer open to the reader (403). */
  | "forbidden"
  /** The book or the exercise is gone (404): the page is out of date. */
  | "not-found"
  /** The service refused the request as it is (400, 409, 422). */
  | "invalid"
  /**
   * Larger than edu-backend takes (an SQL task's result past 96 kB, or
   * 413): never sent again as it is — a narrower query is another attempt.
   */
  | "too-large";

/** Failures a retry of the same request can never fix. */
export const permanentFailures: readonly WriteFailure[] = [
  "forbidden",
  "not-found",
  "invalid",
  "too-large",
];

export const isPermanent = (failure: WriteFailure) =>
  permanentFailures.includes(failure);

export type WriteOutcome = { kind: "ok" } | { kind: WriteFailure };

/** The server's verdict on an attempt, or why there is none. */
export type AttemptOutcome =
  | { kind: "ok"; correct: boolean; solved: boolean }
  | { kind: WriteFailure };

export type AttemptInput = {
  slug: string;
  id: string;
  attempt: ExerciseAttempt;
  /** One per attempt; a retry of the same attempt sends the same key. */
  idempotencyKey: string;
};

export type CardInput = {
  slug: string;
  id: string;
  state: CardState;
  /** One per mark; a retry of the same mark sends the same key. */
  idempotencyKey: string;
};

export type PositionInput = {
  slug: string;
  lastChapter?: number;
  explainView?: ExplainKind;
};

export type ReaderApi = {
  submitAttempt(input: AttemptInput): Promise<AttemptOutcome>;
  saveCard(input: CardInput): Promise<WriteOutcome>;
  savePosition(input: PositionInput): Promise<WriteOutcome>;
};
