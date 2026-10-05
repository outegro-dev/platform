import { describe, expect, it } from "vitest";
import { orderScore, quizCorrect, quizMark, sortScore } from "./exercises.js";
import { SeededRandom, seedOf, shuffle, shuffledIndices } from "./random.js";

describe("shuffling", () => {
  it("is deterministic for a seed, so the server and the browser agree", () => {
    const a = shuffledIndices(6, new SeededRandom(seedOf("n01-o-1a2b3c4d")));
    const b = shuffledIndices(6, new SeededRandom(seedOf("n01-o-1a2b3c4d")));
    expect(a).toEqual(b);
  });

  it("keeps every item exactly once", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(shuffle(items, new SeededRandom(7)).sort()).toEqual(items);
  });

  it("never starts an order exercise already solved", () => {
    for (let seed = 0; seed < 500; seed++) {
      for (const count of [2, 3, 4]) {
        const order = shuffledIndices(count, new SeededRandom(seed));
        expect(order.every((value, index) => value === index)).toBe(false);
      }
    }
  });
});

describe("quiz", () => {
  it("is right only with every right option and nothing else", () => {
    expect(quizCorrect(new Set([0, 1]), [0, 1])).toBe(true);
    expect(quizCorrect(new Set([0]), [0, 1])).toBe(false);
    expect(quizCorrect(new Set([0, 1, 2]), [0, 1])).toBe(false);
    expect(quizCorrect(new Set([2]), [2])).toBe(true);
    expect(quizCorrect(new Set(), [0])).toBe(false);
  });

  it("marks each option once answered", () => {
    const selected = new Set([0, 2]);
    const answer = [0, 1];
    expect(quizMark(0, selected, answer)).toBe("right");
    expect(quizMark(1, selected, answer)).toBe("missed");
    expect(quizMark(2, selected, answer)).toBe("wrong");
    expect(quizMark(3, selected, answer)).toBe("dim");
  });
});

describe("order", () => {
  it("counts items in place and is solved only when all are", () => {
    expect(orderScore([0, 1, 2], 3)).toEqual({
      right: 3,
      total: 3,
      complete: true,
      solved: true,
    });
    expect(orderScore([1, 0, 2], 3)).toEqual({
      right: 1,
      total: 3,
      complete: true,
      solved: false,
    });
    expect(orderScore([0, 1], 3)).toEqual({
      right: 2,
      total: 3,
      complete: false,
      solved: false,
    });
  });
});

describe("sort", () => {
  const items = [{ key: "v8" }, { key: "uv" }, { key: "v8" }];

  it("scores the first choice of every item", () => {
    expect(sortScore(items, { 0: "v8", 1: "v8" })).toEqual({
      done: 2,
      right: 1,
      total: 3,
      complete: false,
      solved: false,
    });
    expect(sortScore(items, { 0: "v8", 1: "uv", 2: "v8" })).toEqual({
      done: 3,
      right: 3,
      total: 3,
      complete: true,
      solved: true,
    });
    expect(sortScore(items, { 0: "uv", 1: "uv", 2: "v8" }).solved).toBe(false);
  });

  it("ignores answers for items that do not exist", () => {
    expect(sortScore(items, { 7: "v8" }).done).toBe(0);
  });
});
