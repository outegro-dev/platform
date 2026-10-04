import { userStatusSchema } from "@outegro/contracts";
import {
  type AccessRule,
  adminGrantSchema,
  type BookDocument,
  bookDocumentSchema,
  bookStatusSchema,
  type Card,
  type Chapter,
  cardStateSchema,
  eduAuditActionSchema,
  explainKinds,
} from "@outegro/contracts/edu";
import { platformTables } from "@outegro/db/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** A contract enum's values as the non-empty tuple Drizzle's text enums take. */
const valuesOf = <T extends string>(schema: { options: T[] }) =>
  schema.options as [T, ...T[]];

export const { outbox, inbox } = platformTables;

/** What the reader asked the assistant for. */
export const assistKinds = ["explain", "understanding", "sql_hint"] as const;
/**
 * How a request to the assistant ended: `ok` the answer came in full,
 * `failed` it broke off after the reader got part of it, `refused` the
 * reader got nothing (the provider refused or failed first, or the reader
 * left before the first words).
 */
export const assistOutcomes = ["ok", "failed", "refused"] as const;

/** The book document without its chapters, which have rows of their own. */
export type BookMeta = Pick<
  BookDocument,
  | "kicker"
  | "lead"
  | "cover"
  | "theme"
  | "preface"
  | "deck"
  | "note"
  | "sandbox"
  | "eventLoop"
  | "stats"
>;

/** A top-level h3 of a chapter: its anchor and its title as plain text. */
export type ChapterSection = { id: string; title: string };

/**
 * A book imported from content/ with the migrations. The import owns the
 * content (title, meta, chapters, content_version and hash); the admin
 * console owns status and rule, versioned by `version` (`expectedVersion`).
 */
export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  locale: text("locale", {
    enum: valuesOf(bookDocumentSchema.shape.locale),
  }).notNull(),
  status: text("status", { enum: valuesOf(bookStatusSchema) }).notNull(),
  rule: jsonb("rule").$type<AccessRule>().notNull(),
  /** Bumped by every import that changed the document. */
  contentVersion: integer("content_version").notNull(),
  /** sha256 of the validated document as JSON. */
  contentHash: text("content_hash").notNull(),
  meta: jsonb("meta").$type<BookMeta>().notNull(),
  /** Version of status and rule: admin commands only. */
  version: integer("version").notNull().default(0),
  importedAt: at("imported_at").notNull(),
  publishedAt: at("published_at"),
  createdAt: at("created_at").notNull(),
  updatedAt: at("updated_at").notNull(),
});

/**
 * One chapter of a book, replaced as a whole by an import that changed the
 * book. Exercise and card ids, sections and the sandbox and simulator flags
 * are derived from the document at import, so the table of contents, the
 * deck and access checks never parse whole chapters.
 */
export const chapters = pgTable(
  "chapters",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    /** Anchor of the chapter in the book, e.g. `n01`. */
    key: text("key").notNull(),
    short: text("short").notNull(),
    title: text("title").notNull(),
    document: jsonb("document").$type<Chapter>().notNull(),
    exerciseIds: text("exercise_ids").array().notNull(),
    cardIds: text("card_ids").array().notNull(),
    /** The chapter's flash cards in reading order (the deck). */
    cards: jsonb("cards").$type<Card[]>().notNull(),
    sections: jsonb("sections").$type<ChapterSection[]>().notNull(),
    usesEventLoop: boolean("uses_event_loop").notNull(),
    usesSandbox: boolean("uses_sandbox").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.n] })],
);

/** A reader's place in a book; created by the reader's first progress write. */
export const readerProgress = pgTable(
  "reader_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    lastChapter: integer("last_chapter"),
    explainView: text("explain_view", { enum: explainKinds }),
    startedAt: at("started_at").notNull(),
    lastActiveAt: at("last_active_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("reader_progress_user_book_uq").on(t.userId, t.bookId),
    index("reader_progress_active_idx").on(t.lastActiveAt, t.id),
    index("reader_progress_book_idx").on(t.bookId, t.lastActiveAt),
  ],
);

/**
 * Exercise answers: solved stays solved, every attempt counts. The last
 * attempt's Idempotency-Key, a hash of its body and its verdict make a
 * retried request a replay instead of another attempt.
 */
export const exerciseResults = pgTable(
  "exercise_results",
  {
    userId: uuid("user_id").notNull(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    solved: boolean("solved").notNull(),
    attempts: integer("attempts").notNull(),
    firstSolvedAt: at("first_solved_at"),
    lastAttemptKey: uuid("last_attempt_key"),
    /** sha256 of the last attempt's body: the same key with another body is 409. */
    lastAttemptHash: text("last_attempt_hash"),
    lastCorrect: boolean("last_correct"),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId, t.exerciseId] }),
    index("exercise_results_solved_idx")
      .on(t.firstSolvedAt)
      .where(sql`${t.firstSolvedAt} is not null`),
  ],
);

/** The reader's last mark of each flash card, with the Idempotency-Key that set it. */
export const cardStatesTable = pgTable(
  "card_states",
  {
    userId: uuid("user_id").notNull(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    state: text("state", { enum: valuesOf(cardStateSchema) }).notNull(),
    lastKey: uuid("last_key"),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bookId, t.cardId] })],
);

/**
 * "Explain it in your own words": the assistant's 1–10 score of the reader's
 * retelling of a chapter. The best score is the one progress shows.
 */
export const understandingChecks = pgTable(
  "understanding_checks",
  {
    userId: uuid("user_id").notNull(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    /** Chapter number. */
    chapter: integer("chapter").notNull(),
    bestScore: smallint("best_score").notNull(),
    lastScore: smallint("last_score").notNull(),
    checks: integer("checks").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bookId, t.chapter] })],
);

/**
 * Every request the assistant served, from the model or from the cache: the
 * reader's daily limit (today's uncached requests that reached the reader)
 * and the owner's bill (tokens).
 */
export const assistUsage = pgTable(
  "assist_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    kind: text("kind", { enum: assistKinds }).notNull(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    /** Chapter number. */
    chapter: integer("chapter").notNull(),
    cached: boolean("cached").notNull(),
    outcome: text("outcome", { enum: assistOutcomes }).notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    at: at("at").notNull(),
  },
  (t) => [
    index("assist_usage_user_at_idx").on(t.userId, t.at),
    index("assist_usage_at_idx").on(t.at),
  ],
);

/**
 * Answers to "explain this section in style X", shared by every reader of
 * the same book version. The key is a sha256 of what decides the answer
 * (book, content version, chapter, section, style, model, prompt revision).
 */
export const assistCache = pgTable("assist_cache", {
  key: text("key").primaryKey(),
  text: text("text").notNull(),
  createdAt: at("created_at").notNull(),
  hits: integer("hits").notNull().default(0),
});

/** One row per reader and UTC day with any progress write (activity chart). */
export const readerDays = pgTable(
  "reader_days",
  {
    userId: uuid("user_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    index("reader_days_day_idx").on(t.day),
  ],
);

/**
 * Projection of commercial grants owned by Payments (billing.grant.changed,
 * service "edu" only). `version` is the aggregateVersion: older events
 * never overwrite newer state.
 */
export const grants = pgTable(
  "grants",
  {
    grantId: uuid("grant_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    feature: text("feature").notNull(),
    sourceType: text("source_type", {
      enum: valuesOf(adminGrantSchema.shape.sourceType),
    }).notNull(),
    sourceId: uuid("source_id").notNull(),
    state: text("state", {
      enum: valuesOf(adminGrantSchema.shape.state),
    }).notNull(),
    validFrom: at("valid_from").notNull(),
    validUntil: at("valid_until"),
    version: integer("version").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [index("grants_user_idx").on(t.userId, t.feature)],
);

/**
 * Projection of Identity accounts that changed status or roles: readers who
 * are suspended or deleted read nothing, and admin commands refuse tokens
 * issued before the latest change (`access_version`).
 */
export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey(),
  status: text("status", { enum: valuesOf(userStatusSchema) })
    .notNull()
    .default("active"),
  /** The newest accessVersion seen: status and role changes both bump it. */
  accessVersion: integer("access_version").notNull().default(0),
  /**
   * The accessVersion the stored status was set at: an older status event
   * changes nothing, and role changes leave it alone.
   */
  statusVersion: integer("status_version").notNull().default(0),
  updatedAt: at("updated_at").notNull(),
});

/**
 * Append-only record of book changes: admin commands (actor and reason) and
 * content imports, which run with the migrations (neither).
 */
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action", { enum: valuesOf(eduAuditActionSchema) }).notNull(),
    targetType: text("target_type", { enum: ["book"] }).notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: at("at").notNull(),
  },
  (t) => [
    index("admin_audit_at_idx").on(t.at, t.id),
    index("admin_audit_target_idx").on(t.targetType, t.targetId, t.at),
  ],
);
