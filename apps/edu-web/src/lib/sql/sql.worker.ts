import type { SqlResult } from "@outegro/edu-engine";
import type { SqlJsStatic } from "sql.js";
import initSqlJs from "sql.js/dist/sql-asm.js";
import type { RunRequest, WorkerMessage } from "./protocol";

/*
 * The SQL sandbox's engine: SQLite compiled to asm.js (sql.js), so there is
 * no WASM file to serve and the page's CSP needs no 'wasm-unsafe-eval'.
 * It runs in this dedicated worker so a slow query never freezes the page;
 * the page terminates the worker when a query runs too long. Every run
 * opens a fresh in-memory database from the book's seed.
 */

let engine: Promise<SqlJsStatic> | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reply(message: WorkerMessage) {
  postMessage(message);
}

addEventListener("message", async (event: MessageEvent<RunRequest>) => {
  const { id, seed, sql } = event.data;
  let SQL: SqlJsStatic;
  try {
    engine ??= initSqlJs();
    SQL = await engine;
  } catch (error) {
    reply({ id, type: "error", message: messageOf(error), fatal: true });
    return;
  }
  // The page starts its 3-second clock now: loading the engine does not count.
  reply({ id, type: "started" });
  let db: InstanceType<SqlJsStatic["Database"]> | null = null;
  try {
    db = new SQL.Database();
    db.exec(seed);
    const results = db.exec(sql) as SqlResult[];
    reply({ id, type: "done", results });
  } catch (error) {
    const message = messageOf(error);
    reply({
      id,
      type: "error",
      message,
      fatal: /abort|out of memory/i.test(message),
    });
  } finally {
    try {
      db?.close();
    } catch {
      // A database the engine already tore down cannot be closed twice.
    }
  }
});
