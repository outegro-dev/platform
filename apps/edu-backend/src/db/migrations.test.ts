import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase, runMigrations } from "@outegro/db";
import { startPostgres, type TestPostgres } from "@outegro/db/testing";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sampleBook, seedBook } from "../test/fixtures.js";
import { migrationsFolder } from "../test/harness.js";
import * as schema from "./schema.js";
import { assistCache, assistDays, assistUsage } from "./schema.js";

/**
 * Migrations that change rows already stored, applied as the Job of a
 * deploy applies them: over a database the previous migrations made and
 * the previous version wrote to (real PostgreSQL).
 */

type Journal = { entries: { tag: string }[] };

let postgres: TestPostgres;
let database: ReturnType<typeof createDatabase<typeof schema>>;
const temporary: string[] = [];

/** The migrations up to `tag`, as the previous deploy had them. */
async function migrationsUpTo(tag: string): Promise<string> {
  const journal: Journal = JSON.parse(
    await readFile(
      path.join(migrationsFolder, "meta", "_journal.json"),
      "utf8",
    ),
  );
  const entries = journal.entries.slice(
    0,
    journal.entries.findIndex((entry) => entry.tag === tag) + 1,
  );
  if (entries.length === 0) throw new Error(`no migration ${tag}`);
  const dir = await mkdtemp(path.join(tmpdir(), "edu-migrations-"));
  temporary.push(dir);
  await mkdir(path.join(dir, "meta"));
  await writeFile(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const { tag: name } of entries)
    await copyFile(
      path.join(migrationsFolder, `${name}.sql`),
      path.join(dir, `${name}.sql`),
    );
  return dir;
}

beforeAll(async () => {
  postgres = await startPostgres();
  database = createDatabase({ url: postgres.url, schema });
});
afterAll(async () => {
  await database?.close();
  await postgres?.stop();
  await Promise.all(
    temporary.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("0002_assist_days_and_cache", () => {
  it("counts the UTC days of the cap of all readers from the usage rows, and drops answers cached without a version or model", async () => {
    const db = database.db;
    await runMigrations(
      postgres.url,
      await migrationsUpTo("0001_assist_attempts"),
    );
    // Days are UTC whatever the session's time zone (Moscow would move the
    // evening of the 10th to the 11th).
    const { rows } = await db.execute<{ name: string }>(
      sql`select current_database() as name`,
    );
    await db.execute(
      sql`alter database ${sql.identifier(rows[0]?.name ?? "")} set timezone to 'Europe/Moscow'`,
    );
    const bookId = await seedBook(db, {
      document: sampleBook("sample-draft"),
      status: "draft",
      rule: { mode: "free" },
      now: new Date("2026-10-01T00:00:00.000Z"),
    });
    const row = {
      userId: randomUUID(),
      kind: "explain" as const,
      bookId,
      chapter: 1,
      cached: false,
    };
    const at = (iso: string) => new Date(iso);
    await db.insert(assistUsage).values([
      // 10 October: an answer, and one that broke off late in the evening.
      { ...row, outcome: "ok", at: at("2026-10-10T09:00:00.000Z") },
      { ...row, outcome: "failed", at: at("2026-10-10T23:59:59.000Z") },
      // 11 October: an answer, one still streaming (failed until settled)
      // and a refusal the provider billed; not a refusal that cost nothing
      // or an answer from the cache.
      {
        ...row,
        outcome: "ok",
        tokensIn: 900,
        at: at("2026-10-11T00:00:00.000Z"),
      },
      { ...row, outcome: "failed", at: at("2026-10-11T10:00:00.000Z") },
      {
        ...row,
        outcome: "refused",
        tokensOut: 300,
        at: at("2026-10-11T10:00:00.000Z"),
      },
      { ...row, outcome: "refused", at: at("2026-10-11T10:00:00.000Z") },
      {
        ...row,
        cached: true,
        outcome: "ok",
        at: at("2026-10-11T10:00:00.000Z"),
      },
      // 12 October: nothing that counts, no day.
      { ...row, outcome: "refused", at: at("2026-10-12T10:00:00.000Z") },
    ]);
    // An answer as the previous version cached it: a key and the text.
    await db.execute(
      sql`insert into assist_cache (key, text, created_at) values ('legacy', 'Ответ без версии.', now())`,
    );

    await runMigrations(postgres.url, migrationsFolder);

    expect(
      await db.select().from(assistDays).orderBy(asc(assistDays.day)),
    ).toEqual([
      { day: "2026-10-10", spent: 2 },
      { day: "2026-10-11", spent: 3 },
    ]);
    expect(await db.select().from(assistCache)).toEqual([]);
  });
});
