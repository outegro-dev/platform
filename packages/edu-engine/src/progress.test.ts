import { describe, expect, it } from "vitest";
import { solvedIn } from "./progress.js";

describe("solved exercises per chapter", () => {
  const exercises = {
    "n01-q-00000001": true,
    "n01-o-00000002": false,
    "n01-s-00000003": true,
    "n10-q-00000004": true,
    "n02-t-00000005": true,
  };

  it("counts the solved exercises of the chapter only", () => {
    expect(solvedIn(exercises, "n01")).toBe(2);
    expect(solvedIn(exercises, "n10")).toBe(1);
    expect(solvedIn(exercises, "n02")).toBe(1);
    expect(solvedIn(exercises, "n03")).toBe(0);
  });

  it("does not take one chapter's id for the start of another's", () => {
    expect(solvedIn({ "n1-q-00000001": true }, "n")).toBe(0);
    expect(solvedIn({ "n10-q-00000001": true }, "n1")).toBe(0);
  });

  it("reads a Map (or a map-like store) the same way, and nothing as zero", () => {
    const map = new Map(Object.entries(exercises));
    expect(solvedIn(map, "n01")).toBe(2);
    const mapLike = {
      get: (id: string) => map.get(id),
      entries: () => map.entries(),
    } as unknown as ReadonlyMap<string, boolean>;
    expect(solvedIn(mapLike, "n01")).toBe(2);
    expect(solvedIn(null, "n01")).toBe(0);
    expect(solvedIn(undefined, "n01")).toBe(0);
  });
});
