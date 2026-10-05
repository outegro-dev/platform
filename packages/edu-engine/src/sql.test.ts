import { describe, expect, it } from "vitest";
import {
  compareResults,
  displayCell,
  lastResult,
  normalizeCell,
  type SqlResult,
} from "./sql.js";

const result = (columns: string[], values: SqlResult["values"]): SqlResult => ({
  columns,
  values,
});

describe("lastResult", () => {
  it("is the last statement that returned rows", () => {
    const first = result(["a"], [[1]]);
    const second = result(["b"], [[2]]);
    expect(lastResult([first, second])).toBe(second);
    expect(lastResult([])).toBeNull();
  });
});

describe("compareResults", () => {
  const expected = result(
    ["id", "name"],
    [
      [1, "Анна"],
      [2, "Борис"],
      [3, null],
    ],
  );

  it("accepts the same rows in any order when order does not matter", () => {
    const mine = result(
      ["customer_id", "customer"],
      [
        [3, null],
        [1, "Анна"],
        [2, "Борис"],
      ],
    );
    expect(compareResults(mine, expected, false)).toEqual({ ok: true });
  });

  it("asks for the same order when the task says it matters", () => {
    const mine = result(
      ["id", "name"],
      [
        [2, "Борис"],
        [1, "Анна"],
        [3, null],
      ],
    );
    expect(compareResults(mine, expected, true)).toEqual({
      ok: false,
      reason: "order",
    });
    expect(compareResults(expected, expected, true)).toEqual({ ok: true });
  });

  it("names a different number of columns first", () => {
    const mine = result(["id"], [[1], [2], [3]]);
    expect(compareResults(mine, expected, false)).toEqual({
      ok: false,
      reason: "columns",
      mine: 1,
      expected: 2,
    });
  });

  it("then a different number of rows", () => {
    const mine = result(["id", "name"], [[1, "Анна"]]);
    expect(compareResults(mine, expected, false)).toEqual({
      ok: false,
      reason: "rows",
      mine: 1,
      expected: 3,
    });
  });

  it("then different values with the same shape", () => {
    const mine = result(
      ["id", "name"],
      [
        [1, "Анна"],
        [2, "Борис"],
        [3, "Вера"],
      ],
    );
    expect(compareResults(mine, expected, false)).toEqual({
      ok: false,
      reason: "values",
    });
  });

  it("compares rows as a multiset, duplicates included", () => {
    const wanted = result(["x"], [[1], [1], [2]]);
    expect(
      compareResults(result(["x"], [[1], [2], [2]]), wanted, false),
    ).toEqual({ ok: false, reason: "values" });
    expect(
      compareResults(result(["x"], [[2], [1], [1]]), wanted, false),
    ).toEqual({ ok: true });
  });

  it("rounds numbers to cents before comparing", () => {
    const wanted = result(["avg"], [[1234.5678]]);
    expect(
      compareResults(result(["avg"], [[1234.5712]]), wanted, false),
    ).toEqual({ ok: true });
    expect(compareResults(result(["avg"], [[1234.58]]), wanted, false)).toEqual(
      {
        ok: false,
        reason: "values",
      },
    );
  });

  it("treats NULL as a marker, never equal to the string 'NULL'", () => {
    const wanted = result(["city"], [[null]]);
    expect(compareResults(result(["city"], [["NULL"]]), wanted, false)).toEqual(
      {
        ok: false,
        reason: "values",
      },
    );
    expect(compareResults(result(["city"], [[null]]), wanted, false)).toEqual({
      ok: true,
    });
  });

  it("reports a query without a result", () => {
    expect(compareResults(null, expected, false)).toEqual({
      ok: false,
      reason: "no-result",
    });
  });

  it("does not let a cell boundary hide a difference", () => {
    const wanted = result(["a", "b"], [["x", "yz"]]);
    expect(
      compareResults(result(["a", "b"], [["xy", "z"]]), wanted, false),
    ).toEqual({ ok: false, reason: "values" });
  });
});

describe("cells", () => {
  it("shows NULL, integers as they are and fractions to 4 decimals", () => {
    expect(displayCell(null)).toEqual({ text: "NULL", kind: "null" });
    expect(displayCell(42)).toEqual({ text: "42", kind: "number" });
    expect(displayCell(1.23456789)).toEqual({ text: "1.2346", kind: "number" });
    expect(displayCell("Москва")).toEqual({ text: "Москва", kind: "text" });
    expect(displayCell(new Uint8Array([171, 1]))).toEqual({
      text: "x'ab01'",
      kind: "blob",
    });
  });

  it("normalizes numbers to cents for comparison", () => {
    expect(normalizeCell(1.004)).toBe(normalizeCell(1.0049));
    expect(normalizeCell(1.004)).not.toBe(normalizeCell(1.006));
    expect(normalizeCell(-0.001)).toBe("0");
    expect(normalizeCell(5)).toBe(normalizeCell(5.0));
  });
});
