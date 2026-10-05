import { type AssistStyle, assistExplainSchema } from "@outegro/contracts/edu";
import { makeAutoObservable } from "mobx";
import type { AnswerStore } from "./answer-store";

/** How much of the previous answer "another version" sends as what not to repeat. */
export const AVOID_LENGTH = 1500;

/** What the current answer answers: a style of explanation, or the reader's question. */
export type ExplainAsked =
  | { kind: "style"; style: AssistStyle }
  | { kind: "question" };

/** Why the question was not sent. */
export type QuestionProblem = "short";

type Init = {
  /** Chapter number. */
  chapter: number;
  /** The section's anchor: a top-level heading of the chapter. */
  section: string;
};

/**
 * "Explain it differently" under one section heading: the panel opens and
 * closes; the reader picks a way to explain (simpler, another analogy, in
 * code…) or asks their own question, and the answer streams below. A new
 * choice drops the answer still coming; a question clears the chosen
 * style; "another version" of a style answer sends its start as what the
 * model must not repeat.
 */
export class ExplainPanelStore {
  open = false;
  /** The panel was opened once: its content stays (with its answer) when closed. */
  mounted = false;
  /** The style shown as chosen (none after a question). */
  style: AssistStyle | null = null;
  question = "";
  asked: ExplainAsked | null = null;
  questionProblem: QuestionProblem | null = null;
  /** Bumped when the question field should take focus. */
  focusQuestion = 0;
  readonly chapter: number;
  readonly section: string;
  readonly answer: AnswerStore<"explain">;

  constructor(init: Init, answer: AnswerStore<"explain">) {
    this.chapter = init.chapter;
    this.section = init.section;
    this.answer = answer;
    makeAutoObservable(
      this,
      { chapter: false, section: false, answer: false },
      { autoBind: true },
    );
  }

  /** "Another version" is offered after a style answer that came (in full or in part). */
  get canAgain(): boolean {
    if (this.asked?.kind !== "style") return false;
    const { phase, text } = this.answer;
    return phase === "done" || (phase === "stopped" && text.length > 0);
  }

  /** The first press opens the panel; later ones close and open it again. */
  toggle() {
    this.open = !this.open;
    if (this.open) this.mounted = true;
  }

  chooseStyle(style: AssistStyle) {
    this.style = style;
    this.asked = { kind: "style", style };
    this.questionProblem = null;
    void this.answer.ask({
      chapter: this.chapter,
      section: this.section,
      style,
    });
  }

  setQuestion(text: string) {
    this.question = text;
    if (this.questionProblem && this.questionOf(text))
      this.questionProblem = null;
  }

  /** Sends the question; an empty one only puts the reader in the field. */
  askQuestion() {
    if (this.question.trim() === "") {
      this.questionProblem = null;
      this.focusQuestion += 1;
      return;
    }
    const question = this.questionOf(this.question);
    if (!question) {
      this.questionProblem = "short";
      this.focusQuestion += 1;
      return;
    }
    this.questionProblem = null;
    this.style = null;
    this.asked = { kind: "question" };
    void this.answer.ask({
      chapter: this.chapter,
      section: this.section,
      question,
    });
  }

  /** Another version of the style answer, unlike the one shown. */
  again() {
    if (!this.canAgain || this.asked?.kind !== "style") return;
    const { style } = this.asked;
    const avoid = this.answer.text.slice(0, AVOID_LENGTH);
    void this.answer.ask({
      chapter: this.chapter,
      section: this.section,
      style,
      avoid,
    });
  }

  /** The question as the contract takes it (trimmed, 3–500 characters), or null. */
  private questionOf(text: string): string | null {
    const parsed = assistExplainSchema.safeParse({
      chapter: this.chapter,
      section: this.section,
      question: text,
    });
    return parsed.success ? (parsed.data.question ?? null) : null;
  }
}
