import type { CardState } from "@outegro/contracts/edu";
import { orderScore } from "./exercises.js";

/*
 * How an answered exercise reads item by item, and the reader's card count:
 * the marks the page puts on what the reader chose, from the book's answer
 * key. They never decide an attempt (the server's `checkAttempt` does);
 * they only show where each choice stands, the same wherever a book is read.
 */

/** Where one answered item stands. */
export type ItemMark = "right" | "wrong";

/**
 * An order exercise once every item is placed: whether the item at
 * `position` is where it belongs. Items are listed in the right order, so
 * an item is in place when its index is its position. Nothing while the
 * order is incomplete, or for a position with no item.
 */
export function orderMark(
  picked: readonly number[],
  position: number,
  total: number,
): ItemMark | undefined {
  if (!orderScore(picked, total).complete) return undefined;
  const item = picked[position];
  if (item === undefined) return undefined;
  return item === position ? "right" : "wrong";
}

/**
 * A sort item's first choice: right when it went to the item's own
 * bucket. Nothing before a choice is made.
 */
export function sortMark(
  item: Readonly<{ key: string }> | undefined,
  answer: string | undefined,
): ItemMark | undefined {
  if (item === undefined || answer === undefined) return undefined;
  return answer === item.key ? "right" : "wrong";
}

/** How one bucket button of an answered sort item looks. */
export type SortBucketMark = ItemMark | "should";

/**
 * A bucket of an answered sort item: the bucket chosen is right or wrong;
 * after a wrong choice, the item's own bucket shows where it should have
 * gone; every other bucket is unmarked.
 */
export function sortBucketMark(
  item: Readonly<{ key: string }> | undefined,
  answer: string | undefined,
  bucket: string,
): SortBucketMark | undefined {
  const mark = sortMark(item, answer);
  if (mark === undefined || item === undefined) return undefined;
  if (bucket === answer) return mark;
  return bucket === item.key ? "should" : undefined;
}

/** How a decided quiz answer reads. */
export type QuizOutcome = "right" | "partly" | "wrong";

/**
 * A quiz answer once its verdict is in: right when the verdict says so;
 * otherwise partly right when a right option is among those chosen, and
 * wrong when none is.
 */
export function quizOutcome(
  correct: boolean,
  selected: ReadonlySet<number>,
  answer: readonly number[],
): QuizOutcome {
  if (correct) return "right";
  return answer.some((index) => selected.has(index)) ? "partly" : "wrong";
}

/** How many of these card states are "I know it" (a missing state is a new card). */
export function knownCards(states: Iterable<CardState | undefined>): number {
  let known = 0;
  for (const state of states) if (state === "know") known++;
  return known;
}
