import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";
import { startPostgres, type TestPostgres } from "./testing.js";

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
