import type { Card, CardState } from "@outegro/contracts/edu";
import { type Random, shuffle } from "./random.js";

/*
 * The book's flash-card deck: which cards a set includes, how many the
 * reader knows, and the order they come in.
 */

export type DeckChapter = { n: number; short: string; cards: Card[] };
export type DeckFilter = "all" | number;
export type DeckMode = "all" | "new" | "again";
export type DeckCard = Card & { chapter: number; short: string };

export function deckCards(chapters: readonly DeckChapter[]): DeckCard[] {
  return chapters.flatMap((chapter) =>
    chapter.cards.map((card) => ({
      ...card,
      chapter: chapter.n,
      short: chapter.short,
    })),
  );
}

/** The cards of the chosen chapter (or all of them). */
export function deckScope(
  cards: readonly DeckCard[],
  filter: DeckFilter,
): DeckCard[] {
  return filter === "all"
    ? cards.slice()
    : cards.filter((card) => card.chapter === filter);
}

export function deckCounts(
  scope: readonly DeckCard[],
  state: (id: string) => CardState | undefined,
) {
  let know = 0;
  let again = 0;
  for (const card of scope) {
    const value = state(card.id);
    if (value === "know") know++;
    else if (value === "again") again++;
  }
  return {
    know,
    again,
    fresh: scope.length - know - again,
    total: scope.length,
  };
}

/** Ids of the cards to go through, shuffled. */
export function deckQueue(
  scope: readonly DeckCard[],
  mode: DeckMode,
  state: (id: string) => CardState | undefined,
  random: Random,
): string[] {
  const chosen = scope.filter((card) =>
    mode === "all"
      ? true
      : mode === "new"
        ? state(card.id) === undefined
        : state(card.id) === "again",
  );
  return shuffle(
    chosen.map((card) => card.id),
    random,
  );
}
