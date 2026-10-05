import {
  type AssistExplain,
  type AssistSqlHint,
  type AssistUnderstanding,
  assistExplainSchema,
  assistSqlHintSchema,
  assistUnderstandingSchema,
} from "@outegro/contracts/edu";

/*
 * The reading assistant between the browser and this app's BFF: the three
 * kinds of request with the bodies the contract defines for them, and why
 * one may be refused before an answer starts. The route handler and the
 * browser's transport share it; edu-backend's own error bodies never reach
 * the browser.
 */

export const assistKinds = ["explain", "understanding", "sql-hint"] as const;
export type AssistKind = (typeof assistKinds)[number];

/** The body of each kind of request (`@outegro/contracts/edu`). */
export type AssistBodies = {
  explain: AssistExplain;
  understanding: AssistUnderstanding;
  "sql-hint": AssistSqlHint;
};

/** The contract's schema for each kind: the BFF checks every body with it. */
export const assistBodySchemas = {
  explain: assistExplainSchema,
  understanding: assistUnderstandingSchema,
  "sql-hint": assistSqlHintSchema,
} as const;

export const isAssistKind = (value: string): value is AssistKind =>
  (assistKinds as readonly string[]).includes(value);

/** Why an answer did not start: a JSON error before the stream. */
export type AssistRefusal =
  /** 401: no session, or the chapter needs sign-in. */
  | "signed-out"
  /** 403: the account is suspended, or the chapter is closed to the reader. */
  | "forbidden"
  /** 404: the book, chapter, section or task is not there (an old page). */
  | "not-found"
  /** 400: the request is not one the contract accepts. */
  | "invalid"
  /** 413: the body is larger than edu-backend takes; it never will be smaller. */
  | "too-large"
  /** 503 "disabled": the owner turned the assistant off (or SAFE_MODE). */
  | "disabled"
  /** 429 "daily_limit": today's answers are used up. */
  | "daily-limit"
  /**
   * 503 "paused": the day's answers of all readers together are used up;
   * the assistant is back tomorrow (answers from the cache still come).
   */
  | "paused"
  /** 503 "busy": every model slot stayed taken; a retry may get one. */
  | "busy"
  /** edu-backend did not answer, or answered outside the contract. */
  | "unavailable";

export const assistRefusals: readonly AssistRefusal[] = [
  "signed-out",
  "forbidden",
  "not-found",
  "invalid",
  "too-large",
  "disabled",
  "daily-limit",
  "paused",
  "busy",
  "unavailable",
];

export const isAssistRefusal = (value: unknown): value is AssistRefusal =>
  assistRefusals.includes(value as AssistRefusal);

/** The HTTP status the BFF answers a refusal with. */
export const refusalStatus: Readonly<Record<AssistRefusal, number>> = {
  "signed-out": 401,
  forbidden: 403,
  "not-found": 404,
  invalid: 400,
  "too-large": 413,
  disabled: 503,
  "daily-limit": 429,
  paused: 503,
  busy: 503,
  unavailable: 502,
};

/** Where the browser asks for an answer: a route handler of this app. */
export const assistPath = (slug: string, kind: AssistKind) =>
  `/api/books/${encodeURIComponent(slug)}/assist/${kind}`;
