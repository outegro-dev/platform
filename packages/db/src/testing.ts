import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * Real PostgreSQL 18 for integration tests (the same major as production).
 * Optionally creates tables straight from a Drizzle schema.
 */
export type TestPostgres = { url: string; stop: () => Promise<unknown> };

export async function startPostgres(
  schema?: Record<string, unknown>,
): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer(
    "postgres:18.6-alpine",
  ).start();
  const url = container.getConnectionUri();
  if (schema) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const { apply } = await pushSchema(schema, drizzle({ client }));
      await apply();
    } finally {
      await client.end();
    }
  }
  return { url, stop: () => container.stop() };
}
