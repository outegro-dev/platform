import { existsSync } from "node:fs";
import { createDatabase } from "@outegro/db";
import { systemClock } from "@outegro/nest-common";
import type { AtelierDatabase } from "../common/database.js";
import type { PipelineConfig } from "../config/config.js";
import * as schema from "../db/schema.js";
import { OWNER_PLACEHOLDER } from "../db/schema.js";
import { OrchestratorService } from "../orchestrator/orchestrator.service.js";

/** `--name value` and `--flag` pairs; repeated names collect every value. */
export function parseArgs(argv: string[]) {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (!arg.startsWith("--")) continue;
    const [name, inline] = arg.slice(2).split("=", 2) as [
      string,
      string | undefined,
    ];
    const next = argv[index + 1];
    let value = inline ?? "true";
    if (inline === undefined && next !== undefined && !next.startsWith("--")) {
      value = next;
      index++;
    }
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  return {
    get: (name: string) => values.get(name)?.at(-1),
    all: (name: string) => values.get(name) ?? [],
    has: (name: string) => values.has(name),
  };
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** `owner` (the placeholder the first signed-in owner adopts) or a user id. */
export function userKey(value: string | undefined) {
  if (!value) return undefined;
  if (value === "owner") return OWNER_PLACEHOLDER;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail(`--user must be a uuid or "owner", got ${value}`);
  return value.toLowerCase();
}

/** The database from DATABASE_URL (.env in the working directory counts). */
export function openDatabase(): AtelierDatabase {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set");
  return createDatabase({
    url,
    schema,
    max: 4,
    applicationName: "atelier-cli",
  });
}

/**
 * The orchestrator without a relay: jobs and their tasks are committed to
 * the outbox, and the running api (ROLE=api) publishes them.
 */
export function cliOrchestrator(database: AtelierDatabase) {
  const config: PipelineConfig = {
    maxAttempts: Number(process.env.STEP_MAX_ATTEMPTS ?? 4),
    quotaPauseSeconds: Number(process.env.LLM_QUOTA_PAUSE_SECONDS ?? 3600),
    schedulerIntervalMs: 0,
    tickDailyHour: 6,
  };
  return new OrchestratorService(database, systemClock, config);
}

/** A fixed-width table on stdout. */
export function printTable(rows: Record<string, string | number | null>[]) {
  if (!rows.length) {
    console.log("(nothing)");
    return;
  }
  const columns = Object.keys(rows[0] as object);
  const width = (column: string) =>
    Math.min(
      60,
      Math.max(
        column.length,
        ...rows.map((row) => String(row[column] ?? "").length),
      ),
    );
  const cell = (value: unknown, column: string) =>
    String(value ?? "")
      .slice(0, width(column))
      .padEnd(width(column));
  console.log(columns.map((column) => cell(column, column)).join("  "));
  console.log(columns.map((column) => "-".repeat(width(column))).join("  "));
  for (const row of rows)
    console.log(columns.map((column) => cell(row[column], column)).join("  "));
}
