/**
 * Hermetic stand-in for the platform services during e2e tests (port 4198):
 * identity (SSO /authorize, code exchange with PKCE, refresh, logout, /v1/me
 * under /identity), the edu-backend reader API and the public payments
 * catalog. The books are the REAL documents in
 * ../edu-backend/content/books, published with the rules of
 * ../edu-backend/content/manifest.json (initialRule), and the access rules
 * follow the contract: staff with edu.read read everything, a grant opens a
 * book, the first previewChapters chapters (and the preface) open to any
 * signed-in reader. Progress is kept in memory. Every reader response is
 * parsed with the @outegro/contracts/edu schemas before it is sent, so the
 * app is tested against the real wire format. Attempts are judged the way
 * edu-backend judges them: with @outegro/edu-engine against the served
 * book (SQL tasks by the fingerprint `expected`), once per Idempotency-Key.
 *
 * The reading assistant answers like edu-backend (refusals in its order,
 * then Server-Sent Events): scripted Markdown answers in pieces with a
 * `: keep-alive` first, `done` with the day's count (and a score of 8 for
 * an understanding check, recorded as the best one), style answers cached
 * per user and served even at the reader's limit and while paused (the
 * shared daily limit of all readers, set per user here so tests stay
 * apart: 503 with fieldErrors.assist ["paused"]).
 *
 * Tests steer failures per user through /__e2e (the app never calls it):
 *   POST /__e2e/faults   { userId, route, mode, status?, reason?, times?, delayMs?, verdict? }
 *   GET  /__e2e/attempts?userId&exerciseId   what the server recorded
 *   POST /__e2e/assist   { userId, enabled?, paused?, dailyLimit?, usedToday? }   the user's assistant
 *   GET  /__e2e/assist?userId   what the assistant was asked, answers cut off by the reader
 * A browser whose user agent contains "e2e-free-books" reads every book as free.
 *
 *   node e2e/fake-platform.ts
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permissionsOf } from "@outegro/contracts";
import {
  type AccessRule,
  type AssistEvent,
  accessRuleSchema,
  assistEventSchema,
  assistExplainSchema,
  assistSqlHintSchema,
  assistStatusSchema,
  assistUnderstandingSchema,
  attemptResultSchema,
  type Block,
  type BookAccess,
  type BookDocument,
  bookDocumentSchema,
  bookResponseSchema,
  type CardState,
  type ChapterAccess,
  cardResultSchema,
  chapterResponseSchema,
  deckResponseSchema,
  type ExplainKind,
  exerciseAttemptSchema,
  type Inline,
  libraryResponseSchema,
  positionSchema,
  prefaceResponseSchema,
  progressResponseSchema,
} from "@outegro/contracts/edu";
import {
  cardsOf,
  checkAttempt,
  type ExerciseBlock,
  exerciseIdsOf,
  InvalidAttempt,
  isExercise,
  readableAccess,
  walkBlocks,
} from "@outegro/edu-engine";
import { z } from "zod";
import {
  emailOf,
  isPersona,
  type Persona,
  personas,
} from "./support/personas.ts";

const PORT = Number(process.env.FAKE_PLATFORM_PORT ?? 4198);
/** In a browser's user agent: every book is served as free (see the reader API). */
const FREE_BOOKS = "e2e-free-books";
const APP_ORIGIN = process.env.FAKE_APP_ORIGIN ?? "http://localhost:3198";
const CALLBACK = `${APP_ORIGIN}/auth/callback`;
const CLIENT_ID = "edu-web";

// ─── books ───────────────────────────────────────────────────────────────

const content = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../edu-backend/content",
);

type StoredBook = {
  document: BookDocument;
  rule: AccessRule;
  status: "draft" | "published" | "archived";
  contentVersion: number;
};

const manifest = JSON.parse(
  readFileSync(path.join(content, "manifest.json"), "utf8"),
) as {
  books: {
    file: string;
    initialStatus: StoredBook["status"];
    initialRule: unknown;
  }[];
};

const books = new Map<string, StoredBook>();
for (const entry of manifest.books) {
  const document = bookDocumentSchema.parse(
    JSON.parse(readFileSync(path.join(content, entry.file), "utf8")),
  );
  books.set(document.slug, {
    document,
    rule: accessRuleSchema.parse(entry.initialRule),
    status: entry.initialStatus,
    contentVersion: 1,
  });
}

// ─── users, sessions, progress ───────────────────────────────────────────

type User = { id: string; persona: Persona };
type Progress = {
  exercises: Record<string, boolean>;
  cards: Record<string, CardState>;
  lastChapter: number | null;
  explainView: ExplainKind | null;
  understanding: Record<string, number>;
};

const users = new Map<string, User>();
const codes = new Map<
  string,
  { persona: Persona; challenge: string; redirectUri: string }
>();
const sessions = new Map<string, { userId: string; revoked: boolean }>();
const refreshTokens = new Map<string, string>();
const progressByUser = new Map<string, Progress>();

function progressOf(user: User, slug: string): Progress {
  const key = `${user.id}/${slug}`;
  let progress = progressByUser.get(key);
  if (!progress) {
    progress = {
      exercises: {},
      cards: {},
      lastChapter: null,
      explainView: null,
      understanding: {},
    };
    progressByUser.set(key, progress);
  }
  return progress;
}

// ─── attempts, idempotency and faults ────────────────────────────────────

/** What the server recorded per user and exercise. */
const attempts = new Map<string, { count: number; keys: string[] }>();
/** Outcomes by user and Idempotency-Key: a retry replays, another body is 409. */
const idempotent = new Map<string, { body: string; outcome: unknown }>();
/** Requests seen per user and exercise, retries included. */
const requests = new Map<string, number>();

const faultSchema = z.object({
  userId: z.string(),
  /** assistStatus: GET /v1/me/assist (the page's status of the assistant). */
  route: z.enum(["attempts", "cards", "assist", "assistStatus"]),
  /**
   * drop: the connection breaks before anything is recorded. dropAfter: it
   * is recorded, then the connection breaks (a lost answer). status: the
   * server answers `status` (for the assistant with `reason` in
   * fieldErrors.assist). delay: the answer comes `delayMs` later (the
   * assistant: every piece of it). verdict: the server's verdict is
   * `verdict`, whatever the answer. streamError: the assistant's answer
   * breaks off after its first piece with a retryable error event.
   */
  mode: z.enum([
    "drop",
    "dropAfter",
    "status",
    "delay",
    "verdict",
    "streamError",
  ]),
  status: z.number().int().optional(),
  reason: z.enum(["daily_limit", "disabled", "paused", "busy"]).optional(),
  delayMs: z.number().int().nonnegative().optional(),
  verdict: z.object({ correct: z.boolean(), solved: z.boolean() }).optional(),
  times: z.number().int().positive().default(1),
});
type Fault = z.infer<typeof faultSchema>;
const faults = new Map<string, Fault[]>();

/** The next fault for a user's request on a route, used up as it applies. */
function takeFault(userId: string, route: Fault["route"]): Fault | null {
  const list = faults.get(userId) ?? [];
  const fault = list.find((item) => item.route === route);
  if (!fault) return null;
  fault.times -= 1;
  if (fault.times <= 0) list.splice(list.indexOf(fault), 1);
  return fault;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Breaks the connection: the app gets no answer at all. */
function drop(res: ServerResponse) {
  res.socket?.destroy();
}

/** The exercise of a book with this id, and the chapter whose access it has. */
function exerciseOf(
  book: StoredBook,
  id: string,
): { block: ExerciseBlock; chapter: number } | null {
  const doc = book.document;
  const places: { blocks: Block[]; chapter: number }[] = [
    ...(doc.preface ? [{ blocks: doc.preface.blocks, chapter: 1 }] : []),
    ...doc.chapters.map((chapter) => ({
      blocks: chapter.blocks,
      chapter: chapter.n,
    })),
  ];
  for (const place of places) {
    const found: ExerciseBlock[] = [];
    walkBlocks(place.blocks, (block) => {
      if (isExercise(block) && block.id === id) found.push(block);
    });
    const block = found[0];
    if (block) return { block, chapter: place.chapter };
  }
  return null;
}

// ─── the reading assistant ───────────────────────────────────────────────

/**
 * Each user's assistant: on or off, paused (the shared daily limit of all
 * readers used up), and today's answers. Tests set it through /__e2e/assist.
 */
type AssistState = {
  enabled: boolean;
  paused: boolean;
  dailyLimit: number;
  usedToday: number;
};
const assistStates = new Map<string, AssistState>();
const assistStateSchema = z.object({
  userId: z.string(),
  enabled: z.boolean().optional(),
  paused: z.boolean().optional(),
  dailyLimit: z.number().int().nonnegative().optional(),
  usedToday: z.number().int().nonnegative().optional(),
});
const freshAssist = (): AssistState => ({
  enabled: true,
  paused: false,
  dailyLimit: 30,
  usedToday: 0,
});

function assistOf(user: User): AssistState {
  let state = assistStates.get(user.id);
  if (!state) {
    state = freshAssist();
    assistStates.set(user.id, state);
  }
  return state;
}

/** What the assistant was asked, per user, and how many answers were cut off by the reader. */
const assistLog = new Map<
  string,
  { requests: { kind: string; body: unknown }[]; hangUps: number }
>();
function logOf(userId: string) {
  let log = assistLog.get(userId);
  if (!log) {
    log = { requests: [], hangUps: 0 };
    assistLog.set(userId, log);
  }
  return log;
}

/** Style answers kept like edu-backend's cache (per user here, so tests stay apart). */
const assistCache = new Map<string, string>();

const styleNames: Record<string, string> = {
  simpler: "Проще",
  analogy: "Другая аналогия",
  code: "На примере кода",
  deep: "Глубже",
  interview: "Как ответить на собесе",
  mistakes: "Частые ошибки",
};

/** The scripted answers: a little of every mark the page renders. */
function explainAnswer(
  sectionTitle: string,
  body: { style?: string; question?: string; avoid?: string },
) {
  if (body.question)
    return [
      `**Ответ на вопрос.** Вы спросили: «${body.question}».`,
      "",
      `Коротко: раздел «${sectionTitle}» отвечает на это так — смотрите на \`process.nextTick\` и очередь микрозадач.`,
    ].join("\n");
  const lead = body.avoid
    ? "**Другой вариант.**"
    : `**${styleNames[body.style ?? ""] ?? "Иначе"}.**`;
  return [
    `${lead} Раздел «${sectionTitle}» другими словами.`,
    "",
    "- Первое: цикл берёт задачи по очереди.",
    "- Второе: `setImmediate` выполняется в фазе check.",
    "  Это продолжение второго пункта.",
    "",
    "```js",
    'setImmediate(() => console.log("check"));',
    "```",
    "",
    "Итог: порядок задаёт цикл событий.",
  ].join("\n");
}

const understandingAnswer = [
  "**Что верно**",
  "- Ты верно описал, как устроен цикл событий.",
  "",
  "**Что упущено**",
  "- Фаза poll и ожидание ввода-вывода.",
  "",
  "**Ошибки** — нет.",
  "",
  "**Оценка понимания:** 8",
].join("\n");

const sqlHintAnswer = (problem: string) =>
  [
    `**Что не так.** Проверка: ${problem}.`,
    "",
    "Посмотрите на имя таблицы: в учебной базе она называется `customers`.",
  ].join("\n");

/** An answer in pieces, as a model would stream it. */
function piecesOf(text: string, count = 6): string[] {
  const size = Math.ceil(text.length / count);
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size)
    pieces.push(text.slice(i, i + size));
  return pieces;
}

/** Sends one contract event as a Server-Sent Event. */
function sendEvent(res: ServerResponse, event: AssistEvent) {
  const checked = assistEventSchema.parse(event);
  res.write(`data: ${JSON.stringify(checked)}\n\n`);
}

/**
 * Streams an answer: a keep-alive comment, the pieces (each `delayMs`
 * apart), then `done` — or a retryable error after the first piece. The
 * reader going away stops it (counted as a hang-up).
 */
async function streamAnswer(
  res: ServerResponse,
  user: User,
  answer: {
    text: string;
    cached: boolean;
    score: number | null;
    delayMs: number;
    breakOff: boolean;
    onDone?: () => void;
  },
) {
  let gone = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      gone = true;
      logOf(user.id).hangUps += 1;
    }
  });
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  res.write(": keep-alive\n\n");
  const state = assistOf(user);
  if (!answer.cached) state.usedToday += 1;
  const pieces = answer.cached ? [answer.text] : piecesOf(answer.text);
  for (const [index, piece] of pieces.entries()) {
    if (gone) return;
    if (!answer.cached) await sleep(answer.delayMs);
    if (gone) return;
    sendEvent(res, { type: "text", text: piece });
    if (answer.breakOff && index === 0) {
      sendEvent(res, {
        type: "error",
        code: "DEPENDENCY_UNAVAILABLE",
        messageKey: "errors.dependency_unavailable",
        retryable: true,
      });
      res.end();
      return;
    }
  }
  if (gone) return;
  sendEvent(res, {
    type: "done",
    cached: answer.cached,
    truncated: false,
    usedToday: state.usedToday,
    dailyLimit: state.dailyLimit,
    score: answer.score,
  });
  answer.onDone?.();
  res.end();
}

// ─── helpers ─────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function error(
  res: ServerResponse,
  status: number,
  code: string,
  fieldErrors: Record<string, string[]> = {},
) {
  send(res, status, {
    error: {
      code,
      messageKey: `errors.${code.toLowerCase()}`,
      fieldErrors,
      requestId: randomUUID(),
      retryable: status >= 500,
    },
  });
}

/** Sends a reader payload only if it matches the contract. */
function contract<T>(res: ServerResponse, schema: z.ZodType<T>, body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(
      "[fake-platform] response breaks the contract",
      parsed.error.issues.slice(0, 3),
    );
    error(res, 500, "INTERNAL");
    return;
  }
  send(res, 200, parsed.data);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return Symbol.for("invalid-json");
  }
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function jwt(payload: Record<string, unknown>): string {
  const head = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.${randomBytes(16).toString("base64url")}`;
}

function issueTokens(userId: string, sid: string = randomUUID()) {
  const now = Date.now();
  const refreshToken = randomBytes(32).toString("base64url");
  sessions.set(sid, { userId, revoked: false });
  refreshTokens.set(refreshToken, sid);
  return {
    sessionId: sid,
    accessToken: jwt({ sub: userId, sid, exp: Math.floor(now / 1000) + 900 }),
    accessTokenExpiresAt: new Date(now + 900_000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(now + 30 * 86_400_000).toISOString(),
  };
}

/** The user behind a Bearer token of a live session (every service checks it). */
function userFrom(req: IncomingMessage): User | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { sub?: string; sid?: string; exp?: number };
    if (!payload.sub || !payload.exp || payload.exp * 1000 < Date.now())
      return null;
    const session = payload.sid ? sessions.get(payload.sid) : undefined;
    if (!session || session.revoked || session.userId !== payload.sub)
      return null;
    return users.get(payload.sub) ?? null;
  } catch {
    return null;
  }
}

function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((node) =>
      typeof node === "string"
        ? node
        : node.t === "code"
          ? node.v
          : "c" in node
            ? plain(node.c)
            : " ",
    )
    .join("");
}

function uses(blocks: readonly Block[], types: Block["t"][]): boolean {
  let found = false;
  walkBlocks(blocks, (block) => {
    if (types.includes(block.t)) found = true;
  });
  return found;
}

// ─── access (the contract's rules) ───────────────────────────────────────

function isStaff(user: User | null): boolean {
  return Boolean(
    user && permissionsOf(personas[user.persona].roles).has("edu.read"),
  );
}

function hasGrant(user: User | null, rule: AccessRule): boolean {
  if (!user || rule.mode !== "grant") return false;
  return rule.features.some((feature) =>
    personas[user.persona].features.includes(feature),
  );
}

function visible(
  book: StoredBook | undefined,
  user: User | null,
): book is StoredBook {
  return Boolean(book && (book.status === "published" || isStaff(user)));
}

function bookAccess(book: StoredBook, user: User | null): BookAccess {
  if (isStaff(user)) return "staff";
  const { rule } = book;
  if (rule.mode === "free") return "open";
  if (!user) return "sign_in";
  if (rule.mode === "signed_in") return "open";
  if (hasGrant(user, rule)) return "granted";
  return rule.previewChapters > 0 ? "preview" : "locked";
}

function chapterAccess(
  book: StoredBook,
  user: User | null,
  n: number,
): ChapterAccess {
  if (isStaff(user)) return "staff";
  const { rule } = book;
  if (rule.mode === "free") return "open";
  if (!user) return "sign_in";
  if (rule.mode === "signed_in") return "open";
  if (hasGrant(user, rule)) return "granted";
  return n <= rule.previewChapters ? "preview" : "locked";
}

const readable = (access: ChapterAccess) => readableAccess.includes(access);

// ─── reader payloads ─────────────────────────────────────────────────────

function bookRef(book: StoredBook) {
  const { slug, title, theme, locale } = book.document;
  return { slug, title, theme, locale, contentVersion: book.contentVersion };
}

function summaryOf(book: StoredBook, user: User | null) {
  const doc = book.document;
  let progress = null;
  if (user) {
    const mine = progressOf(user, doc.slug);
    const exerciseIds = new Set(
      doc.chapters.flatMap((chapter) => exerciseIdsOf(chapter)),
    );
    progress = {
      exercisesSolved: Object.entries(mine.exercises).filter(
        ([id, solved]) => solved && exerciseIds.has(id),
      ).length,
      cardsKnown: Object.values(mine.cards).filter((state) => state === "know")
        .length,
      lastChapter: mine.lastChapter,
    };
  }
  return {
    slug: doc.slug,
    title: doc.title,
    kicker: doc.kicker,
    lead: doc.lead,
    cover: doc.cover,
    theme: doc.theme,
    locale: doc.locale,
    stats: doc.stats,
    status: book.status,
    contentVersion: book.contentVersion,
    access: bookAccess(book, user),
    features: book.rule.mode === "grant" ? book.rule.features : [],
    previewChapters: book.rule.mode === "grant" ? book.rule.previewChapters : 0,
    progress,
  };
}

function bookResponse(book: StoredBook, user: User | null) {
  const doc = book.document;
  return {
    book: summaryOf(book, user),
    chapters: doc.chapters.map((chapter) => ({
      n: chapter.n,
      id: chapter.id,
      short: chapter.short,
      title: chapter.title,
      sections: chapter.blocks
        .filter(
          (block): block is Extract<Block, { t: "h3" }> => block.t === "h3",
        )
        .map((block) => ({ id: block.id, title: plain(block.c) })),
      exercises: exerciseIdsOf(chapter).length,
      cards: cardsOf(chapter).length,
      access: chapterAccess(book, user, chapter.n),
    })),
    preface: doc.preface
      ? {
          id: doc.preface.id,
          kicker: doc.preface.kicker,
          title: doc.preface.title,
        }
      : null,
    deck: doc.deck,
    note: doc.note ?? null,
    hasSandbox: Boolean(doc.sandbox),
  };
}

/** The chapter of a book that holds an exercise or card id, if any. */
function chapterOfId(book: StoredBook, id: string, kind: "exercise" | "card") {
  return book.document.chapters.find((chapter) =>
    kind === "exercise"
      ? exerciseIdsOf(chapter).includes(id)
      : cardsOf(chapter).some((card) => card.id === id),
  );
}

// ─── payments: the public catalog (no product of service "edu") ───────────

const catalog = {
  checkoutEnabled: true,
  products: [
    {
      key: "battleship-premium",
      service: "battleship",
      feature: "premium",
      kind: "subscription",
      periodicity: "MONTHLY",
      graceDays: 3,
      title: { en: "Battleship Premium", ru: "Морской бой Premium" },
      description: {
        en: "Everything the game has.",
        ru: "Всё, что есть в игре.",
      },
      prices: [
        {
          priceId: "bp-rub",
          version: 1,
          money: { minor: "5000", currency: "RUB", scale: 2 },
        },
      ],
    },
    // Another service with a periodicity edu-web has never heard of.
    {
      key: "assistant-pro",
      service: "assistant",
      feature: "pro",
      kind: "subscription",
      periodicity: "YEARLY",
      title: { en: "Assistant Pro", ru: "Assistant Pro" },
      description: { en: "", ru: "" },
      prices: [],
    },
  ],
};

// ─── routes ──────────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  // Identity's API (AUTH_API_URL) lives under /identity: its /v1/me must not
  // collide with the reader API on this one port.
  const identity = url.pathname.startsWith("/identity/");
  const route = identity
    ? url.pathname.slice("/identity".length)
    : url.pathname;
  const method = req.method ?? "GET";

  if (route === "/health") return send(res, 200, { status: "ok" });

  // Test controls.
  if (route === "/__e2e/faults" && method === "POST") {
    const parsed = faultSchema.safeParse(await readBody(req));
    if (!parsed.success) return error(res, 400, "VALIDATION_FAILED");
    const list = faults.get(parsed.data.userId) ?? [];
    list.push(parsed.data);
    faults.set(parsed.data.userId, list);
    return send(res, 204);
  }
  if (route === "/__e2e/attempts" && method === "GET") {
    const key = `${url.searchParams.get("userId")}/${url.searchParams.get("exerciseId")}`;
    const recorded = attempts.get(key) ?? { count: 0, keys: [] };
    return send(res, 200, { ...recorded, requests: requests.get(key) ?? 0 });
  }
  if (route === "/__e2e/assist" && method === "POST") {
    const parsed = assistStateSchema.safeParse(await readBody(req));
    if (!parsed.success) return error(res, 400, "VALIDATION_FAILED");
    const { userId, ...change } = parsed.data;
    const state = assistStates.get(userId) ?? freshAssist();
    assistStates.set(userId, { ...state, ...change });
    return send(res, 204);
  }
  if (route === "/__e2e/assist" && method === "GET") {
    const userId = url.searchParams.get("userId") ?? "";
    return send(res, 200, {
      ...logOf(userId),
      state: assistStates.get(userId) ?? null,
    });
  }

  // Identity: who is signed in, for the account menu.
  if (identity && route === "/v1/me" && method === "GET") {
    const user = userFrom(req);
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    const persona = personas[user.persona];
    return send(res, 200, {
      id: user.id,
      email: emailOf(user.persona),
      emailVerified: true,
      displayName: persona.displayName,
      locale: "en",
      status: "active",
      version: 1,
      createdAt: "2026-06-01T10:00:00.000Z",
      roles: persona.roles,
      permissions: [...permissionsOf(persona.roles)].sort(),
    });
  }

  // Identity: the SSO entry id.outegro.dev would show; here it signs in at once.
  if (route === "/authorize" && method === "GET") {
    const q = url.searchParams;
    const persona = cookie(req, "e2e_persona");
    if (
      q.get("client_id") !== CLIENT_ID ||
      q.get("redirect_uri") !== CALLBACK ||
      q.get("code_challenge_method") !== "S256" ||
      !q.get("state") ||
      !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "")
    ) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html");
      return res.end(
        "<!doctype html><title>Invalid</title><h1>This link is not valid</h1>",
      );
    }
    const code = randomBytes(32).toString("base64url");
    codes.set(code, {
      persona: isPersona(persona) ? persona : "reader",
      challenge: q.get("code_challenge") ?? "",
      redirectUri: CALLBACK,
    });
    const target = new URL(CALLBACK);
    target.searchParams.set("code", code);
    target.searchParams.set("state", q.get("state") ?? "");
    res.statusCode = 302;
    res.setHeader("location", target.toString());
    return res.end();
  }

  if (route === "/v1/oauth/token" && method === "POST") {
    const body = (await readBody(req)) as Record<string, string> | undefined;
    const pending = body?.code ? codes.get(body.code) : undefined;
    if (!body || !pending)
      return error(res, 422, "UNPROCESSABLE", { code: ["invalid_grant"] });
    codes.delete(body.code as string);
    const challenge = createHash("sha256")
      .update(body.codeVerifier ?? "")
      .digest("base64url");
    if (
      body.grantType !== "authorization_code" ||
      body.clientId !== CLIENT_ID ||
      body.redirectUri !== pending.redirectUri ||
      challenge !== pending.challenge
    )
      return error(res, 422, "UNPROCESSABLE", { code: ["invalid_grant"] });
    const user: User = { id: randomUUID(), persona: pending.persona };
    users.set(user.id, user);
    return send(res, 200, issueTokens(user.id));
  }

  if (route === "/v1/sessions/refresh" && method === "POST") {
    const body = (await readBody(req)) as { refreshToken?: string } | undefined;
    const sid = body?.refreshToken
      ? refreshTokens.get(body.refreshToken)
      : undefined;
    const session = sid ? sessions.get(sid) : undefined;
    if (!sid || !session || session.revoked || !body?.refreshToken)
      return error(res, 401, "UNAUTHENTICATED");
    refreshTokens.delete(body.refreshToken);
    return send(res, 200, issueTokens(session.userId, sid));
  }

  if (route === "/v1/sessions/logout" && method === "POST") {
    const body = (await readBody(req)) as { refreshToken?: string } | undefined;
    const sid = body?.refreshToken
      ? refreshTokens.get(body.refreshToken)
      : undefined;
    const session = sid ? sessions.get(sid) : undefined;
    if (session) session.revoked = true;
    if (body?.refreshToken) refreshTokens.delete(body.refreshToken);
    return send(res, 204);
  }

  // Payments: the public catalog.
  if (route === "/v1/catalog" && method === "GET")
    return send(res, 200, catalog);

  // edu-backend: the reader API. A browser whose user agent carries
  // FREE_BOOKS (edu-web forwards it) reads every book with the rule "free",
  // as a future free book would be: open to signed-out readers too.
  const user = userFrom(req);
  const free = (req.headers["user-agent"] ?? "").includes(FREE_BOOKS);
  const bookOf = (slug: string | undefined): StoredBook | undefined => {
    const book = books.get(slug ?? "");
    return book && free ? { ...book, rule: { mode: "free" } } : book;
  };
  if (route === "/v1/books" && method === "GET") {
    const list = [...books.keys()]
      .map((slug) => bookOf(slug))
      .filter((book) => visible(book, user));
    return contract(res, libraryResponseSchema, {
      books: list.map((book) => summaryOf(book, user)),
    });
  }

  const bookRoute =
    /^\/v1\/books\/([a-z0-9-]+)(?:\/(chapters\/(\d+)|preface|cards))?$/.exec(
      route,
    );
  if (bookRoute && method === "GET") {
    const book = bookOf(bookRoute[1]);
    if (!visible(book, user)) return error(res, 404, "NOT_FOUND");
    if (!bookRoute[2])
      return contract(res, bookResponseSchema, bookResponse(book, user));
    const doc = book.document;

    if (bookRoute[3] !== undefined) {
      const n = Number(bookRoute[3]);
      const index = doc.chapters.findIndex((chapter) => chapter.n === n);
      const chapter = doc.chapters[index];
      if (!chapter) return error(res, 404, "NOT_FOUND");
      const access = chapterAccess(book, user, n);
      if (access === "sign_in") return error(res, 401, "UNAUTHENTICATED");
      if (access === "locked") return error(res, 403, "FORBIDDEN");
      const prev = doc.chapters[index - 1];
      const next = doc.chapters[index + 1];
      return contract(res, chapterResponseSchema, {
        book: bookRef(book),
        chapter,
        access,
        prev: prev ? { n: prev.n, short: prev.short } : null,
        next: next ? { n: next.n, short: next.short } : null,
        eventLoop:
          doc.eventLoop && uses(chapter.blocks, ["eventLoop"])
            ? doc.eventLoop
            : null,
        sandbox:
          doc.sandbox && uses(chapter.blocks, ["sqlPlay", "sqlTask", "schema"])
            ? doc.sandbox
            : null,
      });
    }

    if (bookRoute[2] === "preface") {
      if (!doc.preface) return error(res, 404, "NOT_FOUND");
      const access = chapterAccess(book, user, 1);
      if (access === "sign_in") return error(res, 401, "UNAUTHENTICATED");
      if (access === "locked") return error(res, 403, "FORBIDDEN");
      return contract(res, prefaceResponseSchema, {
        book: bookRef(book),
        preface: doc.preface,
        sandbox: doc.sandbox ?? null,
      });
    }

    // The deck: cards of the chapters this reader can open.
    if (bookAccess(book, user) === "sign_in")
      return error(res, 401, "UNAUTHENTICATED");
    const open = doc.chapters.filter((chapter) =>
      readable(chapterAccess(book, user, chapter.n)),
    );
    const closed = doc.chapters.filter((chapter) => !open.includes(chapter));
    return contract(res, deckResponseSchema, {
      book: bookRef(book),
      chapters: open.map((chapter) => ({
        n: chapter.n,
        short: chapter.short,
        cards: cardsOf(chapter),
      })),
      lockedCards: closed.reduce(
        (sum, chapter) => sum + cardsOf(chapter).length,
        0,
      ),
    });
  }

  // edu-backend: the reading assistant, refusals in edu-backend's order.
  if (route === "/v1/me/assist" && method === "GET") {
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    const fault = takeFault(user.id, "assistStatus");
    if (fault?.mode === "drop") return drop(res);
    if (fault?.mode === "status")
      return error(res, fault.status ?? 503, "DEPENDENCY_UNAVAILABLE");
    const { enabled, dailyLimit, usedToday } = assistOf(user);
    return contract(res, assistStatusSchema, {
      enabled,
      dailyLimit,
      usedToday,
    });
  }
  const assistRoute =
    /^\/v1\/me\/books\/([a-z0-9-]+)\/assist\/(explain|understanding|sql-hint)$/.exec(
      route,
    );
  if (assistRoute && method === "POST") {
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    const kind = assistRoute[2] as "explain" | "understanding" | "sql-hint";
    const raw = await readBody(req);
    const explain =
      kind === "explain" ? assistExplainSchema.safeParse(raw) : null;
    const retelling =
      kind === "understanding"
        ? assistUnderstandingSchema.safeParse(raw)
        : null;
    const hint =
      kind === "sql-hint" ? assistSqlHintSchema.safeParse(raw) : null;
    const body = explain ?? retelling ?? hint;
    if (!body?.success) return error(res, 400, "VALIDATION_FAILED");
    const book = bookOf(assistRoute[1]);
    if (!visible(book, user)) return error(res, 404, "NOT_FOUND");
    const n = hint?.success
      ? chapterOfId(book, hint.data.exerciseId, "exercise")?.n
      : (explain?.data?.chapter ?? retelling?.data?.chapter);
    const chapter = book.document.chapters.find((item) => item.n === n);
    if (!chapter) return error(res, 404, "NOT_FOUND");
    const access = chapterAccess(book, user, chapter.n);
    if (access === "sign_in")
      return error(res, 401, "UNAUTHENTICATED", { access: [access] });
    if (!readable(access))
      return error(res, 403, "FORBIDDEN", { access: [access] });
    let text: string;
    let cacheKey: string | null = null;
    if (explain?.success) {
      const section = chapter.blocks.find(
        (block) => block.t === "h3" && block.id === explain.data.section,
      );
      if (section?.t !== "h3") return error(res, 404, "NOT_FOUND");
      text = explainAnswer(plain(section.c), explain.data);
      if (explain.data.style && !explain.data.avoid)
        cacheKey = `${user.id}/${book.document.slug}/${chapter.n}/${section.id}/${explain.data.style}`;
    } else if (hint?.success) {
      const found = exerciseOf(book, hint.data.exerciseId);
      if (found?.block.t !== "sqlTask") return error(res, 404, "NOT_FOUND");
      text = sqlHintAnswer(hint.data.problem);
    } else {
      text = understandingAnswer;
    }
    const fault = takeFault(user.id, "assist");
    if (fault?.mode === "drop") return drop(res);
    if (fault?.mode === "status")
      return error(
        res,
        fault.status ?? 503,
        fault.status === 429 ? "RATE_LIMITED" : "DEPENDENCY_UNAVAILABLE",
        fault.reason ? { assist: [fault.reason] } : {},
      );
    const state = assistOf(user);
    if (!state.enabled)
      return error(res, 503, "DEPENDENCY_UNAVAILABLE", {
        assist: ["disabled"],
      });
    logOf(user.id).requests.push({ kind, body: body.data });
    const cached = cacheKey ? assistCache.get(cacheKey) : undefined;
    if (cached !== undefined)
      return streamAnswer(res, user, {
        text: cached,
        cached: true,
        score: null,
        delayMs: 0,
        breakOff: false,
      });
    if (state.usedToday >= state.dailyLimit)
      return error(res, 429, "RATE_LIMITED", { assist: ["daily_limit"] });
    // The shared daily limit of all readers: until tomorrow, not retryable.
    if (state.paused)
      return send(res, 503, {
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          messageKey: "errors.dependencyUnavailable",
          fieldErrors: { assist: ["paused"] },
          requestId: randomUUID(),
          retryable: false,
        },
      });
    return streamAnswer(res, user, {
      text,
      cached: false,
      score: kind === "understanding" ? 8 : null,
      delayMs: fault?.mode === "delay" ? (fault.delayMs ?? 400) : 40,
      breakOff: fault?.mode === "streamError",
      onDone: () => {
        if (cacheKey) assistCache.set(cacheKey, text);
        // Recorded like edu-backend: the best score per chapter.
        if (kind === "understanding") {
          const progress = progressOf(user, book.document.slug);
          const key = String(chapter.n);
          progress.understanding[key] = Math.max(
            progress.understanding[key] ?? 0,
            8,
          );
        }
      },
    });
  }

  const meRoute =
    /^\/v1\/me\/books\/([a-z0-9-]+)\/(progress|exercises|cards)(?:\/([a-z0-9-]+)(\/attempts)?)?$/.exec(
      route,
    );
  if (meRoute) {
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    const book = bookOf(meRoute[1]);
    if (!visible(book, user)) return error(res, 404, "NOT_FOUND");
    const progress = progressOf(user, book.document.slug);
    const [, , kind, id, attemptsPath] = meRoute;

    if (kind === "progress" && !id && method === "GET")
      return contract(res, progressResponseSchema, progress);

    if (kind === "progress" && !id && method === "PATCH") {
      const parsed = positionSchema.safeParse(await readBody(req));
      if (!parsed.success) return error(res, 400, "VALIDATION_FAILED");
      const { lastChapter, explainView } = parsed.data;
      if (lastChapter !== undefined) {
        if (
          !book.document.chapters.some((chapter) => chapter.n === lastChapter)
        )
          return error(res, 422, "UNPROCESSABLE", { lastChapter: ["unknown"] });
        progress.lastChapter = lastChapter;
      }
      if (explainView !== undefined) progress.explainView = explainView;
      return send(res, 200, {
        lastChapter: progress.lastChapter,
        explainView: progress.explainView,
      });
    }

    // Idempotency-Key: a UUID; a retry with it replays the stored outcome.
    const rawKey = req.headers["idempotency-key"];
    if (rawKey !== undefined && !z.uuid().safeParse(rawKey).success)
      return error(res, 400, "VALIDATION_FAILED", {
        "Idempotency-Key": ["a UUID"],
      });
    const key = typeof rawKey === "string" ? rawKey.toLowerCase() : null;
    const keyOf = (scope: string) =>
      key ? `${user.id}/${scope}/${key}` : null;

    if (kind === "exercises" && id && attemptsPath && method === "POST") {
      const counted = `${user.id}/${id}`;
      requests.set(counted, (requests.get(counted) ?? 0) + 1);
      const fault = takeFault(user.id, "attempts");
      if (fault?.mode === "drop") return drop(res);
      if (fault?.mode === "status")
        return error(res, fault.status ?? 500, "INJECTED");
      const found = exerciseOf(book, id);
      if (!found) return error(res, 404, "NOT_FOUND");
      if (!readable(chapterAccess(book, user, found.chapter)))
        return error(res, 403, "FORBIDDEN");
      const parsed = exerciseAttemptSchema.safeParse(await readBody(req));
      if (!parsed.success)
        return error(res, 400, "VALIDATION_FAILED", { attempt: ["invalid"] });
      const body = JSON.stringify(parsed.data);
      const stored = keyOf(`exercise/${id}`);
      const replay = stored ? idempotent.get(stored) : undefined;
      if (replay) {
        if (replay.body !== body)
          return error(res, 409, "IDEMPOTENCY_CONFLICT");
        if (fault?.mode === "delay") await sleep(fault.delayMs ?? 0);
        return contract(res, attemptResultSchema, replay.outcome);
      }
      let correct: boolean;
      try {
        correct = checkAttempt(found.block, parsed.data);
      } catch (failure) {
        if (failure instanceof InvalidAttempt)
          return error(res, 400, "VALIDATION_FAILED", {
            attempt: [failure.reason],
          });
        throw failure;
      }
      const forced = fault?.mode === "verdict" ? fault.verdict : undefined;
      if (forced) correct = forced.correct;
      // Solved stays solved; a first failure is recorded as such.
      if (correct || forced?.solved) progress.exercises[id] = true;
      else if (!(id in progress.exercises)) progress.exercises[id] = false;
      const outcome = { correct, solved: progress.exercises[id] === true };
      const recorded = attempts.get(counted) ?? { count: 0, keys: [] };
      recorded.count += 1;
      if (key) recorded.keys.push(key);
      attempts.set(counted, recorded);
      if (stored) idempotent.set(stored, { body, outcome });
      if (fault?.mode === "dropAfter") return drop(res);
      if (fault?.mode === "delay") await sleep(fault.delayMs ?? 0);
      return contract(res, attemptResultSchema, outcome);
    }

    if (kind === "cards" && id && !attemptsPath && method === "PUT") {
      const fault = takeFault(user.id, "cards");
      if (fault?.mode === "drop") return drop(res);
      if (fault?.mode === "status")
        return error(res, fault.status ?? 500, "INJECTED");
      const chapter = chapterOfId(book, id, "card");
      if (!chapter) return error(res, 404, "NOT_FOUND");
      if (!readable(chapterAccess(book, user, chapter.n)))
        return error(res, 403, "FORBIDDEN");
      const parsed = cardResultSchema.safeParse(await readBody(req));
      if (!parsed.success) return error(res, 400, "VALIDATION_FAILED");
      const body = JSON.stringify(parsed.data);
      const stored = keyOf(`card/${id}`);
      const replay = stored ? idempotent.get(stored) : undefined;
      if (replay) {
        if (replay.body !== body)
          return error(res, 409, "IDEMPOTENCY_CONFLICT");
        return send(res, 200, replay.outcome);
      }
      progress.cards[id] = parsed.data.state;
      const outcome = { state: parsed.data.state };
      if (stored) idempotent.set(stored, { body, outcome });
      if (fault?.mode === "dropAfter") return drop(res);
      if (fault?.mode === "delay") await sleep(fault.delayMs ?? 0);
      return send(res, 200, outcome);
    }
  }

  return error(res, 404, "NOT_FOUND");
}

createServer((req, res) => {
  handle(req, res).catch((failure) => {
    console.error("[fake-platform]", failure);
    if (!res.headersSent) error(res, 500, "INTERNAL");
  });
}).listen(PORT, () => {
  console.log(
    `fake platform on http://localhost:${PORT} with ${books.size} books`,
  );
});
