import type { CardState, ProgressResponse } from "@outegro/contracts/edu";
import { bestScore, knownCards, solvedIn } from "@outegro/edu-engine";
import { makeAutoObservable, runInAction } from "mobx";
import { isPermanent, type ReaderApi } from "@/lib/reader-api";
import type { SyncStatusStore } from "./sync-status-store";

/** Status keys of the writes, one namespace per kind of id. */
export const exerciseSaveKey = (id: string) => `exercise:${id}`;
export const cardSaveKey = (id: string) => `card:${id}`;

type Init = {
  slug: string;
  /** Signed in as far as the server knows (the progress loaded). */
  signedIn: boolean;
  /** The reader's progress with the page; null signed out or unavailable. */
  progress: ProgressResponse | null;
};

type Deps = {
  api: Pick<ReaderApi, "saveCard" | "savePosition">;
  sync: SyncStatusStore;
  newKey: () => string;
};

/**
 * The reader's progress in one book as the server confirmed it: solved
 * exercises (changed only by the server's verdict on an attempt), card
 * marks, the best "explain it in your own words" score per chapter and the
 * chapter opened last. Card marks are a preference: they show at once and
 * are saved in the background, and a save the server refuses for good is
 * undone. Signed out, marks live on the page and nothing is sent.
 */
export class ReaderProgressStore {
  readonly slug: string;
  readonly signedIn: boolean;
  lastChapter: number | null;
  private readonly exercises: Map<string, boolean>;
  private readonly cards: Map<string, CardState>;
  private readonly understanding: Map<number, number>;
  /** Card marks the server has (from the page or a confirmed save). */
  private readonly confirmed: Map<string, CardState>;
  /** How many marks each card got on this page: the newest one wins. */
  private readonly marks = new Map<string, number>();
  private readonly opened = new Set<number>();
  private readonly deps: Deps;

  constructor(init: Init, deps: Deps) {
    this.slug = init.slug;
    this.signedIn = init.signedIn;
    this.lastChapter = init.progress?.lastChapter ?? null;
    this.exercises = new Map(Object.entries(init.progress?.exercises ?? {}));
    this.cards = new Map(Object.entries(init.progress?.cards ?? {}));
    this.confirmed = new Map(this.cards);
    this.understanding = new Map(
      Object.entries(init.progress?.understanding ?? {}).map(
        ([chapter, score]) => [Number(chapter), score],
      ),
    );
    this.deps = deps;
    makeAutoObservable<this, "confirmed" | "marks" | "opened" | "deps">(
      this,
      {
        slug: false,
        signedIn: false,
        confirmed: false,
        marks: false,
        opened: false,
        deps: false,
      },
      { autoBind: true },
    );
  }

  isSolved(id: string): boolean {
    return this.exercises.get(id) === true;
  }

  /** Exercises solved in a chapter (ids start with the chapter's id). */
  solvedIn(chapterId: string): number {
    return solvedIn(this.exercises, chapterId);
  }

  cardState(id: string): CardState | undefined {
    return this.cards.get(id);
  }

  /** Cards marked "I know it" in the whole book. */
  get cardsKnown(): number {
    return knownCards(this.cards.values());
  }

  /** The best "explain it in your own words" score of a chapter, 1–10. */
  understandingOf(chapter: number): number | null {
    return this.understanding.get(chapter) ?? null;
  }

  /**
   * A score the assistant gave on this page: edu-backend recorded it and
   * keeps the best one, and so does the page.
   */
  recordUnderstanding(chapter: number, score: number) {
    const best = bestScore(this.understanding.get(chapter), score);
    if (best !== null) this.understanding.set(chapter, best);
  }

  /** The server's outcome of an attempt: solved once means solved. */
  confirmAttempt(id: string, solved: boolean) {
    this.exercises.set(id, this.exercises.get(id) === true || solved);
  }

  /**
   * "I know it" or "again": shown at once and saved with a key of its own
   * (a retry resends it). A save refused for good puts back what the
   * server has, unless the reader has marked the card again since.
   */
  markCard(id: string, state: CardState) {
    this.cards.set(id, state);
    if (!this.signedIn) return;
    const mark = (this.marks.get(id) ?? 0) + 1;
    this.marks.set(id, mark);
    const idempotencyKey = this.deps.newKey();
    void this.deps.sync.run(cardSaveKey(id), async () => {
      const outcome = await this.deps.api.saveCard({
        slug: this.slug,
        id,
        state,
        idempotencyKey,
      });
      if (outcome.kind === "ok") {
        this.confirmed.set(id, state);
        return "saved";
      }
      if (isPermanent(outcome.kind) && this.marks.get(id) === mark)
        runInAction(() => this.undoMark(id));
      return outcome.kind;
    });
  }

  /**
   * The reader opened a chapter they can read: "continue reading" starts
   * there next time. Once per chapter and page; a failed save only means
   * the book offers an older chapter, so nothing is shown for it.
   */
  openChapter(n: number) {
    if (!this.signedIn || this.opened.has(n)) return;
    this.opened.add(n);
    this.lastChapter = n;
    void this.deps.api
      .savePosition({ slug: this.slug, lastChapter: n })
      .catch(() => undefined);
  }

  private undoMark(id: string) {
    const kept = this.confirmed.get(id);
    if (kept === undefined) this.cards.delete(id);
    else this.cards.set(id, kept);
  }
}
