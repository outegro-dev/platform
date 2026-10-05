import type { SqlExpectation } from "@outegro/contracts/edu";

/*
 * Results of the SQL sandbox (sql.js `exec`: one entry per statement that
 * returned rows) and how a task compares the reader's result with the
 * solution's. The browser compares the two results for a precise message;
 * the server, which never runs SQL, checks the reader's normalized result
 * against the solution's fingerprint stored with the book.
 */

export type SqlValue = string | number | null | Uint8Array;
export type SqlResult = { columns: string[]; values: SqlValue[][] };

/** At most this many rows are shown, and sent with an attempt. */
export const MAX_ROWS = 200;

/** The result the reader sees: the last statement that returned rows. */
export function lastResult(results: readonly SqlResult[]): SqlResult | null {
  return results.length ? (results[results.length - 1] ?? null) : null;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** A cell as the table shows it: NULL marked, numbers to 4 decimals. */
export function displayCell(value: SqlValue): {
  text: string;
  kind: "null" | "number" | "text" | "blob";
} {
  if (value === null) return { text: "NULL", kind: "null" };
  if (typeof value === "number")
    return {
      text: String(
        Number.isInteger(value) ? value : Math.round(value * 1e4) / 1e4,
      ),
      kind: "number",
    };
  if (value instanceof Uint8Array)
    return { text: `x'${hex(value)}'`, kind: "blob" };
  return { text: String(value), kind: "text" };
}

const NULL_MARK = "\u0000NULL";
const CELL_SEPARATOR = "\u0001";
const ROW_SEPARATOR = "\u0002";

/**
 * A cell for comparison: numbers rounded to cents (a reader's AVG and the
 * solution's may differ in the last digits), NULL as a marker no string
 * can equal.
 */
export function normalizeCell(value: SqlValue): string {
  if (value === null) return NULL_MARK;
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  if (value instanceof Uint8Array) return `x'${hex(value)}'`;
  return String(value);
}

/** Rows of a result with every cell normalized. */
export function normalizedRows(result: SqlResult): string[][] {
  return result.values.map((row) => row.map(normalizeCell));
}

const rowKey = (row: readonly string[]) => row.join(CELL_SEPARATOR);

export type Comparison =
  | { ok: true }
  | { ok: false; reason: "no-result" }
  | { ok: false; reason: "columns"; mine: number; expected: number }
  | { ok: false; reason: "rows"; mine: number; expected: number }
  | { ok: false; reason: "values" }
  | { ok: false; reason: "order" };

/**
 * A task is solved when the reader's last result equals the solution's:
 * the same number of columns (names may differ), the same number of rows,
 * the same rows as a multiset and, when the task says order matters, in
 * the same order.
 */
export function compareResults(
  mine: SqlResult | null,
  expected: SqlResult,
  ordered: boolean,
): Comparison {
  if (!mine) return { ok: false, reason: "no-result" };
  if (mine.columns.length !== expected.columns.length)
    return {
      ok: false,
      reason: "columns",
      mine: mine.columns.length,
      expected: expected.columns.length,
    };
  if (mine.values.length !== expected.values.length)
    return {
      ok: false,
      reason: "rows",
      mine: mine.values.length,
      expected: expected.values.length,
    };
  const actual = normalizedRows(mine).map(rowKey);
  const wanted = normalizedRows(expected).map(rowKey);
  const sortedActual = actual.slice().sort();
  const sortedWanted = wanted.slice().sort();
  if (sortedActual.some((key, i) => key !== sortedWanted[i]))
    return { ok: false, reason: "values" };
  if (ordered && actual.some((key, i) => key !== wanted[i]))
    return { ok: false, reason: "order" };
  return { ok: true };
}

/**
 * 64-bit hash of text as 16 hex digits (two 32-bit lanes, cyrb53 mixing).
 * For telling results apart, not for secrecy.
 */
export function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const lane = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return `${lane(h2)}${lane(h1)}`;
}

/** Fingerprint of normalized rows: in their order when it matters, sorted otherwise. */
export function fingerprintRows(
  columns: number,
  rows: readonly (readonly string[])[],
  ordered: boolean,
): string {
  const keys = rows.map(rowKey);
  if (!ordered) keys.sort();
  return hash64(
    `${columns}|${rows.length}${ROW_SEPARATOR}${keys.join(ROW_SEPARATOR)}`,
  );
}

/** What the book stores for a task: the solution's result, fingerprinted. */
export function expectationOf(
  result: SqlResult,
  ordered: boolean,
): SqlExpectation {
  return {
    columns: result.columns.length,
    rows: result.values.length,
    fingerprint: fingerprintRows(
      result.columns.length,
      normalizedRows(result),
      ordered,
    ),
  };
}

/** The reader's result as an attempt sends it: counts and normalized rows. */
export type ReportedResult = {
  columns: number;
  rowCount: number;
  rows: string[][];
};

/** The reader's last result, ready to send with an attempt (at most MAX_ROWS rows). */
export function reportOf(result: SqlResult): ReportedResult {
  return {
    columns: result.columns.length,
    rowCount: result.values.length,
    rows: normalizedRows(result).slice(0, MAX_ROWS),
  };
}

/** The server's check: the reported result matches the solution's fingerprint. */
export function matchesExpectation(
  reported: Readonly<{
    columns: number;
    rowCount: number;
    rows: readonly (readonly string[])[];
  }>,
  expected: SqlExpectation,
  ordered: boolean,
): boolean {
  if (reported.columns !== expected.columns) return false;
  if (reported.rowCount !== expected.rows) return false;
  if (reported.rows.length !== reported.rowCount) return false;
  if (reported.rows.some((row) => row.length !== reported.columns))
    return false;
  return (
    fingerprintRows(reported.columns, reported.rows, ordered) ===
    expected.fingerprint
  );
}
