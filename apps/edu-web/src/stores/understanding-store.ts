import { assistUnderstandingSchema } from "@outegro/contracts/edu";
import { isUnderstood } from "@outegro/edu-engine";
import { makeAutoObservable } from "mobx";
import type { KeyValueStorage } from "@/lib/browser";
import type { AnswerStore } from "./answer-store";
import type { ReaderProgressStore } from "./reader-progress-store";

/** The shortest retelling the assistant takes (the contract's minimum, trimmed). */
export const MIN_RETELLING = 80;
/** The longest one. */
export const MAX_RETELLING = 4000;

/** Why the retelling was not sent. */
export type RetellingProblem = "short";

type Deps = {
  progress: ReaderProgressStore;
  /** Where the draft is kept in this browser. */
  drafts: KeyValueStorage;
  draftKey: string;
};

/**
 * "Explain it in your own words" at the end of a chapter: the reader's
 * retelling (a draft kept in this browser, like SQL drafts), checked by the
 * assistant against the chapter. The review streams; its 1–10 score goes to
 * the reader's progress as edu-backend records it (the best one counts),
 * and a best score of 7 or more confirms the chapter (the engine's rule).
 * Too short a retelling is not sent: the reader is told and put back in
 * the field.
 */
export class UnderstandingStore {
  text = "";
  problem: RetellingProblem | null = null;
  /** Bumped when the field should take focus. */
  focusField = 0;
  readonly chapter: number;
  readonly answer: AnswerStore<"understanding">;
  private readonly deps: Deps;

  constructor(
    chapter: number,
    answer: AnswerStore<"understanding">,
    deps: Deps,
  ) {
    this.chapter = chapter;
    this.answer = answer;
    this.deps = deps;
    makeAutoObservable<this, "deps">(
      this,
      { chapter: false, answer: false, deps: false },
      { autoBind: true },
    );
  }

  /** The score of the check on this page, once it came. */
  get score(): number | null {
    return this.answer.phase === "done" ? this.answer.score : null;
  }

  /** The best score of the chapter (from the server, then this page). */
  get best(): number | null {
    return this.deps.progress.understandingOf(this.chapter);
  }

  get understood(): boolean {
    return isUnderstood(this.best);
  }

  /** The draft kept in this browser, once the page runs. */
  restoreDraft() {
    const draft = this.deps.drafts.get(this.deps.draftKey);
    if (draft !== null) this.text = draft;
  }

  setText(text: string) {
    this.text = text;
    this.deps.drafts.set(this.deps.draftKey, text);
    if (this.problem && this.request()) this.problem = null;
  }

  /** Sends the retelling to be checked; one being checked finishes first. */
  check() {
    if (this.answer.running) return;
    const body = this.request();
    if (!body) {
      this.problem = "short";
      this.focusField += 1;
      return;
    }
    this.problem = null;
    void this.answer.ask(body);
  }

  /** The retelling as the contract takes it (trimmed, 80–4000 characters), or null. */
  private request() {
    const parsed = assistUnderstandingSchema.safeParse({
      chapter: this.chapter,
      text: this.text,
    });
    return parsed.success ? parsed.data : null;
  }
}
