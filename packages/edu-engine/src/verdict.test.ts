import type { Chapter, EventLoopScenario } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import {
  checkAttempt,
  type ExerciseBlock,
  InvalidAttempt,
} from "./exercises.js";
import { newOutput, resolveEventLoopSteps } from "./simulator.js";
import {
  expectationOf,
  fingerprintRows,
  hash64,
  matchesExpectation,
  reportOf,
  type SqlResult,
} from "./sql.js";
import { chapterText, plainText, sectionsOf, sectionText } from "./text.js";

const quiz: ExerciseBlock = {
  t: "quiz",
  id: "n01-q-00000001",
  q: [],
  options: [["a"], ["b"], ["c"]],
  answer: [0, 2],
  why: [],
};
const single: ExerciseBlock = { ...quiz, answer: [1] };
const order: ExerciseBlock = {
  t: "order",
  id: "n01-o-00000001",
  q: [],
  items: [["first"], ["second"], ["third"]],
  why: [],
};
const sort: ExerciseBlock = {
  t: "sort",
  id: "n01-s-00000001",
  q: [],
  buckets: [
    { key: "v8", c: ["V8"] },
    { key: "uv", c: ["libuv"] },
  ],
  items: [
    { key: "v8", c: ["GC"] },
    { key: "uv", c: ["epoll"] },
  ],
  why: [],
};
const solutionResult: SqlResult = {
  columns: ["id", "total"],
  values: [
    [7, 51000.004],
    [3, null],
  ],
};
const task = (ordered: boolean): ExerciseBlock => ({
  t: "sqlTask",
  id: "s02-t-00000001",
  q: [],
  hint: null,
  solution: "SELECT id, total FROM orders",
  ordered,
  expected: expectationOf(solutionResult, ordered),
});

describe("the server's verdict", () => {
  it("checks a quiz by the set of options", () => {
    expect(checkAttempt(quiz, { kind: "quiz", selected: [2, 0] })).toBe(true);
    expect(checkAttempt(quiz, { kind: "quiz", selected: [0] })).toBe(false);
    expect(checkAttempt(single, { kind: "quiz", selected: [1] })).toBe(true);
  });

  it("refuses answers that do not fit the exercise", () => {
    const refused = [
      () => checkAttempt(quiz, { kind: "order", order: [0, 1, 2] }),
      () => checkAttempt(quiz, { kind: "quiz", selected: [0, 0] }),
      () => checkAttempt(quiz, { kind: "quiz", selected: [3] }),
      () => checkAttempt(single, { kind: "quiz", selected: [0, 1] }),
      () => checkAttempt(order, { kind: "order", order: [0, 1] }),
      () => checkAttempt(order, { kind: "order", order: [0, 0, 1] }),
      () => checkAttempt(sort, { kind: "sort", placement: ["v8"] }),
      () => checkAttempt(sort, { kind: "sort", placement: ["v8", "zlib"] }),
    ];
    for (const attempt of refused) expect(attempt).toThrow(InvalidAttempt);
  });

  it("checks an order and a sort as a whole", () => {
    expect(checkAttempt(order, { kind: "order", order: [0, 1, 2] })).toBe(true);
    expect(checkAttempt(order, { kind: "order", order: [1, 0, 2] })).toBe(
      false,
    );
    expect(checkAttempt(sort, { kind: "sort", placement: ["v8", "uv"] })).toBe(
      true,
    );
    expect(checkAttempt(sort, { kind: "sort", placement: ["uv", "uv"] })).toBe(
      false,
    );
  });

  it("checks an SQL task by the fingerprint of the solution's result", () => {
    const reordered: SqlResult = {
      columns: ["customer", "sum"],
      values: [
        [3, null],
        [7, 51000.0012],
      ],
    };
    const attempt = { kind: "sqlTask" as const, ...reportOf(reordered) };
    expect(checkAttempt(task(false), attempt)).toBe(true);
    expect(checkAttempt(task(true), attempt)).toBe(false);
    expect(
      checkAttempt(task(true), {
        kind: "sqlTask",
        ...reportOf(solutionResult),
      }),
    ).toBe(true);
    const wrong = {
      ...attempt,
      rows: [
        ["3", "\u0000NULL"],
        ["7", "51000.01"],
      ],
    };
    expect(checkAttempt(task(false), wrong)).toBe(false);
  });

  it("does not accept a result whose counts do not add up", () => {
    const expected = expectationOf(solutionResult, false);
    const report = reportOf(solutionResult);
    expect(matchesExpectation(report, expected, false)).toBe(true);
    expect(
      matchesExpectation({ ...report, rowCount: 3 }, expected, false),
    ).toBe(false);
    expect(
      matchesExpectation(
        { ...report, rows: report.rows.slice(1) },
        expected,
        false,
      ),
    ).toBe(false);
    expect(
      matchesExpectation(
        { ...report, rows: report.rows.map((row) => row.slice(1)) },
        expected,
        false,
      ),
    ).toBe(false);
  });
});

describe("fingerprints", () => {
  it("are stable 16-digit hex and tell results apart", () => {
    expect(hash64("абв")).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64("абв")).toBe(hash64("абв"));
    expect(hash64("абв")).not.toBe(hash64("абг"));
    expect(fingerprintRows(2, [["a", "bc"]], false)).not.toBe(
      fingerprintRows(2, [["ab", "c"]], false),
    );
    expect(fingerprintRows(1, [["1"], ["2"]], false)).toBe(
      fingerprintRows(1, [["2"], ["1"]], false),
    );
    expect(fingerprintRows(1, [["1"], ["2"]], true)).not.toBe(
      fingerprintRows(1, [["2"], ["1"]], true),
    );
  });
});

const chapter: Chapter = {
  id: "n01",
  n: 1,
  short: "Устройство",
  kicker: "Глава 1",
  title: "Что такое Node.js",
  lead: ["Node — ", { t: "code", v: "runtime" }],
  blocks: [
    { t: "h3", id: "n01-runtime", c: ["Runtime, а не язык"] },
    { t: "p", c: ["JavaScript — это ", { t: "b", c: ["язык"] }, "."] },
    { t: "code", code: "console.log(1)", lang: "js", out: "1" },
    {
      t: "quiz",
      id: "n01-q-00000001",
      q: [{ t: "p", c: ["Скрытый вопрос"] }],
      options: [["a"], ["b"]],
      answer: [0],
      why: [{ t: "p", c: ["Скрытый ответ"] }],
    },
    { t: "h3", id: "n01-layers", c: ["Слои"] },
    { t: "p", c: ["V8 и libuv."] },
  ],
};

describe("text for the assistant", () => {
  it("lists sections and reads one up to the next heading", () => {
    expect(sectionsOf(chapter)).toEqual([
      { id: "n01-runtime", title: "Runtime, а не язык" },
      { id: "n01-layers", title: "Слои" },
    ]);
    const text = sectionText(chapter, "n01-runtime") ?? "";
    expect(text).toContain("JavaScript — это язык.");
    expect(text).toContain("```js\nconsole.log(1)\n```\nВывод:\n1");
    expect(text).not.toContain("V8 и libuv");
    expect(sectionText(chapter, "missing")).toBeNull();
  });

  it("keeps exercises and their answers out", () => {
    const text = chapterText(chapter);
    expect(text).toContain("# Что такое Node.js");
    expect(text).toContain("## Слои");
    expect(text).not.toContain("Скрытый");
    expect(plainText(chapter.lead)).toBe("Node — `runtime`");
  });
});

describe("event loop simulator", () => {
  const scenario: EventLoopScenario = {
    name: "Порядок",
    code: ["console.log('A');", "setTimeout(() => console.log('B'));"],
    steps: [
      { l: 1, ph: "main", stack: ["главный модуль"], out: ["A"] },
      { l: 2, timers: ["log('B')"] },
      { ph: "timers", stack: ["log('B')"], timers: [], out: ["A", "B"] },
    ],
  };

  it("carries fields a step omits over from the previous step", () => {
    const states = resolveEventLoopSteps(scenario);
    expect(states[1]).toMatchObject({
      l: 2,
      ph: "main",
      stack: ["главный модуль"],
      timers: ["log('B')"],
      out: ["A"],
    });
    expect(states[2]).toMatchObject({
      ph: "timers",
      timers: [],
      out: ["A", "B"],
    });
    expect(newOutput(states, 2)).toEqual([false, true]);
    expect(newOutput(states, 0)).toEqual([true]);
  });
});
