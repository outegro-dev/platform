import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, readWithTimeout, runMigrations } from "./client.js";
import { startPostgres, type TestPostgres } from "./testing.js";

/** The driver's SQLSTATE of a failed query (Drizzle wraps it). */
const sqlState = (error: unknown) =>
  (
    (error as { cause?: { code?: string } }).cause ??
    (error as { code?: string })
  )?.code;
const failure = (work: Promise<unknown>) =>
  work.then(
    () => null,
    (error: unknown) => error,
  );

let postgres: TestPostgres;

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(() => postgres?.stop());

describe("createDatabase", () => {
  it("survives losing an idle connection and reconnects on the next query", async () => {
    const errors: Error[] = [];
    const database = createDatabase({
      url: postgres.url,
      applicationName: "idle-loss-test",
      onIdleError: (error) => errors.push(error),
    });
    await database.ping();

    // What a PostgreSQL restart or failover does to every open connection.
    const admin = new pg.Client({ connectionString: postgres.url });
    await admin.connect();
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'idle-loss-test'",
    );
    await admin.end();
    await expect.poll(() => errors.length).toBeGreaterThan(0);

    await expect(database.ping()).resolves.toBeUndefined();
    await database.close();
  });
});

describe("readWithTimeout", () => {
  it("has PostgreSQL cancel a read that runs too long; the limit ends with it", async () => {
    // One connection: the next query runs on the one the slow read used.
    const database = createDatabase({ url: postgres.url, max: 1 });
    try {
      const started = Date.now();
      const error = await failure(
        readWithTimeout(database.db, 200, (tx) =>
          tx.execute("select pg_sleep(5)"),
        ),
      );
      expect(sqlState(error)).toBe("57014");
      expect(Date.now() - started).toBeLessThan(3_000);
      const { rows } = await database.db.execute("show statement_timeout");
      expect(rows).toEqual([{ statement_timeout: "0" }]);
    } finally {
      await database.close();
    }
  });

  it("reads only, and returns what the read returns", async () => {
    const database = createDatabase({ url: postgres.url });
    try {
      const error = await failure(
        readWithTimeout(database.db, 1_000, (tx) =>
          tx.execute("create table scrape_write (x int)"),
        ),
      );
      expect(sqlState(error)).toBe("25006");
      expect(
        await readWithTimeout(
          database.db,
          1_000,
          async (tx) => (await tx.execute("select 1 as one")).rows,
        ),
      ).toEqual([{ one: 1 }]);
    } finally {
      await database.close();
    }
  });
});

/**
 * R-04 TC-R-04-02: the migrate Job (Argo CD PreSync) fails on a broken
 * migration. Pending migrations run in one transaction, so the database is
 * left exactly as it was and the new version never starts; the fixed
 * migration applies on the next release.
 */
describe("runMigrations", () => {
  const folder = mkdtempSync(join(tmpdir(), "migrations-"));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const write = (entries: { tag: string; sql: string }[]) => {
    mkdirSync(join(folder, "meta"), { recursive: true });
    for (const entry of entries)
      writeFileSync(join(folder, `${entry.tag}.sql`), entry.sql);
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: entries.map((entry, idx) => ({
          idx,
          version: "7",
          when: 1_790_000_000_000 + idx,
          tag: entry.tag,
          breakpoints: true,
        })),
      }),
    );
  };
  const init = {
    tag: "0000_init",
    sql: [
      `CREATE TABLE "rehearsal" ("id" integer PRIMARY KEY, "name" text NOT NULL);`,
      `INSERT INTO "rehearsal" VALUES (1, 'kept');`,
    ].join("--> statement-breakpoint\n"),
  };

  it("a broken migration changes nothing and fails the release; fixed, it applies", async () => {
    const url = `${postgres.url.replace(/\/[^/]*$/, "")}/postgres`;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query("create database migration_rehearsal");
    const dbUrl = url.replace(/\/postgres$/, "/migration_rehearsal");
    const db = new pg.Client({ connectionString: dbUrl });
    try {
      write([init]);
      await runMigrations(dbUrl, folder);

      // The first statement would work; the second fails (22012).
      write([
        init,
        {
          tag: "0001_broken",
          sql: [
            `ALTER TABLE "rehearsal" ADD COLUMN "added" text;`,
            `UPDATE "rehearsal" SET "name" = 'lost';`,
            "SELECT 1 / 0;",
          ].join("--> statement-breakpoint\n"),
        },
      ]);
      const error = await failure(runMigrations(dbUrl, folder));
      expect(sqlState(error)).toBe("22012");

      await db.connect();
      const columns = await db.query(
        "select column_name from information_schema.columns where table_name = 'rehearsal' order by 1",
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        "id",
        "name",
      ]);
      expect((await db.query('select name from "rehearsal"')).rows).toEqual([
        { name: "kept" },
      ]);
      const applied = await db.query(
        "select count(*)::int as n from drizzle.__drizzle_migrations",
      );
      expect(applied.rows[0].n).toBe(1);

      write([
        init,
        {
          tag: "0001_broken",
          sql: 'ALTER TABLE "rehearsal" ADD COLUMN "added" text;',
        },
      ]);
      await runMigrations(dbUrl, folder);
      const after = await db.query(
        "select column_name from information_schema.columns where table_name = 'rehearsal' order by 1",
      );
      expect(after.rows.map((row) => row.column_name)).toEqual([
        "added",
        "id",
        "name",
      ]);
    } finally {
      await db.end().catch(() => undefined);
      await admin.end();
    }
  });
});
