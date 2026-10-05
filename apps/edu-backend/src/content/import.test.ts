import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type Block,
  type BookDocument,
  bookDocumentSchema,
} from "@outegro/contracts/edu";
import { createDatabase, runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import { isSafeSvg, walkBlocks } from "@outegro/edu-engine";
import { ManualClock } from "@outegro/nest-common";
import { asc, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { adminAudit, books, chapters } from "../db/schema.js";
import { contentDir, migrationsFolder } from "../test/harness.js";
import { ContentError, type ImportLog, importBundledBooks } from "./import.js";
import { contentProblems } from "./limits.js";

const SLUGS = ["nodejs-internals", "sql-internals"];

let postgres: TestPostgres;
let database: ReturnType<typeof createDatabase<typeof schema>>;
const clock = new ManualClock(new Date("2026-09-29T10:00:00.000Z"));
const temporary: string[] = [];
const logged: { level: string; message: string; data: object }[] = [];
const log: ImportLog = (level, message, data) =>
  logged.push({ level, message, data });

const run = (dir: string | URL = contentDir, url = postgres.url) =>
  importBundledBooks(url, dir, log, { clock });

async function realBook(slug: string): Promise<BookDocument> {
  const file = new URL(`books/${slug}.json`, `${contentDir.href}/`);
  return bookDocumentSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

/** A content folder with these documents (written as given) and a manifest. */
async function contentWith(
  entries: { slug: string; document: unknown; manifest?: object }[],
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "edu-content-"));
  temporary.push(dir);
  await mkdir(path.join(dir, "books"));
  for (const entry of entries)
    await writeFile(
      path.join(dir, "books", `${entry.slug}.json`),
      JSON.stringify(entry.document),
    );
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      books: entries.map((entry) => ({
        file: `books/${entry.slug}.json`,
        initialStatus: "published",
        initialRule: {
          mode: "grant",
          features: ["library", `book.${entry.slug}`],
          previewChapters: 1,
        },
        ...entry.manifest,
      })),
    }),
  );
  return dir;
}

/** A copy of the book with the first block of kind `t` changed by `change`. */
function withFirst<T extends Block["t"]>(
  book: BookDocument,
  t: T,
  change: (block: Extract<Block, { t: T }>) => void,
): BookDocument {
  const copy = structuredClone(book);
  let found = false;
  for (const chapter of copy.chapters)
    walkBlocks(chapter.blocks, (block) => {
      if (found || block.t !== t) return;
      change(block as Extract<Block, { t: T }>);
      found = true;
    });
  if (!found) throw new Error(`no ${t} block in ${book.slug}`);
  return copy;
}

/** Everything an import may write, to compare before and after. */
async function snapshot() {
  const db = database.db;
  return {
    books: await db.select().from(books).orderBy(asc(books.slug)),
    chapters: await db
      .select({
        bookId: chapters.bookId,
        n: chapters.n,
        short: chapters.short,
      })
      .from(chapters)
      .orderBy(asc(chapters.bookId), asc(chapters.n)),
    audit: await db.select().from(adminAudit).orderBy(asc(adminAudit.id)),
  };
}

beforeAll(async () => {
  postgres = await startPostgres();
  await runMigrations(postgres.url, migrationsFolder);
  database = createDatabase({ url: postgres.url, schema });
});
afterAll(async () => {
  await database?.close();
  await postgres?.stop();
  await Promise.all(
    temporary.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("content import (TC-EDU-04)", () => {
  it("imports both books of the manifest with their status, rule and 13 chapters", async () => {
    expect(await run()).toEqual([
      { slug: "nodejs-internals", outcome: "inserted", contentVersion: 1 },
      { slug: "sql-internals", outcome: "inserted", contentVersion: 1 },
    ]);
    const rows = await database.db
      .select()
      .from(books)
      .orderBy(asc(books.slug));
    expect(rows.map((row) => row.slug)).toEqual(SLUGS);
    for (const row of rows) {
      const document = await realBook(row.slug);
      expect(row).toMatchObject({
        title: document.title,
        locale: "ru",
        status: "published",
        rule: {
          mode: "grant",
          features: ["library", `book.${row.slug}`],
          previewChapters: 1,
        },
        contentVersion: 1,
        version: 0,
        contentHash: createHash("sha256")
          .update(JSON.stringify(document))
          .digest("hex"),
        importedAt: clock.now(),
        publishedAt: clock.now(),
      });
      expect(row.meta.stats).toEqual(document.stats);
      expect(row.meta).not.toHaveProperty("chapters");
      const stored = await database.db
        .select()
        .from(chapters)
        .where(eq(chapters.bookId, row.id))
        .orderBy(asc(chapters.n));
      expect(stored.map((chapter) => chapter.n)).toEqual(
        Array.from({ length: 13 }, (_, i) => i + 1),
      );
      expect(stored.reduce((sum, c) => sum + c.exerciseIds.length, 0)).toBe(
        document.stats.exercises,
      );
      expect(stored.reduce((sum, c) => sum + c.cardIds.length, 0)).toBe(
        document.stats.cards,
      );
      expect(stored[0]?.document).toEqual(document.chapters[0]);
      expect(stored[0]?.sections.length).toBe(
        document.chapters[0]?.blocks.filter((b) => b.t === "h3").length,
      );
    }
    const [node, sql] = rows;
    const flags = async (bookId: string) =>
      (
        await database.db
          .select({
            n: chapters.n,
            loop: chapters.usesEventLoop,
            sandbox: chapters.usesSandbox,
          })
          .from(chapters)
          .where(eq(chapters.bookId, bookId))
          .orderBy(asc(chapters.n))
      ).map((c) => `${c.n}:${c.loop ? "L" : ""}${c.sandbox ? "S" : ""}`);
    // The simulator is in chapter 4 of the Node book; every SQL chapter runs queries.
    expect(await flags(node?.id ?? "")).toEqual(
      Array.from({ length: 13 }, (_, i) => `${i + 1}:${i === 3 ? "L" : ""}`),
    );
    expect(await flags(sql?.id ?? "")).toEqual(
      Array.from({ length: 13 }, (_, i) => `${i + 1}:S`),
    );
    const audit = await database.db.select().from(adminAudit);
    expect(audit).toHaveLength(2);
    for (const entry of audit)
      expect(entry).toMatchObject({
        actorId: null,
        action: "book.imported",
        targetType: "book",
        reason: null,
        data: {
          contentVersion: 1,
          contentHash: rows.find((row) => row.slug === entry.targetId)
            ?.contentHash,
        },
      });
  });

  it("changes nothing when run again", async () => {
    const before = await snapshot();
    clock.advance(60_000);
    expect(await run()).toEqual([
      { slug: "nodejs-internals", outcome: "unchanged", contentVersion: 1 },
      { slug: "sql-internals", outcome: "unchanged", contentVersion: 1 },
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it("a changed document gets new content and contentVersion, never a new status, rule or version", async () => {
    // The admin console archived the Node book and opened it to everyone.
    await database.db
      .update(books)
      .set({ status: "archived", rule: { mode: "free" }, version: 2 })
      .where(eq(books.slug, "nodejs-internals"));
    const changed = await realBook("nodejs-internals");
    changed.title = "Node.js изнутри, второе издание";
    if (changed.chapters[0]) changed.chapters[0].short = "Новое устройство";
    changed.chapters.pop();
    const dir = await contentWith([
      { slug: "nodejs-internals", document: changed },
      { slug: "sql-internals", document: await realBook("sql-internals") },
    ]);
    clock.advance(60_000);
    expect(await run(dir)).toEqual([
      { slug: "nodejs-internals", outcome: "updated", contentVersion: 2 },
      { slug: "sql-internals", outcome: "unchanged", contentVersion: 1 },
    ]);
    const [node] = await database.db
      .select()
      .from(books)
      .where(eq(books.slug, "nodejs-internals"));
    expect(node).toMatchObject({
      title: "Node.js изнутри, второе издание",
      status: "archived",
      rule: { mode: "free" },
      version: 2,
      contentVersion: 2,
      importedAt: clock.now(),
      updatedAt: clock.now(),
      contentHash: createHash("sha256")
        .update(JSON.stringify(changed))
        .digest("hex"),
    });
    const stored = await database.db
      .select({ n: chapters.n, short: chapters.short })
      .from(chapters)
      .where(eq(chapters.bookId, node?.id ?? ""))
      .orderBy(asc(chapters.n));
    expect(stored).toHaveLength(12);
    expect(stored[0]?.short).toBe("Новое устройство");
    const [entry] = await database.db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.targetId, "nodejs-internals"))
      .orderBy(asc(adminAudit.at))
      .offset(1);
    expect(entry).toMatchObject({
      action: "book.imported",
      actorId: null,
      reason: null,
      data: { contentVersion: 2, contentHash: node?.contentHash },
    });
  });

  it("an invalid book stops the import before anything is written", async () => {
    const before = await snapshot();
    const valid = await realBook("nodejs-internals");
    valid.title = "Would be the third edition";
    const sql = await realBook("sql-internals");
    const cases: [string, Parameters<typeof contentWith>[0]][] = [
      [
        "invalid document",
        [
          { slug: "nodejs-internals", document: valid },
          { slug: "sql-internals", document: { ...sql, chapters: [] } },
        ],
      ],
      [
        "slug differs from the file name",
        [
          { slug: "nodejs-internals", document: valid },
          { slug: "sql-internals", document: { ...sql, slug: "sql-outside" } },
        ],
      ],
      [
        "invalid initial status",
        [
          { slug: "nodejs-internals", document: valid },
          {
            slug: "sql-internals",
            document: sql,
            manifest: { initialStatus: "hidden" },
          },
        ],
      ],
      [
        "invalid initial rule",
        [
          { slug: "nodejs-internals", document: valid },
          {
            slug: "sql-internals",
            document: sql,
            manifest: { initialRule: { mode: "public" } },
          },
        ],
      ],
      [
        "more preview chapters than chapters",
        [
          { slug: "nodejs-internals", document: valid },
          {
            slug: "sql-internals",
            document: sql,
            manifest: {
              initialRule: {
                mode: "grant",
                features: ["library"],
                previewChapters: 14,
              },
            },
          },
        ],
      ],
      [
        "repeated exercise id",
        [
          { slug: "nodejs-internals", document: valid },
          {
            slug: "sql-internals",
            document: {
              ...sql,
              chapters: [
                ...sql.chapters,
                { ...sql.chapters[0], n: 14, id: "s14" },
              ],
            },
          },
        ],
      ],
    ];
    for (const [name, entries] of cases) {
      const dir = await contentWith(entries);
      await expect(run(dir), name).rejects.toBeInstanceOf(ContentError);
    }
    // Valid by the schema, yet not servable as it is: markup edu-web would
    // drop, or an SQL task no attempt could ever solve.
    const servable: [string, BookDocument, RegExp][] = [
      [
        "a figure with a script",
        withFirst(sql, "figure", (figure) => {
          figure.svg =
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
        }),
        /sql-internals\.json: chapter \d+: figure 1 is not book SVG/,
      ],
      [
        "a figure with a raw > in an attribute",
        withFirst(sql, "figure", (figure) => {
          figure.svg =
            '<svg xmlns="http://www.w3.org/2000/svg" aria-label="a > b"></svg>';
        }),
        /figure 1 is not book SVG/,
      ],
      [
        "a cover with a handler",
        { ...sql, cover: '<svg onload="alert(1)"></svg>' },
        /the cover is not book SVG/,
      ],
      [
        "an SQL task over the rows an attempt reports",
        withFirst(sql, "sqlTask", (task) => {
          task.expected = { ...task.expected, rows: 201 };
        }),
        /s\d+-t-[0-9a-f]{8}(-\d+)?: the solution returns 201 rows; an attempt reports at most 200/,
      ],
      [
        "an SQL task over the columns an attempt reports",
        withFirst(sql, "sqlTask", (task) => {
          task.expected = { ...task.expected, columns: 101 };
        }),
        /: the solution returns 101 columns, more than an attempt reports/,
      ],
    ];
    for (const [name, document, message] of servable) {
      const dir = await contentWith([
        { slug: "nodejs-internals", document: valid },
        { slug: "sql-internals", document },
      ]);
      await expect(run(dir), name).rejects.toThrow(message);
    }
    const listedTwice = await contentWith([
      { slug: "nodejs-internals", document: valid },
    ]);
    const manifest = JSON.parse(
      await readFile(path.join(listedTwice, "manifest.json"), "utf8"),
    );
    manifest.books.push(manifest.books[0]);
    await writeFile(
      path.join(listedTwice, "manifest.json"),
      JSON.stringify(manifest),
    );
    await expect(run(listedTwice)).rejects.toThrow(/listed twice/);
    const broken = await contentWith([
      { slug: "nodejs-internals", document: valid },
    ]);
    await writeFile(path.join(broken, "books", "nodejs-internals.json"), "{");
    await expect(run(broken)).rejects.toBeInstanceOf(ContentError);
    expect(await snapshot()).toEqual(before);
  });

  it("leaves a book the manifest no longer lists alone, with a warning", async () => {
    const dir = await contentWith([
      { slug: "sql-internals", document: await realBook("sql-internals") },
    ]);
    logged.length = 0;
    expect(await run(dir)).toEqual([
      { slug: "sql-internals", outcome: "unchanged", contentVersion: 1 },
    ]);
    expect(logged).toContainEqual({
      level: "warn",
      message: "book not in the manifest left as it is",
      data: { slug: "nodejs-internals" },
    });
    const [left] = await database.db
      .select({ value: count() })
      .from(chapters)
      .innerJoin(books, eq(books.id, chapters.bookId))
      .where(eq(books.slug, "nodejs-internals"));
    expect(left?.value).toBe(12);
  });

  it("finds nothing to refuse in the books of the repository", async () => {
    for (const slug of SLUGS)
      expect([slug, contentProblems(await realBook(slug))]).toEqual([slug, []]);
  });

  it("two imports at once (two PreSync runs) import each book once", async () => {
    await database.pool.query("create database edu_race");
    const url = new URL(postgres.url);
    url.pathname = "/edu_race";
    await runMigrations(url.href, migrationsFolder);
    const outcomes = await Promise.all([
      run(contentDir, url.href),
      run(contentDir, url.href),
    ]);
    expect(
      outcomes
        .flat()
        .map((o) => o.outcome)
        .sort(),
    ).toEqual(["inserted", "inserted", "unchanged", "unchanged"]);
    const race = createDatabase({ url: url.href, schema });
    try {
      expect(
        (await race.db.select({ slug: books.slug }).from(books)).length,
      ).toBe(2);
      expect((await race.db.select().from(adminAudit)).length).toBe(2);
      expect(
        (await race.db.select({ value: count() }).from(chapters))[0]?.value,
      ).toBe(26);
    } finally {
      await race.close();
    }
  });
});

describe("the converter (tools/)", () => {
  const tools = fileURLToPath(new URL("../../tools/", import.meta.url));
  type SqlTaskDraft = {
    t: "sqlTask";
    id: string;
    solution: string;
    ordered: boolean;
    expected?: { columns: number; rows: number };
  };
  /** Just what addExpectations reads: a seed and one SQL task. */
  const bookWith = (solution: string) => ({
    slug: "limits",
    sandbox: { engine: "sqlite", seed: "create table t (x int);" },
    chapters: [
      {
        blocks: [
          {
            t: "sqlTask",
            id: "t01-t-0000000a",
            q: [],
            hint: null,
            solution,
            ordered: false,
          } as SqlTaskDraft,
        ],
      },
    ],
  });
  const numbers = (n: number) =>
    `with recursive c(i) as (select 1 union all select i + 1 from c where i < ${n}) select i from c`;
  const columns = (n: number) =>
    `select ${Array.from({ length: n }, (_, i) => i).join(", ")}`;

  it("refuses, naming the task, a solution whose result an attempt cannot report", async () => {
    const { addExpectations } = (await import(
      new URL("../../tools/sql-expectations.mjs", import.meta.url).href
    )) as { addExpectations: (book: unknown) => Promise<unknown> };
    // The most an attempt carries: 200 rows, 100 columns, cells of 500 characters.
    for (const [solution, expected] of [
      [numbers(200), { columns: 1, rows: 200 }],
      [columns(100), { columns: 100, rows: 1 }],
      ["select hex(zeroblob(250))", { columns: 1, rows: 1 }],
    ] as const) {
      const book = bookWith(solution);
      await addExpectations(book);
      expect([solution, book.chapters[0]?.blocks[0]?.expected]).toEqual([
        solution,
        expect.objectContaining(expected),
      ]);
    }
    const refused: [string, RegExp][] = [
      [
        numbers(201),
        /^t01-t-0000000a: the solution returns 201 rows; an attempt reports at most 200$/,
      ],
      [
        columns(101),
        /^t01-t-0000000a: the solution's result does not fit an attempt \(columns: /,
      ],
      [
        "select hex(zeroblob(251))",
        /^t01-t-0000000a: the solution's result does not fit an attempt \(rows\.0\.0: /,
      ],
    ];
    for (const [solution, message] of refused)
      await expect(
        addExpectations(bookWith(solution)),
        solution,
      ).rejects.toThrow(message);
  });

  it("escapes > in an SVG attribute, so the reader shows the figure", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "edu-convert-"));
    temporary.push(dir);
    await mkdir(path.join(dir, "content", "books"), { recursive: true });
    const page = path.join(dir, "probe.html");
    await writeFile(
      page,
      `<!doctype html>
<html lang="ru"><head><style>
:root { --accent:#0E7490; }
@media (prefers-color-scheme: dark) { :root { --accent:#4FC0D8; } }
</style></head><body>
<header class="hero">
<p class="hero-kicker">Проба</p>
<h1>Пробная книга</h1>
<p class="hero-lead">Одна глава, один рисунок.</p>
<svg viewBox="0 0 10 10" role="img" aria-label="Обложка"><rect x="1" y="1" width="8" height="8"></rect></svg>
</header>
<section id="p01" class="chapter" data-short="Стрелки">
<div class="ch-head"><p class="ch-kicker">Глава 1</p><h2>Стрелки</h2><p class="ch-lead">Что куда идёт.</p></div>
<h3 id="p01-arrows">Стрелка</h3>
<figure><svg viewBox="0 0 10 10" role="img" aria-label="a -> b"><text x="1" y="5">a &gt; b</text></svg><figcaption>Из a в b.</figcaption></figure>
</section>
<section id="deck" class="deck-sec"><p class="ch-kicker">Повторение</p><h2>Карточки</h2><p>Карточек пока нет.</p></section>
</body></html>
`,
    );
    await promisify(execFile)(
      process.execPath,
      [path.join(tools, "import-artifact.mjs"), page, "probe"],
      { cwd: dir },
    );
    const book = bookDocumentSchema.parse(
      JSON.parse(
        await readFile(
          path.join(dir, "content", "books", "probe.json"),
          "utf8",
        ),
      ),
    );
    const figures: string[] = [];
    for (const chapter of book.chapters)
      walkBlocks(chapter.blocks, (block) => {
        if (block.t === "figure") figures.push(block.svg);
      });
    expect(figures).toEqual([
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-label="a -&gt; b"><text x="1" y="5">a &gt; b</text></svg>',
    ]);
    expect(figures.every(isSafeSvg)).toBe(true);
    expect(isSafeSvg(book.cover)).toBe(true);
    expect(contentProblems(book)).toEqual([]);
  });
});
