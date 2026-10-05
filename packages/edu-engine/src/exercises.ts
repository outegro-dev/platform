import type { Block, ExerciseAttempt } from "@outegro/contracts/edu";
import { matchesExpectation } from "./sql.js";

/*
 * The rules of the book's exercises, apart from any UI: checking a quiz,
 * scoring an order and a sort, and the server's verdict on an attempt. The
 * browser uses the same functions for instant feedback; edu-backend's
 * verdict is the one that is stored.
 */

export type QuizBlock = Extract<Block, { t: "quiz" }>;
export type OrderBlock = Extract<Block, { t: "order" }>;
export type SortBlock = Extract<Block, { t: "sort" }>;
export type SqlTaskBlock = Extract<Block, { t: "sqlTask" }>;
export type ExerciseBlock = QuizBlock | OrderBlock | SortBlock | SqlTaskBlock;

export const isExercise = (block: Block): block is ExerciseBlock =>
  block.t === "quiz" ||
  block.t === "order" ||
  block.t === "sort" ||
  block.t === "sqlTask";

/** More than one right option: the reader checks the set, not one click. */
export const isMultipleChoice = (quiz: Pick<QuizBlock, "answer">) =>
  new Set(quiz.answer).size > 1;

/* ---------- Quiz ---------- */

/** Every right option chosen and nothing else. */
export function quizCorrect(
  selected: ReadonlySet<number>,
  answer: readonly number[],
): boolean {
  return (
    selected.size === new Set(answer).size &&
    answer.every((index) => selected.has(index))
  );
}

export type QuizMark = "right" | "missed" | "wrong" | "dim";

/** How an option looks once the quiz is answered. */
export function quizMark(
  index: number,
  selected: ReadonlySet<number>,
  answer: readonly number[],
): QuizMark {
  const isAnswer = answer.includes(index);
  if (isAnswer) return selected.has(index) ? "right" : "missed";
  return selected.has(index) ? "wrong" : "dim";
}

/* ---------- Order ---------- */

/**
 * `picked[position]` is the index of the item placed there; items are
 * listed in the right order, so an item is in place when index = position.
 */
export function orderScore(picked: readonly number[], total: number) {
  const right = picked.filter((index, position) => index === position).length;
  const complete = picked.length === total;
  return { right, total, complete, solved: complete && right === total };
}

/* ---------- Sort ---------- */

/**
 * `answers[item]` is the bucket chosen for the item (first try only); the
 * exercise is solved when every item went to its bucket.
 */
export function sortScore(
  items: readonly { key: string }[],
  answers: Readonly<Record<number, string>>,
) {
  let done = 0;
  let right = 0;
  for (const [index, bucket] of Object.entries(answers)) {
    const item = items[Number(index)];
    if (!item) continue;
    done++;
    if (item.key === bucket) right++;
  }
  const complete = done === items.length;
  return {
    done,
    right,
    total: items.length,
    complete,
    solved: complete && right === items.length,
  };
}

/* ---------- The server's verdict ---------- */

/** An attempt that does not fit its exercise: a malformed or forged request. */
export class InvalidAttempt extends Error {
  constructor(readonly reason: string) {
    super(`invalid attempt: ${reason}`);
    this.name = "InvalidAttempt";
  }
}

const isPermutation = (values: readonly number[], size: number) =>
  values.length === size &&
  new Set(values).size === size &&
  values.every(
    (value) => Number.isInteger(value) && value >= 0 && value < size,
  );

/**
 * Whether a complete attempt answers the exercise right. The attempt must
 * fit the exercise (its kind, option and item counts, bucket keys);
 * anything else is an InvalidAttempt, never a wrong answer.
 */
export function checkAttempt(
  exercise: ExerciseBlock,
  attempt: ExerciseAttempt,
): boolean {
  if (exercise.t !== attempt.kind)
    throw new InvalidAttempt(`a ${attempt.kind} answer to a ${exercise.t}`);
  switch (attempt.kind) {
    case "quiz": {
      const quiz = exercise as QuizBlock;
      const selected = new Set(attempt.selected);
      if (selected.size !== attempt.selected.length)
        throw new InvalidAttempt("an option chosen twice");
      if (attempt.selected.some((index) => index >= quiz.options.length))
        throw new InvalidAttempt("no such option");
      if (!isMultipleChoice(quiz) && selected.size !== 1)
        throw new InvalidAttempt("one option expected");
      return quizCorrect(selected, quiz.answer);
    }
    case "order": {
      const order = exercise as OrderBlock;
      if (!isPermutation(attempt.order, order.items.length))
        throw new InvalidAttempt("every item exactly once");
      return orderScore(attempt.order, order.items.length).solved;
    }
    case "sort": {
      const sort = exercise as SortBlock;
      const buckets = new Set(sort.buckets.map((bucket) => bucket.key));
      if (attempt.placement.length !== sort.items.length)
        throw new InvalidAttempt("one bucket per item");
      if (attempt.placement.some((key) => !buckets.has(key)))
        throw new InvalidAttempt("no such bucket");
      return sortScore(sort.items, { ...attempt.placement }).solved;
    }
    case "sqlTask": {
      const task = exercise as SqlTaskBlock;
      return matchesExpectation(attempt, task.expected, task.ordered);
    }
  }
}
