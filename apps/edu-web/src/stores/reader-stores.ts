import type { AssistStatus, ProgressResponse } from "@outegro/contracts/edu";
import {
  type ExerciseBlock,
  type Random,
  SeededRandom,
  seedOf,
} from "@outegro/edu-engine";
import type { AssistKind } from "@/lib/assist/protocol";
import type { AssistTransport } from "@/lib/assist/transport";
import type { KeyValueStorage } from "@/lib/browser";
import type { ReaderApi } from "@/lib/reader-api";
import type { SqlRunner } from "@/lib/sql/engine";
import { AnswerStore, type OnDone } from "./answer-store";
import { AssistStore } from "./assist-store";
import { AttemptStore } from "./attempt-store";
import { ExplainPanelStore } from "./explain-panel-store";
import { ExplainPreferenceStore } from "./explain-preference-store";
import type { Shuffles } from "./order-store";
import { ReaderProgressStore } from "./reader-progress-store";
import { SectionSpyStore } from "./section-spy-store";
import { SqlHintStore } from "./sql-hint-store";
import type { SqlTaskStore } from "./sql-task-store";
import { SyncStatusStore } from "./sync-status-store";
import { UnderstandingStore } from "./understanding-store";

/** What the reader's stores need from the outside world. */
export type ReaderServices = {
  api: ReaderApi;
  storage: KeyValueStorage;
  isOnline: () => boolean;
  newKey: () => string;
  /** "Try again" reshuffles. */
  random: Random;
  sql: SqlRunner;
  /** The reading assistant, through this app's route handler. */
  assist: AssistTransport;
  /** The clock (when today's assistant limit resets). */
  now: () => Date;
};

export type ReaderInit = {
  slug: string;
  signedIn: boolean;
  progress: ProgressResponse | null;
  /** The SQL sandbox's seed, for pages that have one. */
  sandboxSeed: string | null;
  /**
   * A new number with every page view, sent with the page: the first
   * shuffles of its exercises and its deck differ from visit to visit, yet
   * the server render and the browser agree on them.
   */
  shuffleSeed: number;
  /**
   * The assistant's status with the page; null when unknown (signed out,
   * or it did not load): then the page has no helpers at all.
   */
  assist: AssistStatus | null;
};

/**
 * The stores one reading page shares: saves and their statuses, the
 * reader's progress, the preferred explanation view, the assistant and
 * the section in view, plus the services the islands' own stores are built
 * with. One object for the page's life, so its provider never re-renders
 * anything.
 */
export type ReaderStores = Readonly<{
  slug: string;
  signedIn: boolean;
  sandboxSeed: string | null;
  sync: SyncStatusStore;
  progress: ReaderProgressStore;
  explain: ExplainPreferenceStore;
  assist: AssistStore;
  sections: SectionSpyStore;
  services: ReaderServices;
  /** The first shuffle of an exercise or the deck (`key`: its id). */
  firstShuffle: (key: string) => Random;
}>;

export function createReaderStores(
  init: ReaderInit,
  services: ReaderServices,
): ReaderStores {
  const sync = new SyncStatusStore({ isOnline: services.isOnline });
  const progress = new ReaderProgressStore(
    { slug: init.slug, signedIn: init.signedIn, progress: init.progress },
    { api: services.api, sync, newKey: services.newKey },
  );
  const explain = new ExplainPreferenceStore(
    init.progress?.explainView ?? null,
    {
      signedIn: init.signedIn,
      storage: services.storage,
      save: (view) =>
        services.api.savePosition({ slug: init.slug, explainView: view }),
    },
  );
  const assist = new AssistStore(
    { status: init.assist },
    { now: services.now },
  );
  return Object.freeze({
    slug: init.slug,
    signedIn: init.signedIn,
    sandboxSeed: init.sandboxSeed,
    sync,
    progress,
    explain,
    assist,
    sections: new SectionSpyStore(),
    services,
    firstShuffle: (key: string) =>
      new SeededRandom((seedOf(key) ^ init.shuffleSeed) >>> 0),
  });
}

/** The attempt of one exercise on this page. */
export function createAttempt(stores: ReaderStores, exercise: ExerciseBlock) {
  return new AttemptStore(exercise, {
    slug: stores.slug,
    signedIn: stores.signedIn,
    api: stores.services.api,
    sync: stores.sync,
    progress: stores.progress,
    newKey: stores.services.newKey,
  });
}

/** The shuffles of one exercise on this page. */
export function shufflesOf(stores: ReaderStores, id: string): Shuffles {
  return { first: stores.firstShuffle(id), random: stores.services.random };
}

/** One answer of the assistant on this page. */
export function createAnswer<K extends AssistKind>(
  stores: ReaderStores,
  kind: K,
  onDone?: OnDone,
) {
  return new AnswerStore(kind, {
    slug: stores.slug,
    transport: stores.services.assist,
    assist: stores.assist,
    isOnline: stores.services.isOnline,
    onDone,
  });
}

/** "Explain it differently" under a section heading. */
export function createExplainPanel(
  stores: ReaderStores,
  chapter: number,
  section: string,
) {
  return new ExplainPanelStore(
    { chapter, section },
    createAnswer(stores, "explain"),
  );
}

/** Where the "explain it in your own words" draft of a chapter is kept. */
export const retellingDraftKey = (slug: string, chapter: number) =>
  `edu.retelling.${slug}.${chapter}`;

/** "Explain it in your own words" for a chapter; its score joins the progress. */
export function createUnderstanding(stores: ReaderStores, chapter: number) {
  const answer = createAnswer(stores, "understanding", (done) => {
    if (done.score !== null)
      stores.progress.recordUnderstanding(chapter, done.score);
  });
  return new UnderstandingStore(chapter, answer, {
    progress: stores.progress,
    drafts: stores.services.storage,
    draftKey: retellingDraftKey(stores.slug, chapter),
  });
}

/** "What is wrong with my query" for an SQL task. */
export function createSqlHint(stores: ReaderStores, task: SqlTaskStore) {
  return new SqlHintStore(task, createAnswer(stores, "sql-hint"));
}
