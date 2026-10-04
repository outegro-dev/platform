import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AccessRule,
  accessRuleSchema,
  type BookDocument,
  type BookStatus,
  bookDocumentSchema,
  bookStatusSchema,
} from "@outegro/contracts/edu";
import { createDatabase } from "@outegro/db";
import { type Clock, systemClock } from "@outegro/nest-common";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { EduDb } from "../common/database.js";
import * as schema from "../db/schema.js";
import { adminAudit, books, chapters } from "../db/schema.js";
import { contentProblems } from "./limits.js";
import { chapterRow, metaOf } from "./outline.js";

/** content/manifest.json: the books to import and how a first import sets them up. */
const manifestSchema = z.object({
  books: z.array(
    z.object({
      file: z.string().regex(/^books\/[a-z0-9]+(-[a-z0-9]+)*\.json$/),
      initialStatus: bookStatusSchema,
      initialRule: accessRuleSchema,
    }),
  ),
});

export type ImportLog = (
  level: "info" | "warn",
  message: string,
  data: Record<string, unknown>,
) => void;

export type ImportOutcome = {
  slug: string;
  outcome: "inserted" | "updated" | "unchanged";
  contentVersion: number;
};

/** A manifest entry whose document passed every check, ready to write. */
type PreparedBook = {
  slug: string;
  document: BookDocument;
  chapters: ReturnType<typeof chapterRow>[];
  hash: string;
  status: BookStatus;
  rule: AccessRule;
};

/** The manifest or a book cannot be imported; nothing has been written. */
export class ContentError extends Error {}

function issuesOf(error: z.ZodError): string {
  const shown = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  const more = error.issues.length - shown.length;
  return [...shown, ...(more > 0 ? [`and ${more} more`] : [])].join("; ");
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new ContentError(`${file}: ${(error as Error).message}`);
  }
}

/** Duplicates of `values`, each once. */
function duplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const repeated = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/**
 * Reads and checks the manifest and every book before anything is written:
 * an invalid entry stops the whole import, so no book is half imported.
 * Progress is keyed by exercise and card id per book, so those must be unique
 * in a book, like chapter numbers and anchors; figures must be book SVG and
 * SQL tasks answerable by an attempt (contentProblems).
 */
async function prepare(contentDir: string): Promise<PreparedBook[]> {
  const manifestFile = path.join(contentDir, "manifest.json");
  const manifest = manifestSchema.safeParse(await readJson(manifestFile));
  if (!manifest.success)
    throw new ContentError(`${manifestFile}: ${issuesOf(manifest.error)}`);
  const prepared: PreparedBook[] = [];
  for (const entry of manifest.data.books) {
    const file = path.join(contentDir, entry.file);
    const parsed = bookDocumentSchema.safeParse(await readJson(file));
    if (!parsed.success)
      throw new ContentError(`${entry.file}: ${issuesOf(parsed.error)}`);
    const document = parsed.data;
    const slug = path.posix.basename(entry.file, ".json");
    const fail = (message: string): never => {
      throw new ContentError(`${entry.file}: ${message}`);
    };
    if (document.slug !== slug)
      fail(`slug "${document.slug}" differs from the file name`);
    if (prepared.some((book) => book.slug === slug))
      fail("listed twice in the manifest");
    const rows = document.chapters.map(chapterRow);
    const repeated = {
      "chapter numbers": duplicates(rows.map((row) => row.n)),
      "chapter ids": duplicates(rows.map((row) => row.key)),
      "exercise ids": duplicates(rows.flatMap((row) => row.exerciseIds)),
      "card ids": duplicates(rows.flatMap((row) => row.cardIds)),
    };
    for (const [what, values] of Object.entries(repeated))
      if (values.length > 0) fail(`repeated ${what}: ${values.join(", ")}`);
    const problems = contentProblems(document);
    if (problems.length > 0)
      fail(
        [
          ...problems.slice(0, 5),
          ...(problems.length > 5 ? [`and ${problems.length - 5} more`] : []),
        ].join("; "),
      );
    const rule = entry.initialRule;
    if (rule.mode === "grant" && rule.previewChapters > rows.length)
      fail(
        `initialRule previews ${rule.previewChapters} of ${rows.length} chapters`,
      );
    prepared.push({
      slug,
      document,
      chapters: rows,
      hash: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
      status: entry.initialStatus,
      rule,
    });
  }
  return prepared;
}

/**
 * One book in one transaction, serialized per slug by an advisory lock so
 * that two imports never race. A new book takes status and rule from the
 * manifest; a changed one gets its content replaced and content_version
 * bumped, while status, rule and version stay with the admin console.
 */
async function importBook(
  db: EduDb,
  book: PreparedBook,
  now: Date,
): Promise<ImportOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('edu.import.' || ${book.slug}::text))`,
    );
    const [current] = await tx
      .select({
        id: books.id,
        contentHash: books.contentHash,
        contentVersion: books.contentVersion,
      })
      .from(books)
      .where(eq(books.slug, book.slug));
    if (current?.contentHash === book.hash)
      return {
        slug: book.slug,
        outcome: "unchanged",
        contentVersion: current.contentVersion,
      };
    const content = {
      title: book.document.title,
      locale: book.document.locale,
      meta: metaOf(book.document),
      contentHash: book.hash,
      importedAt: now,
      updatedAt: now,
    };
    let bookId: string;
    let contentVersion: number;
    if (current) {
      bookId = current.id;
      contentVersion = current.contentVersion + 1;
      await tx
        .update(books)
        .set({ ...content, contentVersion })
        .where(eq(books.id, bookId));
      await tx.delete(chapters).where(eq(chapters.bookId, bookId));
    } else {
      contentVersion = 1;
      const [created] = await tx
        .insert(books)
        .values({
          ...content,
          slug: book.slug,
          status: book.status,
          rule: book.rule,
          contentVersion,
          version: 0,
          publishedAt: book.status === "published" ? now : null,
          createdAt: now,
        })
        .returning({ id: books.id });
      if (!created) throw new Error(`could not insert ${book.slug}`);
      bookId = created.id;
    }
    await tx
      .insert(chapters)
      .values(book.chapters.map((row) => ({ ...row, bookId })));
    await tx.insert(adminAudit).values({
      actorId: null,
      action: "book.imported",
      targetType: "book",
      targetId: book.slug,
      reason: null,
      data: { contentVersion, contentHash: book.hash },
      at: now,
    });
    return {
      slug: book.slug,
      outcome: current ? "updated" : "inserted",
      contentVersion,
    };
  });
}

/**
 * Imports the books of content/manifest.json; runs with the migrations
 * (Argo CD PreSync), so it is idempotent: an unchanged book is not written.
 * A book in the database that the manifest no longer lists is left alone,
 * readers' progress included.
 */
export async function importBundledBooks(
  databaseUrl: string,
  contentDir: string | URL,
  log: ImportLog,
  options: { clock?: Clock } = {},
): Promise<ImportOutcome[]> {
  const clock = options.clock ?? systemClock;
  const dir =
    contentDir instanceof URL ? fileURLToPath(contentDir) : contentDir;
  const prepared = await prepare(dir);
  const database = createDatabase({
    url: databaseUrl,
    schema,
    max: 1,
    applicationName: "edu-backend-import",
  });
  try {
    const outcomes: ImportOutcome[] = [];
    for (const book of prepared) {
      const outcome = await importBook(database.db, book, clock.now());
      outcomes.push(outcome);
      log(
        "info",
        outcome.outcome === "unchanged" ? "book unchanged" : "book imported",
        { ...outcome },
      );
    }
    const listed = new Set(prepared.map((book) => book.slug));
    const stored = await database.db
      .select({ slug: books.slug })
      .from(books)
      .orderBy(asc(books.slug));
    for (const { slug } of stored)
      if (!listed.has(slug))
        log("warn", "book not in the manifest left as it is", { slug });
    return outcomes;
  } finally {
    await database.close();
  }
}
