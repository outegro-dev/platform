import type { CardState } from "@outegro/contracts/edu";
import {
  type DeckCard,
  type DeckChapter,
  type DeckFilter,
  type DeckMode,
  deckCards,
  deckCounts,
  deckQueue,
  deckScope,
  type Random,
} from "@outegro/edu-engine";
import { makeAutoObservable } from "mobx";
import { cardSaveKey, type ReaderProgressStore } from "./reader-progress-store";
import type { SyncStatus, SyncStatusStore } from "./sync-status-store";

/**
 * A control to focus next; "status" is the saves' status line, where focus
 * goes when the Retry button it had goes away.
 */
export type DeckFocus = "show" | "know" | "restart" | "status";

/** Why the deck shows no card. */
export type DeckEmpty =
  | "done"
  | "none-open"
  | "none-again"
  | "none-new"
  | "none-here";

/** Where the marks made on this page stand, for one status line. */
export type DeckSaves = {
  saving: number;
  /** Failed or not sent while offline: a retry may help. */
  unsaved: number;
  offline: boolean;
  signedOut: boolean;
  /** Refused for good (no access, out of date): those marks were undone. */
  refused: number;
  saved: number;
};

type Deps = {
  progress: ReaderProgressStore;
  sync: SyncStatusStore;
  /**
   * The first order: seeded by the page (a new seed per visit, sent with
   * it), so the server render and the browser agree.
   */
  first: Random;
  /** Every later shuffle (a filter, a set, "shuffle again"). */
  random: Random;
};

/**
 * Every flash card of the chapters the reader can open, one at a time:
 * answer aloud, show the answer, then "I know it" or "Again" (kept in the
 * reader's progress). A chapter filter, new / again sets, the counts of
 * known, again and new cards, and the state of every mark's save.
 */
export class DeckStore {
  filter: DeckFilter = "all";
  mode: DeckMode = "all";
  queue: string[];
  index = 0;
  shown = false;
  focus: DeckFocus | null = null;
  readonly chapters: readonly DeckChapter[];
  readonly cards: readonly DeckCard[];
  /** Cards marked on this page: their saves make the status line. */
  private readonly marked = new Set<string>();
  private readonly deps: Deps;

  constructor(chapters: readonly DeckChapter[], deps: Deps) {
    this.chapters = chapters;
    this.cards = deckCards(chapters);
    this.deps = deps;
    this.queue = deckQueue(
      this.cards,
      "all",
      (id) => deps.progress.cardState(id),
      deps.first,
    );
    makeAutoObservable<this, "deps">(
      this,
      { chapters: false, cards: false, deps: false },
      { autoBind: true },
    );
  }

  private stateOf(id: string): CardState | undefined {
    return this.deps.progress.cardState(id);
  }

  get scope() {
    return deckScope(this.cards, this.filter);
  }

  get counts() {
    return deckCounts(this.scope, this.stateOf);
  }

  get current(): DeckCard | null {
    const id = this.queue[this.index];
    return this.cards.find((card) => card.id === id) ?? null;
  }

  /** 1-based place of the current card in the queue. */
  get position(): number {
    return this.index + 1;
  }

  get empty(): DeckEmpty | null {
    if (this.current) return null;
    if (this.queue.length) return "done";
    if (this.cards.length === 0) return "none-open";
    if (this.mode === "again") return "none-again";
    if (this.mode === "new") return "none-new";
    return "none-here";
  }

  get saves(): DeckSaves {
    const tally = this.deps.sync.tally(
      [...this.marked].map((id) => cardSaveKey(id)),
    );
    const count = (status: SyncStatus) => tally[status] ?? 0;
    return {
      saving: count("saving"),
      unsaved: count("failed") + count("offline"),
      offline: count("offline") > 0,
      signedOut: count("signed-out") > 0,
      refused:
        count("forbidden") +
        count("not-found") +
        count("invalid") +
        count("too-large"),
      saved: count("saved"),
    };
  }

  setFilter(filter: DeckFilter) {
    this.filter = filter;
    this.rebuild();
  }

  setMode(mode: DeckMode) {
    this.mode = mode;
    this.rebuild();
  }

  show() {
    if (!this.current) return;
    this.shown = true;
    this.focus = "know";
  }

  skip() {
    this.advance();
  }

  mark(state: CardState) {
    const card = this.current;
    if (!card || !this.shown) return;
    this.deps.progress.markCard(card.id, state);
    if (this.deps.progress.signedIn) this.marked.add(card.id);
    this.advance();
  }

  restart() {
    this.rebuild();
    this.focus = this.current ? "show" : "restart";
  }

  /**
   * Sends every unsaved mark again. Their Retry button goes away unless
   * some are still unsaved (offline): focus then goes to the status line.
   */
  retryUnsaved() {
    this.deps.sync.retryAll([...this.marked].map((id) => cardSaveKey(id)));
    if (!this.saves.unsaved) this.focus = "status";
  }

  focusDone() {
    this.focus = null;
  }

  private advance() {
    this.index += 1;
    this.shown = false;
    this.focus = this.index < this.queue.length ? "show" : "restart";
  }

  private rebuild() {
    this.queue = deckQueue(
      deckScope(this.cards, this.filter),
      this.mode,
      this.stateOf,
      this.deps.random,
    );
    this.index = 0;
    this.shown = false;
  }
}
