import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, readWithTimeout } from "./client.js";
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
