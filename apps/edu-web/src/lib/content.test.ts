import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BookDocument } from "@outegro/contracts/edu";
import {
  isSafeSvg,
  type SchemaTable,
  schemaFromSeed,
  walkBlocks,
} from "@outegro/edu-engine";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { describe, expect, it } from "vitest";

/*
 * The real books against the engine's rules this app renders them with:
 * every figure and cover passes the SVG whitelist (otherwise the page
 * would show nothing in its place), and the training database reference
 * reads the seed exactly as SQLite does.
 */

function book(slug: string): BookDocument {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../edu-backend/content/books/${slug}.json`,
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as BookDocument;
}

function svgsOf(document: BookDocument): string[] {
  const found = [document.cover];
  const blocks = [
    ...document.chapters.flatMap((chapter) => chapter.blocks),
    ...(document.preface?.blocks ?? []),
  ];
  walkBlocks(blocks, (block) => {
    if (block.t === "figure") found.push(block.svg);
  });
  return found;
}

/** What SQLite itself says about a seed: the reference for the reader. */
async function sqliteSchema(seed: string): Promise<SchemaTable[]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.exec(seed);
    const names = (
      db.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid",
      )[0]?.values ?? []
    ).map((row) => String(row[0]));
    return names.map((name) => ({
      name,
      columns: (db.exec(`PRAGMA table_info("${name}")`)[0]?.values ?? []).map(
        (row) => ({
          name: String(row[1]),
          type: String(row[2]),
          pk: Number(row[5]) > 0,
        }),
      ),
      rows: Number(
        db.exec(`SELECT COUNT(*) FROM "${name}"`)[0]?.values[0]?.[0],
      ),
    }));
  } finally {
    db.close();
  }
}

describe("the books' SVG", () => {
  it("passes the whitelist: every figure and cover is shown", () => {
    for (const slug of ["nodejs-internals", "sql-internals"]) {
      const svgs = svgsOf(book(slug));
      expect(svgs.length).toBeGreaterThan(50);
      const refused = svgs.filter((svg) => !isSafeSvg(svg));
      expect(
        refused.map((svg) => svg.slice(0, 120)),
        slug,
      ).toEqual([]);
    }
  });
});

describe("training database reference", () => {
  it("reads the SQL book's seed exactly as SQLite does", async () => {
    const seed = book("sql-internals").sandbox?.seed ?? "";
    expect(seed).not.toBe("");
    expect(schemaFromSeed(seed)).toEqual(await sqliteSchema(seed));
  });

  it("reads multi-row inserts, composite keys and quoted names as SQLite does", async () => {
    const seed = `
      CREATE TABLE "order lines" (
        order_id INTEGER NOT NULL, -- a comment; with a semicolon
        product_id INTEGER NOT NULL,
        note VARCHAR(20) DEFAULT 'a;b',
        PRIMARY KEY (order_id, product_id)
      );
      CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, label TEXT UNIQUE);
      CREATE INDEX tags_label ON tags (label);
      INSERT INTO "order lines" VALUES (1, 1, 'x'), (1, 2, '(y)'), (2, 1, NULL);
      INSERT INTO tags (id, label) VALUES (1, 'it''s');
    `;
    expect(schemaFromSeed(seed)).toEqual(await sqliteSchema(seed));
  });
});
