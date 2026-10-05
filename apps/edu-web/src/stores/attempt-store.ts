import type { ExerciseAttempt } from "@outegro/contracts/edu";
import { checkAttempt, type ExerciseBlock } from "@outegro/edu-engine";
import { makeAutoObservable, observable, runInAction } from "mobx";
import { fitsBody } from "@/lib/body-size";
import type { ReaderApi } from "@/lib/reader-api";
import {
  exerciseSaveKey,
  type ReaderProgressStore,
} from "./reader-progress-store";
import type { SyncStatusStore } from "./sync-status-store";

/** What the page says about the current attempt. */
export type Verdict =
  /** The server is checking it. */
  | { state: "checking" }
  | {
      state: "decided";
      correct: boolean;
      /**
       * server: edu-backend checked and recorded it. local: checked on this
       * device with the book's answer key, not saved (signed out, or the
       * server could not be reached or refused it).
       */
      source: "server" | "local";
    };

type Attempt = Readonly<{
  answer: ExerciseAttempt;
  /** The engine's verdict on this device, for when the server has none. */
  local: boolean;
  /** Sent with every retry of this attempt, so it is counted once. */
  key: string;
}>;

type ServerVerdict = { correct: boolean; solved: boolean };

type Deps = {
  slug: string;
  signedIn: boolean;
  api: Pick<ReaderApi, "submitAttempt">;
  sync: SyncStatusStore;
  progress: ReaderProgressStore;
  newKey: () => string;
};

/**
 * One exercise's attempt and its verdict. Signed in, the answer goes to
 * edu-backend, which checks it and records it (the server decides): the
 * verdict, the solved mark and the counters follow its answer only. When
 * the server cannot be reached, the page shows the verdict of the engine on
 * this device, marked as not saved, and a retry resends the same attempt
 * with the same Idempotency-Key. An answer larger than edu-backend takes (a
 * long SQL result) is not sent at all: "too large", for good, with the
 * local verdict. Signed out, the local verdict is all.
 */
export class AttemptStore {
  current: Attempt | null = null;
  readonly exercise: ExerciseBlock;
  /** The server's verdicts by attempt key. */
  private readonly verdicts = new Map<string, ServerVerdict>();
  private readonly deps: Deps;

  constructor(exercise: ExerciseBlock, deps: Deps) {
    this.exercise = exercise;
    this.deps = deps;
    makeAutoObservable<this, "deps">(
      this,
      { current: observable.ref, exercise: false, deps: false },
      { autoBind: true },
    );
  }

  get saveKey() {
    return exerciseSaveKey(this.exercise.id);
  }

  get verdict(): Verdict | null {
    const attempt = this.current;
    if (!attempt) return null;
    const server = this.verdicts.get(attempt.key);
    if (server)
      return { state: "decided", correct: server.correct, source: "server" };
    if (!this.deps.signedIn)
      return { state: "decided", correct: attempt.local, source: "local" };
    const status = this.deps.sync.statusOf(this.saveKey);
    if (status === null || status === "saving") return { state: "checking" };
    return { state: "decided", correct: attempt.local, source: "local" };
  }

  get checking(): boolean {
    return this.verdict?.state === "checking";
  }

  submit(answer: ExerciseAttempt) {
    if (this.checking) return;
    let local = false;
    try {
      local = checkAttempt(this.exercise, answer);
    } catch {
      // An answer that does not fit the exercise is not a right one.
    }
    const attempt: Attempt = Object.freeze({
      answer,
      local,
      key: this.deps.newKey(),
    });
    this.current = attempt;
    if (this.deps.signedIn)
      void this.deps.sync.run(this.saveKey, () => this.send(attempt));
  }

  /** The reader starts over; an attempt being checked finishes first. */
  clear() {
    if (this.checking) return;
    this.current = null;
  }

  private async send(attempt: Attempt) {
    // It would be refused (or not even reach the server action): never sent.
    if (!fitsBody(attempt.answer)) return "too-large" as const;
    const outcome = await this.deps.api.submitAttempt({
      slug: this.deps.slug,
      id: this.exercise.id,
      attempt: attempt.answer,
      idempotencyKey: attempt.key,
    });
    if (outcome.kind !== "ok") return outcome.kind;
    runInAction(() =>
      this.verdicts.set(attempt.key, {
        correct: outcome.correct,
        solved: outcome.solved,
      }),
    );
    this.deps.progress.confirmAttempt(this.exercise.id, outcome.solved);
    return "saved" as const;
  }
}
