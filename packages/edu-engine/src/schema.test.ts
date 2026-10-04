import { describe, expect, it } from "vitest";
import { schemaFromSeed } from "./schema.js";

/*
 * The same seeds are checked against SQLite itself in edu-web
 * (src/lib/content.test.ts), where sql.js is at hand.
 */

describe("training database reference", () => {
  it("counts multi-row inserts, composite keys and quoted names", () => {
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
    expect(schemaFromSeed(seed)).toEqual([
      {
        name: "order lines",
        columns: [
          { name: "order_id", type: "INTEGER", pk: true },
          { name: "product_id", type: "INTEGER", pk: true },
          { name: "note", type: "VARCHAR(20)", pk: false },
        ],
        rows: 3,
      },
      {
        name: "tags",
        columns: [
          { name: "id", type: "INTEGER", pk: true },
          { name: "label", type: "TEXT", pk: false },
        ],
        rows: 1,
      },
    ]);
  });

  it("reads bracketed and backticked names and block comments", () => {
    const seed = `
      /* the shop; two tables */
      CREATE TABLE [customers] (id INTEGER PRIMARY KEY, \`full name\` TEXT NOT NULL);
      CREATE TABLE notes (body TEXT) STRICT;
      INSERT INTO [customers] VALUES (1, 'Анна'), (2, 'Борис');
    `;
    expect(schemaFromSeed(seed)).toEqual([
      {
        name: "customers",
        columns: [
          { name: "id", type: "INTEGER", pk: true },
          { name: "full name", type: "TEXT", pk: false },
        ],
        rows: 2,
      },
      {
        name: "notes",
        columns: [{ name: "body", type: "TEXT", pk: false }],
        rows: 0,
      },
    ]);
  });

  it("says it does not know the counts rather than guessing", () => {
    const tables = schemaFromSeed(`
      CREATE TABLE t (id INTEGER PRIMARY KEY);
      INSERT INTO t VALUES (1), (2);
      DELETE FROM t WHERE id = 1;
    `);
    expect(tables?.[0]?.rows).toBeNull();
    expect(tables?.[0]?.columns).toEqual([
      { name: "id", type: "INTEGER", pk: true },
    ]);
    expect(
      schemaFromSeed(`
        CREATE TABLE a (x INT);
        INSERT INTO a SELECT 1;
      `)?.[0]?.rows,
    ).toBeNull();
  });

  it("has nothing to show without tables", () => {
    expect(schemaFromSeed("SELECT 1;")).toBeNull();
    expect(schemaFromSeed("")).toBeNull();
  });
});
