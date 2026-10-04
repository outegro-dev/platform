// Fingerprints the result of every SQL task's solution on the book's seed
// (`expected` on sqlTask blocks). edu-backend never runs SQL: it checks a
// reader's attempt against this fingerprint with @outegro/edu-engine, so
// the book carries it. The converter calls addExpectations(); run this file
// to refresh the fingerprints of a book that is already converted:
//
//   pnpm --filter @outegro/edu-backend content:expect <slug>
//
// Run from apps/edu-backend.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bookDocumentSchema,
  exerciseAttemptSchema,
} from "@outegro/contracts/edu";
import {
  expectationOf,
  lastResult,
  MAX_ROWS,
  reportOf,
  walkBlocks,
} from "@outegro/edu-engine";

const require = createRequire(import.meta.url);
// The asm build: plain JavaScript, no WASM file to locate.
const initSqlJs = require("sql.js/dist/sql-asm.js");

/**
 * The server judges a task by what a reader's attempt reports: at most
 * MAX_ROWS rows (reportOf cuts the rest off), and columns and cells within
 * the attempt schema. A solution whose result does not fit could never be
 * judged right, so it stops the conversion.
 */
function requireReportable(result) {
  if (result.values.length > MAX_ROWS)
    throw new Error(
      `the solution returns ${result.values.length} rows; an attempt reports at most ${MAX_ROWS}`,
    );
  const attempt = exerciseAttemptSchema.safeParse({
    kind: "sqlTask",
    ...reportOf(result),
  });
  if (!attempt.success) {
    const [issue] = attempt.error.issues;
    throw new Error(
      `the solution's result does not fit an attempt (${issue.path.join(".")}: ${issue.message})`,
    );
  }
}

/**
 * Sets `expected` on every sqlTask of the book; throws, naming the task, if
 * a solution fails or its result does not fit an attempt.
 */
export async function addExpectations(book) {
  const tasks = [];
  for (const chapter of book.chapters)
    walkBlocks(chapter.blocks, (block) => {
      if (block.t === "sqlTask") tasks.push(block);
    });
  if (tasks.length === 0) return book;
  if (!book.sandbox)
    throw new Error(`${book.slug}: SQL tasks without a sandbox seed`);
  const SQL = await initSqlJs();
  for (const task of tasks) {
    const db = new SQL.Database();
    try {
      db.exec(book.sandbox.seed);
      const result = lastResult(db.exec(task.solution));
      if (!result) throw new Error("the solution returns no rows");
      requireReportable(result);
      task.expected = expectationOf(result, task.ordered);
    } catch (error) {
      throw new Error(`${task.id}: ${error.message}`);
    } finally {
      db.close();
    }
  }
  return book;
}

const run =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (run) {
  const slug = process.argv[2];
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    console.error("usage: sql-expectations.mjs <slug>");
    process.exit(2);
  }
  const file = path.join("content", "books", `${slug}.json`);
  const book = await addExpectations(JSON.parse(readFileSync(file, "utf8")));
  const parsed = bookDocumentSchema.safeParse(book);
  if (!parsed.success) {
    console.error(JSON.stringify(parsed.error.issues.slice(0, 10), null, 2));
    process.exit(1);
  }
  writeFileSync(file, `${JSON.stringify(book, null, 1)}\n`);
  let count = 0;
  for (const chapter of book.chapters)
    walkBlocks(chapter.blocks, (block) => {
      if (block.t === "sqlTask") count++;
    });
  console.log(`${file}: ${count} SQL task fingerprints`);
}
