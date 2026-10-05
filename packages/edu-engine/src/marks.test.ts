import { describe, expect, it } from "vitest";
import {
  knownCards,
  orderMark,
  quizOutcome,
  sortBucketMark,
  sortMark,
} from "./marks.js";

describe("order marks", () => {
  it("mark every position once the order is complete", () => {
    const picked = [1, 0, 2];
    expect([0, 1, 2].map((position) => orderMark(picked, position, 3))).toEqual(
      ["wrong", "wrong", "right"],
    );
    expect(orderMark([0, 1, 2], 1, 3)).toBe("right");
  });

  it("say nothing while items are still to place, or for an empty place", () => {
    expect(orderMark([0, 1], 0, 3)).toBeUndefined();
    expect(orderMark([], 0, 0)).toBeUndefined();
    expect(orderMark([0, 1, 2], 5, 3)).toBeUndefined();
  });
});

describe("sort marks", () => {
  const item = { key: "v8" };

  it("mark the first choice of an item right or wrong", () => {
    expect(sortMark(item, "v8")).toBe("right");
    expect(sortMark(item, "uv")).toBe("wrong");
    expect(sortMark(item, undefined)).toBeUndefined();
    expect(sortMark(undefined, "v8")).toBeUndefined();
  });

  it("show the bucket chosen and, after a wrong choice, where the item belongs", () => {
    expect(sortBucketMark(item, "v8", "v8")).toBe("right");
    expect(sortBucketMark(item, "v8", "uv")).toBeUndefined();
    expect(sortBucketMark(item, "uv", "uv")).toBe("wrong");
    expect(sortBucketMark(item, "uv", "v8")).toBe("should");
    expect(sortBucketMark(item, "uv", "os")).toBeUndefined();
    expect(sortBucketMark(item, undefined, "v8")).toBeUndefined();
  });
});

describe("quiz outcome", () => {
  it("follows the verdict, and tells partly right from wrong", () => {
    expect(quizOutcome(true, new Set([0, 1]), [0, 1])).toBe("right");
    expect(quizOutcome(false, new Set([0, 2]), [0, 1])).toBe("partly");
    expect(quizOutcome(false, new Set([2]), [0, 1])).toBe("wrong");
    // The server's verdict wins over the answer key.
    expect(quizOutcome(true, new Set([2]), [0])).toBe("right");
    expect(quizOutcome(false, new Set([0]), [0])).toBe("partly");
  });
});

describe("known cards", () => {
  it("counts the cards marked I know it", () => {
    expect(knownCards(["know", "again", "know", undefined])).toBe(2);
    expect(knownCards(new Map([["a", "again" as const]]).values())).toBe(0);
    expect(knownCards([])).toBe(0);
  });
});
