import { z } from "zod";
import {
  adminReasonSchema,
  isoDateTime,
  localeSchema,
  pageQuerySchema,
  pageSchema,
} from "./primitives.js";

export { adminReasonSchema };

/**
 * Education (specification chapter 17): interactive textbooks at
 * edu.outegro.dev. A book is a typed document (no HTML) that edu-backend
 * stores and serves chapter by chapter after an access check; edu-web
 * renders it with the platform UI. Reading progress lives in edu-backend.
 * The rules (checking answers, SQL results, the deck, the simulator, text
 * for the assistant) live in `@outegro/edu-engine`; this file holds the
 * document shape, the wire formats and walking the document.
 */

/** Service key of grants and events. */
export const eduService = "edu";

/** Features granted by Payments through `billing.grant.changed.v1`. */
export const eduFeatures = {
  /** Every published book while the grant is active. */
  library: "library",
  /** One book, e.g. `book.nodejs-internals`. */
  book: (slug: string) => `book.${slug}`,
} as const;

export const bookSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(64);

/* ---------- Document ---------- */

/** Inline text: a plain string or one of a closed set of marks. */
export type Inline =
  | string
  | { t: "code"; v: string }
  | { t: "b" | "i" | "dfn" | "sup" | "sub" | "u"; c: Inline[] }
  | { t: "a"; href: string; c: Inline[] }
  | { t: "br" };

export const inlineSchema: z.ZodType<Inline> = z.lazy(() =>
  z.union([
    z.string(),
    z.discriminatedUnion("t", [
      z.object({ t: z.literal("code"), v: z.string() }),
      z.object({
        t: z.enum(["b", "i", "dfn", "sup", "sub", "u"]),
        c: z.array(inlineSchema),
      }),
      z.object({
        t: z.literal("a"),
        /** Only https links and in-page anchors. */
        href: z.string().regex(/^(https:\/\/|#)/),
        c: z.array(inlineSchema),
      }),
      z.object({ t: z.literal("br") }),
    ]),
  ]),
);
const inlines = z.array(inlineSchema);

export const explainKinds = [
  "analogy",
  "steps",
  "code",
  "picture",
  "interview",
  "confuse",
  "deep",
] as const;
export const explainKindSchema = z.enum(explainKinds);
export type ExplainKind = z.infer<typeof explainKindSchema>;

export const noteToneSchema = z.enum(["tip", "trap", "interview", "deep"]);
export type NoteTone = z.infer<typeof noteToneSchema>;

/** Stable within a chapter: derived from the exercise text, not its position. */
export const exerciseIdSchema = z
  .string()
  .regex(/^[a-z]+\d*-[a-z]-[0-9a-f]{8}(-\d+)?$/);

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h3"; id: string; c: Inline[] }
  | { t: "h4"; id?: string; c: Inline[] }
  | { t: "ul" | "ol"; items: Block[][] }
  | { t: "code"; code: string; lang?: string; title?: string; out?: string }
  | { t: "out"; text: string }
  /** Sanitized SVG markup (whitelisted elements and attributes). */
  | { t: "figure"; svg: string; caption: Inline[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "note"; tone: NoteTone; title: string; body: Block[] }
  | { t: "recap"; title: string; body: Block[] }
  | { t: "details"; summary: Inline[]; body: Block[] }
  | {
      t: "explain";
      topic: string;
      views: { kind: ExplainKind; body: Block[] }[];
    }
  | {
      t: "quiz";
      id: string;
      q: Block[];
      options: Inline[][];
      answer: number[];
      why: Block[];
    }
  /** `items` are listed in the correct order; the reader gets them shuffled. */
  | { t: "order"; id: string; q: Block[]; items: Inline[][]; why: Block[] }
  | {
      t: "sort";
      id: string;
      q: Block[];
      buckets: { key: string; c: Inline[] }[];
      items: { key: string; c: Inline[] }[];
      why: Block[];
    }
  | { t: "cards"; cards: Card[] }
  /** A query the reader can edit and run in the book's SQL sandbox. */
  | { t: "sqlPlay"; sql: string }
  /**
   * The reader's query runs in the browser; edu-backend compares its result
   * with `expected`, the fingerprint of the solution's result on the seed.
   */
  | {
      t: "sqlTask";
      id: string;
      q: Block[];
      hint: Inline[] | null;
      solution: string;
      ordered: boolean;
      expected: SqlExpectation;
    }
  /** The book's event loop simulator (`eventLoop` on the book). */
  | { t: "eventLoop" }
  /** Reference of the sandbox tables, built from the sandbox seed. */
  | { t: "schema" };

export type Card = { id: string; front: Inline[]; back: Inline[] };

/** Card ids follow the exercise id format (`n01-c-<hash>`). */
export const cardIdSchema = exerciseIdSchema;

export const cardSchema = z.object({
  id: cardIdSchema,
  front: inlines,
  back: inlines,
});

/**
 * The solution's result on the seed, as `@outegro/edu-engine` fingerprints
 * it (column count, row count, normalized rows; sorted unless `ordered`).
 * Not secret: the solution itself is part of the book.
 */
export type SqlExpectation = {
  columns: number;
  rows: number;
  fingerprint: string;
};

export const sqlExpectationSchema = z.object({
  columns: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
});

export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("t", [
    z.object({ t: z.literal("p"), c: inlines }),
    z.object({ t: z.literal("h3"), id: z.string().min(1), c: inlines }),
    z.object({
      t: z.literal("h4"),
      id: z.string().min(1).optional(),
      c: inlines,
    }),
    z.object({ t: z.enum(["ul", "ol"]), items: z.array(blocks) }),
    z.object({
      t: z.literal("code"),
      code: z.string(),
      lang: z.string().max(32).optional(),
      title: z.string().max(200).optional(),
      out: z.string().optional(),
    }),
    z.object({ t: z.literal("out"), text: z.string() }),
    z.object({
      t: z.literal("figure"),
      svg: z.string().startsWith("<svg "),
      caption: inlines,
    }),
    z.object({
      t: z.literal("table"),
      head: z.array(inlines),
      rows: z.array(z.array(inlines)),
    }),
    z.object({
      t: z.literal("note"),
      tone: noteToneSchema,
      title: z.string(),
      body: blocks,
    }),
    z.object({ t: z.literal("recap"), title: z.string(), body: blocks }),
    z.object({ t: z.literal("details"), summary: inlines, body: blocks }),
    z.object({
      t: z.literal("explain"),
      topic: z.string(),
      views: z
        .array(z.object({ kind: explainKindSchema, body: blocks }))
        .min(1),
    }),
    z.object({
      t: z.literal("quiz"),
      id: exerciseIdSchema,
      q: blocks,
      options: z.array(inlines).min(2),
      answer: z.array(z.number().int().nonnegative()).min(1),
      why: blocks,
    }),
    z.object({
      t: z.literal("order"),
      id: exerciseIdSchema,
      q: blocks,
      items: z.array(inlines).min(2),
      why: blocks,
    }),
    z.object({
      t: z.literal("sort"),
      id: exerciseIdSchema,
      q: blocks,
      buckets: z.array(z.object({ key: z.string().min(1), c: inlines })).min(2),
      items: z.array(z.object({ key: z.string().min(1), c: inlines })).min(1),
      why: blocks,
    }),
    z.object({ t: z.literal("cards"), cards: z.array(cardSchema).min(1) }),
    z.object({ t: z.literal("sqlPlay"), sql: z.string().min(1) }),
    z.object({
      t: z.literal("sqlTask"),
      id: exerciseIdSchema,
      q: blocks,
      hint: inlines.nullable(),
      solution: z.string().min(1),
      ordered: z.boolean(),
      expected: sqlExpectationSchema,
    }),
    z.object({ t: z.literal("eventLoop") }),
    z.object({ t: z.literal("schema") }),
  ]),
);
const blocks = z.array(blockSchema);

/* Event loop simulator: each step lists only what changed since the previous one. */

export const eventLoopPhaseSchema = z.enum([
  "main",
  "ticks",
  "micro",
  "timers",
  "pending",
  "poll",
  "check",
  "close",
  "exit",
]);
export type EventLoopPhase = z.infer<typeof eventLoopPhaseSchema>;

const queue = z.array(z.string());
export const eventLoopStepSchema = z.object({
  /** Highlighted code line, 1-based; 0 means none. */
  l: z.number().int().nonnegative().optional(),
  ph: eventLoopPhaseSchema.optional(),
  stack: queue.optional(),
  tick: queue.optional(),
  micro: queue.optional(),
  timers: queue.optional(),
  check: queue.optional(),
  io: queue.optional(),
  out: queue.optional(),
  note: inlines.optional(),
});
export type EventLoopStep = z.infer<typeof eventLoopStepSchema>;

export const eventLoopScenarioSchema = z.object({
  name: z.string().min(1),
  code: z.array(z.string()),
  steps: z.array(eventLoopStepSchema).min(1),
});
export type EventLoopScenario = z.infer<typeof eventLoopScenarioSchema>;

export const chapterSchema = z.object({
  /** Anchor of the chapter in the source book, e.g. `n01`. */
  id: z.string().regex(/^[a-z]+\d+$/),
  n: z.number().int().positive(),
  short: z.string().min(1).max(80),
  kicker: z.string(),
  title: z.string().min(1),
  lead: inlines,
  blocks,
});
export type Chapter = z.infer<typeof chapterSchema>;

export const bookStatsSchema = z.object({
  chapters: z.number().int().nonnegative(),
  figures: z.number().int().nonnegative(),
  exercises: z.number().int().nonnegative(),
  explain: z.number().int().nonnegative(),
  sandboxes: z.number().int().nonnegative(),
  cards: z.number().int().nonnegative(),
});
export type BookStats = z.infer<typeof bookStatsSchema>;

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
/** The book's accent colours; the platform applies them to figures and exercises only. */
const themeSchema = z.object({ accent: hexColor, accentDark: hexColor });

/** The whole book as stored in the repository and imported by edu-backend. */
export const bookDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  slug: bookSlugSchema,
  locale: localeSchema,
  title: z.string().min(1).max(200),
  kicker: z.string().max(200),
  lead: inlines,
  /** Cover illustration, sanitized SVG. */
  cover: z.string().startsWith("<svg "),
  theme: themeSchema,
  /** Introduction before chapter 1 (the SQL book's training database). */
  preface: z
    .object({
      id: z.string().min(1),
      kicker: z.string(),
      title: z.string().min(1),
      blocks,
    })
    .optional(),
  chapters: z.array(chapterSchema).min(1),
  deck: z.object({
    kicker: z.string(),
    title: z.string(),
    intro: z.array(inlines),
  }),
  note: inlines.optional(),
  sandbox: z
    .object({ engine: z.literal("sqlite"), seed: z.string().min(1) })
    .optional(),
  eventLoop: z
    .object({ scenarios: z.array(eventLoopScenarioSchema).min(1) })
    .optional(),
  stats: bookStatsSchema,
});
export type BookDocument = z.infer<typeof bookDocumentSchema>;

/* ---------- Access ---------- */

export const bookStatusSchema = z.enum(["draft", "published", "archived"]);
export type BookStatus = z.infer<typeof bookStatusSchema>;

/**
 * Who reads a published book. `grant` needs an active Payments grant of
 * service `edu` with one of `features`; the first `previewChapters` chapters
 * stay open to any signed-in reader. Staff with `edu.read` read everything,
 * drafts included.
 */
export const accessRuleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("free") }),
  z.object({ mode: z.literal("signed_in") }),
  z.object({
    mode: z.literal("grant"),
    features: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9.-]*$/)
          .max(64),
      )
      .min(1)
      .max(10),
    previewChapters: z.number().int().min(0).max(50),
  }),
]);
export type AccessRule = z.infer<typeof accessRuleSchema>;

/** Why the reader may or may not open a chapter. */
export const chapterAccessSchema = z.enum([
  /** Open to everyone or to every signed-in reader. */
  "open",
  /** One of the first chapters of a paid book. */
  "preview",
  /** An active grant covers the book. */
  "granted",
  /** Staff preview through `edu.read`. */
  "staff",
  /** Sign in first. */
  "sign_in",
  /** Needs a grant the reader does not have. */
  "locked",
]);
export type ChapterAccess = z.infer<typeof chapterAccessSchema>;

/* ---------- Reader API (edu-web BFF -> edu-backend, /v1) ---------- */

/**
 * GET   /v1/books                          library (token optional)
 * GET   /v1/books/:slug                    book and table of contents (token optional)
 * GET   /v1/books/:slug/chapters/:n        chapter content, or 401/403 with the reason
 * GET   /v1/books/:slug/preface            introduction (same access as chapter 1)
 * GET   /v1/books/:slug/cards              flash cards of the chapters the reader can open
 * GET   /v1/me/books/:slug/progress        the reader's own progress
 * POST  /v1/me/books/:slug/exercises/:id/attempts  the reader's answer → { correct, solved }
 * PUT   /v1/me/books/:slug/cards/:id       { state }
 * PATCH /v1/me/books/:slug/progress        { lastChapter?, explainView? }
 *
 * Attempts and card states take an optional `Idempotency-Key` (UUID): the
 * same key with the same body replays the stored outcome without counting
 * again; the same key with another body is 409 IDEMPOTENCY_CONFLICT.
 */

/** Access to a book as a whole: the same values as for one chapter. */
export const bookAccessSchema = chapterAccessSchema;
export type BookAccess = z.infer<typeof bookAccessSchema>;

export const bookSummarySchema = z.object({
  slug: bookSlugSchema,
  title: z.string(),
  kicker: z.string(),
  lead: inlines,
  cover: z.string(),
  theme: themeSchema,
  locale: localeSchema,
  stats: bookStatsSchema,
  status: bookStatusSchema,
  /** Bumped by every content import that changed the book. */
  contentVersion: z.number().int().positive(),
  /** Access to the book as a whole for the caller. */
  access: bookAccessSchema,
  /** Features that unlock the book (empty for open books). */
  features: z.array(z.string()),
  previewChapters: z.number().int().nonnegative(),
  progress: z
    .object({
      exercisesSolved: z.number().int().nonnegative(),
      cardsKnown: z.number().int().nonnegative(),
      lastChapter: z.number().int().positive().nullable(),
    })
    .nullable(),
});
export type BookSummary = z.infer<typeof bookSummarySchema>;

export const libraryResponseSchema = z.object({
  books: z.array(bookSummarySchema),
});
export type LibraryResponse = z.infer<typeof libraryResponseSchema>;

export const tocChapterSchema = z.object({
  n: z.number().int().positive(),
  id: z.string(),
  short: z.string(),
  title: z.string(),
  sections: z.array(z.object({ id: z.string(), title: z.string() })),
  exercises: z.number().int().nonnegative(),
  cards: z.number().int().nonnegative(),
  access: chapterAccessSchema,
});
export type TocChapter = z.infer<typeof tocChapterSchema>;

export const bookResponseSchema = z.object({
  book: bookSummarySchema,
  chapters: z.array(tocChapterSchema),
  preface: z
    .object({ id: z.string(), kicker: z.string(), title: z.string() })
    .nullable(),
  deck: z.object({
    kicker: z.string(),
    title: z.string(),
    intro: z.array(inlines),
  }),
  note: inlines.nullable(),
  hasSandbox: z.boolean(),
});
export type BookResponse = z.infer<typeof bookResponseSchema>;

const bookRefSchema = z.object({
  slug: bookSlugSchema,
  title: z.string(),
  contentVersion: z.number().int().positive(),
  theme: themeSchema,
  locale: localeSchema,
});
const sandboxSchema = z
  .object({ engine: z.literal("sqlite"), seed: z.string().min(1) })
  .nullable();

export const chapterResponseSchema = z.object({
  book: bookRefSchema,
  chapter: chapterSchema,
  access: chapterAccessSchema,
  prev: z.object({ n: z.number().int(), short: z.string() }).nullable(),
  next: z.object({ n: z.number().int(), short: z.string() }).nullable(),
  /** Present when the chapter uses the event loop simulator. */
  eventLoop: z
    .object({ scenarios: z.array(eventLoopScenarioSchema) })
    .nullable(),
  /** Present when the chapter uses the SQL sandbox. */
  sandbox: sandboxSchema,
});
export type ChapterResponse = z.infer<typeof chapterResponseSchema>;

export const prefaceResponseSchema = z.object({
  book: bookRefSchema,
  preface: z.object({
    id: z.string(),
    kicker: z.string(),
    title: z.string(),
    blocks,
  }),
  sandbox: sandboxSchema,
});
export type PrefaceResponse = z.infer<typeof prefaceResponseSchema>;

export const deckResponseSchema = z.object({
  book: bookRefSchema,
  chapters: z.array(
    z.object({
      n: z.number().int().positive(),
      short: z.string(),
      cards: z.array(cardSchema),
    }),
  ),
  /** Cards of chapters the reader cannot open yet. */
  lockedCards: z.number().int().nonnegative(),
});
export type DeckResponse = z.infer<typeof deckResponseSchema>;

export const cardStateSchema = z.enum(["know", "again"]);
export type CardState = z.infer<typeof cardStateSchema>;

export const progressResponseSchema = z.object({
  /** Solved stays solved; a failed first attempt is recorded as `false`. */
  exercises: z.record(exerciseIdSchema, z.boolean()),
  cards: z.record(cardIdSchema, cardStateSchema),
  lastChapter: z.number().int().positive().nullable(),
  explainView: explainKindSchema.nullable(),
  /** Best "explain it in your own words" score per chapter number (1–10). */
  understanding: z.record(
    z.string().regex(/^[1-9]\d*$/),
    z.number().int().min(1).max(10),
  ),
});
export type ProgressResponse = z.infer<typeof progressResponseSchema>;

/**
 * POST /v1/me/books/:slug/exercises/:id/attempts — the reader's answer, not
 * a verdict: edu-backend checks it against the book with
 * `@outegro/edu-engine` and records the outcome (the server decides).
 * `sort.placement[i]` is the bucket chosen for item i (document order);
 * `order.order` lists item indices in the reader's order; an SQL task sends
 * its last result, cells normalized by the engine (`normalizeCell`).
 */
export const exerciseAttemptSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("quiz"),
      selected: z.array(z.number().int().nonnegative().max(49)).min(1).max(50),
    })
    .strict(),
  z
    .object({
      kind: z.literal("order"),
      order: z.array(z.number().int().nonnegative().max(99)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sort"),
      placement: z.array(z.string().min(1).max(64)).min(1).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sqlTask"),
      columns: z.number().int().nonnegative().max(100),
      rowCount: z.number().int().nonnegative(),
      /** At most 200 rows; a longer result is wrong for every book task. */
      rows: z.array(z.array(z.string().max(500)).max(100)).max(200),
    })
    .strict(),
]);
export type ExerciseAttempt = z.infer<typeof exerciseAttemptSchema>;

export const attemptResultSchema = z.object({
  /** This attempt. */
  correct: z.boolean(),
  /** Stored outcome: solved once means solved. */
  solved: z.boolean(),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;

export const cardResultSchema = z.object({ state: cardStateSchema }).strict();
export const positionSchema = z
  .object({
    lastChapter: z.number().int().positive().optional(),
    explainView: explainKindSchema.optional(),
  })
  .strict();

/* ---------- Assistant (signed-in readers of an open chapter) ---------- */

/**
 * The language model behind "explain it differently", "explain it in your
 * own words" and "what is wrong with my query" (ADR-010). edu-backend holds
 * the provider key, prompts with the book's own text, limits requests per
 * reader per day and answers as Server-Sent Events (`data:` JSON lines,
 * `assistEventSchema`); edu-web proxies the stream through its BFF.
 *
 * GET  /v1/me/assist                                  status and today's quota
 * POST /v1/me/books/:slug/assist/explain              a section, another way
 * POST /v1/me/books/:slug/assist/understanding        check a chapter retelling
 * POST /v1/me/books/:slug/assist/sql-hint             hint for a failed task
 */

export const assistStyleSchema = z.enum([
  "simpler",
  "analogy",
  "code",
  "deep",
  "interview",
  "mistakes",
]);
export type AssistStyle = z.infer<typeof assistStyleSchema>;

export const assistStatusSchema = z.object({
  /** Off without a provider key, in SAFE_MODE, or when the owner turned it off. */
  enabled: z.boolean(),
  dailyLimit: z.number().int().nonnegative(),
  usedToday: z.number().int().nonnegative(),
});
export type AssistStatus = z.infer<typeof assistStatusSchema>;

export const assistExplainSchema = z
  .object({
    chapter: z.number().int().positive(),
    /** A top-level h3 anchor of the chapter. */
    section: z.string().min(1).max(120),
    style: assistStyleSchema.optional(),
    question: z.string().trim().min(3).max(500).optional(),
    /** The previous answer, for "another version": the model must not repeat it. */
    avoid: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) => (value.style === undefined) !== (value.question === undefined),
    {
      message: "either a style or a question",
    },
  );
export type AssistExplain = z.infer<typeof assistExplainSchema>;

export const assistUnderstandingSchema = z
  .object({
    chapter: z.number().int().positive(),
    text: z.string().trim().min(80).max(4000),
  })
  .strict();
export type AssistUnderstanding = z.infer<typeof assistUnderstandingSchema>;

/** How an SQL task check failed (`compareResults` in the engine, or an SQLite error). */
export const sqlProblemSchema = z.enum([
  "error",
  "empty",
  "columns",
  "rows",
  "values",
  "order",
]);
export type SqlProblem = z.infer<typeof sqlProblemSchema>;

export const assistSqlHintSchema = z
  .object({
    exerciseId: exerciseIdSchema,
    sql: z.string().min(1).max(4000),
    problem: sqlProblemSchema,
    /** SQLite's error message when `problem` is "error". */
    detail: z.string().max(500).optional(),
    /** The start of the reader's result (normalized cells). */
    mine: z
      .object({
        columns: z.array(z.string().max(200)).max(50),
        rows: z.array(z.array(z.string().max(200)).max(50)).max(8),
        rowCount: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();
export type AssistSqlHint = z.infer<typeof assistSqlHintSchema>;

export const assistEventSchema = z.discriminatedUnion("type", [
  /** The next piece of the answer (Markdown subset: paragraphs, lists, bold, code). */
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("done"),
    /** Served from the cache: same section, style and book version. */
    cached: z.boolean(),
    /** The answer hit the length limit. */
    truncated: z.boolean(),
    usedToday: z.number().int().nonnegative(),
    dailyLimit: z.number().int().nonnegative(),
    /** "Understanding" only: the model's 1–10 score, recorded when present. */
    score: z.number().int().min(1).max(10).nullable(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["RATE_LIMITED", "DEPENDENCY_UNAVAILABLE", "INTERNAL"]),
    messageKey: z.string(),
    retryable: z.boolean(),
  }),
]);
export type AssistEvent = z.infer<typeof assistEventSchema>;

/* ---------- Admin API (admin-web -> edu-backend, /v1/admin) ---------- */

/**
 * GET  /v1/admin/overview                            edu.read
 * GET  /v1/admin/books                               edu.read
 * GET  /v1/admin/books/:slug                         edu.read
 * POST /v1/admin/books/:slug/status                  edu.manage { status, expectedVersion, reason }
 * POST /v1/admin/books/:slug/access                  edu.manage { rule, expectedVersion, reason }
 * GET  /v1/admin/readers?book&userId&cursor&limit    edu.read
 * GET  /v1/admin/readers/:userId                     edu.read; 404 without progress and grants
 * GET  /v1/admin/audit?targetId&cursor&limit         edu.read
 */

export const adminBookSchema = z.object({
  slug: bookSlugSchema,
  title: z.string(),
  status: bookStatusSchema,
  rule: accessRuleSchema,
  contentVersion: z.number().int().positive(),
  contentHash: z.string(),
  stats: bookStatsSchema,
  readers: z.number().int().nonnegative(),
  importedAt: isoDateTime,
  publishedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
  /** Version of status and rule; commands send it back as `expectedVersion`. */
  version: z.number().int().nonnegative(),
});
export type AdminBook = z.infer<typeof adminBookSchema>;

export const adminBooksResponseSchema = z.object({
  items: z.array(adminBookSchema),
});

export const adminBookChapterSchema = z.object({
  n: z.number().int().positive(),
  short: z.string(),
  title: z.string(),
  exercises: z.number().int().nonnegative(),
  cards: z.number().int().nonnegative(),
  /** Readers whose last opened chapter is this one or a later one. */
  reached: z.number().int().nonnegative(),
});

export const adminBookDetailSchema = z.object({
  book: adminBookSchema,
  chapters: z.array(adminBookChapterSchema),
});
export type AdminBookDetail = z.infer<typeof adminBookDetailSchema>;

export const setBookStatusSchema = z
  .object({
    status: bookStatusSchema,
    expectedVersion: z.number().int().nonnegative(),
    reason: adminReasonSchema,
  })
  .strict();
export type SetBookStatus = z.infer<typeof setBookStatusSchema>;

export const setBookAccessSchema = z
  .object({
    rule: accessRuleSchema,
    expectedVersion: z.number().int().nonnegative(),
    reason: adminReasonSchema,
  })
  .strict();
export type SetBookAccess = z.infer<typeof setBookAccessSchema>;

export const bookCommandResultSchema = z.object({
  slug: bookSlugSchema,
  status: bookStatusSchema,
  rule: accessRuleSchema,
  version: z.number().int().nonnegative(),
});

/** Why a reader can open the paid chapters now; staff access is not known here. */
export const readerAccessSchema = z.enum([
  "open",
  "granted",
  "preview",
  "locked",
]);

export const adminReaderSchema = z.object({
  userId: z.uuid(),
  book: bookSlugSchema,
  exercisesSolved: z.number().int().nonnegative(),
  exercisesTotal: z.number().int().nonnegative(),
  cardsKnown: z.number().int().nonnegative(),
  cardsTotal: z.number().int().nonnegative(),
  lastChapter: z.number().int().positive().nullable(),
  access: readerAccessSchema,
  startedAt: isoDateTime,
  lastActiveAt: isoDateTime,
});
export type AdminReader = z.infer<typeof adminReaderSchema>;
export const adminReadersQuerySchema = pageQuerySchema.extend({
  book: bookSlugSchema.optional(),
  userId: z.uuid().optional(),
});
export const adminReadersPageSchema = pageSchema(adminReaderSchema);

export const adminGrantSchema = z.object({
  grantId: z.uuid(),
  feature: z.string(),
  sourceType: z.enum(["purchase", "subscription", "manual"]),
  state: z.enum(["active", "revoked", "expired"]),
  validFrom: isoDateTime,
  validUntil: isoDateTime.nullable(),
  /** Active now: state active and inside [validFrom, validUntil). */
  inForce: z.boolean(),
});

export const adminUserEducationSchema = z.object({
  userId: z.uuid(),
  grants: z.array(adminGrantSchema),
  books: z.array(adminReaderSchema),
});
export type AdminUserEducation = z.infer<typeof adminUserEducationSchema>;

export const eduAuditActionSchema = z.enum([
  "book.imported",
  "book.status.changed",
  "book.access.changed",
]);
export type EduAuditAction = z.infer<typeof eduAuditActionSchema>;

/** Same shape as the other services' audit entries; the target is a book slug. */
export const adminAuditEntrySchema = z.object({
  id: z.uuid(),
  /** null for content imports, which run with the migrations. */
  actorId: z.uuid().nullable(),
  action: eduAuditActionSchema,
  targetType: z.literal("book"),
  targetId: bookSlugSchema,
  /** null for content imports. */
  reason: z.string().nullable(),
  /** `{ before, after }` for changes, `{ contentVersion, contentHash }` for imports. */
  data: z.record(z.string(), z.unknown()),
  at: isoDateTime,
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;
export const adminAuditQuerySchema = pageQuerySchema.extend({
  targetId: bookSlugSchema.optional(),
});
export const adminAuditPageSchema = pageSchema(adminAuditEntrySchema);

export const adminOverviewSchema = z.object({
  books: z.object({
    published: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
  }),
  readers: z.object({
    total: z.number().int().nonnegative(),
    active7d: z.number().int().nonnegative(),
  }),
  grants: z.object({ inForce: z.number().int().nonnegative() }),
  exercisesSolved7d: z.number().int().nonnegative(),
  /** Readers active per day, oldest first: the last 14 days in UTC, today included. */
  activity: z.array(
    z.object({ day: z.iso.date(), readers: z.number().int().nonnegative() }),
  ),
  /** The language model over the last 7 days: what the owner pays for. */
  assist: z.object({
    enabled: z.boolean(),
    dailyLimit: z.number().int().nonnegative(),
    /** Model calls a day for all readers together; 0 = no cap. */
    globalDailyLimit: z.number().int().nonnegative(),
    /** Today's (UTC) calls counted against `globalDailyLimit`. */
    globalUsedToday: z.number().int().nonnegative(),
    requests7d: z.number().int().nonnegative(),
    cached7d: z.number().int().nonnegative(),
    failed7d: z.number().int().nonnegative(),
    tokensIn7d: z.number().int().nonnegative(),
    tokensOut7d: z.number().int().nonnegative(),
  }),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;
