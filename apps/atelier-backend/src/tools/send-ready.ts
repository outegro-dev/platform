#!/usr/bin/env node
/**
 * Starts application.send for cards in «Ready».
 *
 *   node dist/tools/send-ready.js [--limit 5] [--mode prepare|submit] [--user <uuid|owner>]
 *
 * prepare fills the form and stores the answers without submitting; submit
 * sends. The jobs are committed to the outbox: a running api dispatches them.
 */
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { applications, cvVersions, jobs, vacancies } from "../db/schema.js";
import {
  cliOrchestrator,
  fail,
  openDatabase,
  parseArgs,
  printTable,
  userKey,
} from "./cli.js";

const args = parseArgs(process.argv.slice(2));
const limit = Number(args.get("limit") ?? 5);
const mode = args.get("mode") ?? "submit";
if (!["prepare", "submit"].includes(mode)) fail("--mode is prepare or submit");
if (!Number.isInteger(limit) || limit < 1) fail("--limit is a positive number");
const user = userKey(args.get("user"));

const database = openDatabase();
try {
  const ready = await database.db
    .select({
      id: applications.id,
      userId: applications.userId,
      vacancyId: applications.vacancyId,
      score: applications.score,
      fields: vacancies.fields,
    })
    .from(applications)
    .innerJoin(vacancies, eq(vacancies.id, applications.vacancyId))
    .where(
      and(
        eq(applications.stage, "ready"),
        user ? eq(applications.userId, user) : sql`true`,
        sql`exists (select 1 from ${cvVersions} where ${cvVersions.applicationId} = ${applications.id})`,
        notExists(
          database.db
            .select({ id: jobs.id })
            .from(jobs)
            .where(
              and(
                eq(jobs.applicationId, applications.id),
                eq(jobs.kind, "application.send"),
                inArray(jobs.status, ["queued", "running", "waiting_human"]),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(applications.score))
    .limit(limit);
  const orchestrator = cliOrchestrator(database);
  const rows = [];
  for (const card of ready) {
    const jobId = await orchestrator.start({
      kind: "application.send",
      userId: card.userId,
      vacancyId: card.vacancyId,
      applicationId: card.id,
      input: { mode },
    });
    rows.push({
      score: card.score === null ? null : Math.round(card.score),
      company: card.fields.company,
      role: card.fields.title,
      mode,
      job: jobId,
    });
  }
  printTable(rows);
} finally {
  await database.close();
}
