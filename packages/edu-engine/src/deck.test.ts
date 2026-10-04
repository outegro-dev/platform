import type { CardState } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import { deckCards, deckCounts, deckQueue, deckScope } from "./deck.js";
import { MathRandom, SeededRandom } from "./random.js";

const chapters = [
  {
    n: 1,
    short: "Устройство",
    cards: [
      { id: "n01-c-00000001", front: ["a"], back: ["b"] },
      { id: "n01-c-00000002", front: ["c"], back: ["d"] },
    ],
  },
  {
    n: 2,
    short: "Модули",
    cards: [{ id: "n02-c-00000003", front: ["e"], back: ["f"] }],
  },
];

const states: Record<string, CardState> = {
  "n01-c-00000001": "know",
  "n02-c-00000003": "again",
};
const state = (id: string) => states[id];

describe("deck", () => {
  const cards = deckCards(chapters);

  it("keeps each card's chapter", () => {
    expect(cards.map((card) => [card.id, card.chapter])).toEqual([
      ["n01-c-00000001", 1],
      ["n01-c-00000002", 1],
      ["n02-c-00000003", 2],
    ]);
  });

  it("filters by chapter and counts known, again and new", () => {
    expect(deckCounts(deckScope(cards, "all"), state)).toEqual({
      know: 1,
      again: 1,
      fresh: 1,
      total: 3,
    });
    expect(deckCounts(deckScope(cards, 1), state)).toEqual({
      know: 1,
      again: 0,
      fresh: 1,
      total: 2,
    });
  });

  it("builds the queue of the chosen set", () => {
    const all = deckScope(cards, "all");
    expect(deckQueue(all, "all", state, new SeededRandom(1)).sort()).toEqual(
      cards.map((card) => card.id).sort(),
    );
    expect(deckQueue(all, "new", state, new MathRandom())).toEqual([
      "n01-c-00000002",
    ]);
    expect(deckQueue(all, "again", state, new MathRandom())).toEqual([
      "n02-c-00000003",
    ]);
    expect(
      deckQueue(deckScope(cards, 2), "new", state, new MathRandom()),
    ).toEqual([]);
  });
});
