import {
  isMultipleChoice,
  type QuizBlock,
  type QuizMark,
  type QuizOutcome,
  quizMark,
  quizOutcome,
} from "@outegro/edu-engine";
import { makeAutoObservable } from "mobx";
import type { AttemptStore } from "./attempt-store";

/** How the answer reads once decided. */
export type QuizResult = QuizOutcome;

/** Where focus goes after a control disappears. */
export type QuizFocus = "options" | "again";

/**
 * A question with options. One right answer: a click answers at once.
 * Several: options toggle and "Check" answers. The answer goes to the
 * attempt (the server's verdict); the options' marks and the explanation
 * come from the book and show as soon as the reader answers.
 */
export class QuizStore {
  selected = new Set<number>();
  focus: QuizFocus | null = null;
  readonly quiz: QuizBlock;
  readonly attempt: AttemptStore;

  constructor(quiz: QuizBlock, attempt: AttemptStore) {
    this.quiz = quiz;
    this.attempt = attempt;
    makeAutoObservable(
      this,
      { quiz: false, attempt: false },
      { autoBind: true },
    );
  }

  get multiple(): boolean {
    return isMultipleChoice(this.quiz);
  }

  /** Answered: the marks and the explanation are shown. */
  get answered(): boolean {
    return this.attempt.current !== null;
  }

  get result(): QuizResult | null {
    const verdict = this.attempt.verdict;
    if (verdict?.state !== "decided") return null;
    return quizOutcome(verdict.correct, this.selected, this.quiz.answer);
  }

  /**
   * Where focus should go now: "Answer again" only once it is there (the
   * verdict is in), the first option at once.
   */
  get focusTarget(): QuizFocus | null {
    if (this.focus === "again" && this.attempt.checking) return null;
    return this.focus;
  }

  isSelected(index: number): boolean {
    return this.selected.has(index);
  }

  markOf(index: number): QuizMark | null {
    return this.answered
      ? quizMark(index, this.selected, this.quiz.answer)
      : null;
  }

  choose(index: number) {
    if (this.answered) return;
    if (!this.multiple) {
      this.answer([index]);
      return;
    }
    if (this.selected.has(index)) this.selected.delete(index);
    else this.selected.add(index);
  }

  check() {
    if (this.answered || this.selected.size === 0) return;
    this.answer([...this.selected]);
    // "Check" gives way to "Answer again".
    this.focus = "again";
  }

  reset() {
    if (this.attempt.checking) return;
    this.selected = new Set();
    this.attempt.clear();
    this.focus = "options";
  }

  focusDone() {
    this.focus = null;
  }

  private answer(choice: number[]) {
    this.selected = new Set(choice);
    this.attempt.submit({
      kind: "quiz",
      selected: [...choice].sort((a, b) => a - b),
    });
  }
}
