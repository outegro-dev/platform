#!/usr/bin/env node
/**
 * Finds vacancies and starts CV builds for the best of them.
 *
 *   node dist/tools/run-batch.js --discover 10 [--exclude-file <path>]... [--min-score 55] [--home <words>]
 *   node dist/tools/run-batch.js --urls urls.txt [--user <uuid|owner>] [--dry-run]
 *
 * --discover N: wantapply and hirify listings, plus the ATS boards
 * (discoverBoards → listBoard) of the companies seen there; keeps
 * remote-friendly senior-ish software roles (frontend, backend, full-stack,
 * AI) whose apply form is on Ashby, Lever, Greenhouse or Workable, quick-
 * scores them and starts application.build for the top N. The jobs are
 * committed to the outbox: a running api (ROLE=api) dispatches them.
 */
import { readFileSync } from "node:fs";
import type { Profile, VacancyFields } from "@outegro/contracts/atelier";
import { eq } from "drizzle-orm";
import { publishVacancy } from "../catalog/catalog.js";
import { applications, profiles } from "../db/schema.js";
import { startBuildFor } from "../orchestrator/workflows.js";
import { formAtsOf } from "../steps/common.js";
import {
  cliOrchestrator,
  fail,
  openDatabase,
  parseArgs,
  printTable,
  userKey,
} from "./cli.js";
import { isExcluded, loadExclusions } from "./exclusions.js";

const args = parseArgs(process.argv.slice(2));
const discover = Number(args.get("discover") ?? 0);
const urlsFile = args.get("urls");
if (!discover && !urlsFile)
  fail(
    "usage: run-batch (--discover <N> | --urls <file>) [--exclude-file <path>]... [--min-score <n>] [--user <uuid|owner>] [--dry-run]",
  );
const top = discover || Number(args.get("top") ?? 1000);
const minScore = Number(args.get("min-score") ?? 50);
const dryRun = args.has("dry-run");
const excluded = loadExclusions(args.all("exclude-file"));

const sources = await import("@outegro/atelier-sources");
const engine = await import("@outegro/atelier-engine");
const http = sources.createHttp?.({});

const titleFits = (title: string) =>
  /\b(senior|sr\.?|lead|staff|principal|middle\+?)\b/i.test(title) &&
  /\b(front[- ]?end|back[- ]?end|full[- ]?stack|software|node(\.js)?|typescript|react|ai|ml|llm|platform|product)\b/i.test(
    title,
  ) &&
  !/\b(qa|test|devops|sre|data (scientist|analyst)|designer|manager|recruit|sales|marketing|support|ios|android|mobile)\b/i.test(
    title,
  );

// --home "country,city": the owner's own place also counts as remote-friendly.
const home = (args.get("home") ?? "")
  .split(",")
  .map((word) => word.trim().toLowerCase())
  .filter(Boolean);

const remoteFriendly = (location: string | null, remote: boolean | null) =>
  remote === true ||
  /remote|anywhere|worldwide|global|emea|europe|cet|utc/i.test(
    location ?? "",
  ) ||
  home.some((word) => (location ?? "").toLowerCase().includes(word));

const formAtsKinds = ["ashby", "lever", "greenhouse", "workable"];

type Candidate = {
  url: string;
  company: string | null;
  title: string | null;
  via: string;
};

async function candidates(): Promise<Candidate[]> {
  if (urlsFile)
    return readFileSync(urlsFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//.test(line))
      .map((url) => ({ url, company: null, title: null, via: "file" }));
  const found: Candidate[] = [];
  const companies = new Set<string>();
  for (const source of ["wantapply", "hirify"] as const) {
    try {
      const postings = await sources.discoverAggregator(
        source,
        { pages: 3 },
        http,
      );
      for (const posting of postings) {
        if (isExcluded(excluded, posting.company) || !titleFits(posting.title))
          continue;
        companies.add(posting.company);
        const original = (posting as { originalUrl?: string | null })
          .originalUrl;
        found.push({
          url: original && formAtsOf(original) ? original : posting.url,
          company: posting.company,
          title: posting.title,
          via: source,
        });
      }
    } catch (error) {
      console.warn(`${source}: ${(error as Error).message}`);
    }
  }
  for (const company of companies) {
    try {
      const boards = await sources.discoverBoards(company, http);
      for (const board of boards as { ats: string; board: string }[]) {
        if (!formAtsKinds.includes(board.ats)) continue;
        const postings = await sources.listBoard(
          board.ats as never,
          board.board,
          http,
        );
        for (const posting of postings as {
          title: string;
          url: string;
          location: string | null;
          remote: boolean | null;
        }[])
          if (
            titleFits(posting.title) &&
            remoteFriendly(posting.location, posting.remote)
          )
            found.push({
              url: posting.url,
              company,
              title: posting.title,
              via: `${board.ats}:${board.board}`,
            });
      }
    } catch (error) {
      console.warn(`boards of ${company}: ${(error as Error).message}`);
    }
  }
  const seen = new Set<string>();
  return found.filter((item) => !seen.has(item.url) && seen.add(item.url));
}

/** Runs `work` over `items`, `limit` at a time. */
async function pool<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++] as T;
        results.push(await work(item));
      }
    }),
  );
  return results;
}

const database = openDatabase();
try {
  // Without --user: the only profile there is.
  const only = await database.db
    .select({ userId: profiles.userId })
    .from(profiles)
    .limit(2);
  const user =
    userKey(args.get("user")) ??
    (only.length === 1 ? only[0]?.userId : undefined);
  if (!user) fail("pass --user: there is not exactly one profile");
  const [row] = await database.db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user));
  if (!row) fail(`no profile for ${user}; run import-profile first`);
  const profile: Profile = row.data;

  const list = await candidates();
  console.error(
    `${list.length} candidates; fetching up to ${Math.min(list.length, Math.max(top * 6, 30))}`,
  );
  type Scored = {
    fields: VacancyFields;
    structure: ReturnType<typeof sources.structureVacancy>;
    score: number;
    via: string;
    note: string;
  };
  const scored: Scored[] = [];
  const skipped: Record<string, string | number | null>[] = [];
  await pool(list.slice(0, Math.max(top * 6, 30)), 4, async (candidate) => {
    const result = await sources
      .fetchVacancy(candidate.url, http)
      .catch((error: Error) => ({
        ok: false as const,
        status: "failed" as const,
        reason: error.message,
      }));
    if (!result.ok) {
      skipped.push({
        url: candidate.url,
        reason: `${result.status}: ${result.reason}`.slice(0, 80),
      });
      return;
    }
    const fields = result.fields;
    const why = isExcluded(excluded, fields.company, fields.atsBoard)
      ? "excluded company"
      : !formAtsOf(fields.applyUrl)
        ? "no Ashby/Lever/Greenhouse/Workable form"
        : !remoteFriendly(fields.location, fields.remote)
          ? "not remote"
          : !titleFits(fields.title)
            ? "role"
            : null;
    if (why) {
      skipped.push({ url: candidate.url, reason: why });
      return;
    }
    const structure = sources.structureVacancy(fields.text, fields.title);
    if (
      !["frontend", "backend", "fullstack", "ai"].includes(structure.roleFocus)
    ) {
      skipped.push({
        url: candidate.url,
        reason: `focus ${structure.roleFocus}`,
      });
      return;
    }
    const quick = engine.quickScore(profile, structure, fields);
    if (quick.score < minScore) {
      skipped.push({ url: candidate.url, reason: `score ${quick.score}` });
      return;
    }
    scored.push({
      fields,
      structure,
      score: quick.score,
      via: candidate.via,
      note: quick.reasons.slice(0, 2).join("; "),
    });
  });
  scored.sort((a, b) => b.score - a.score);
  const orchestrator = cliOrchestrator(database);
  const rows: Record<string, string | number | null>[] = [];
  for (const [index, item] of scored.entries()) {
    const build = index < top;
    let action = build ? "build" : "fit";
    if (!dryRun) {
      action = await database.db.transaction(async (tx) => {
        const keys = sources.vacancyKeys({
          url: item.fields.originalUrl ?? item.fields.url,
          text: item.fields.text,
          company: item.fields.company,
          title: item.fields.title,
          location: item.fields.location,
        });
        const { vacancy, duplicate } = await publishVacancy(tx, {
          fields: item.fields,
          structure: item.structure,
          keys,
          now: new Date(),
        });
        const [existing] = await tx
          .select({ id: applications.id, stage: applications.stage })
          .from(applications)
          .where(eq(applications.vacancyId, vacancy.id));
        if (existing && existing.stage !== "found" && existing.stage !== "fit")
          return `already ${existing.stage}`;
        if (build) {
          await startBuildFor(
            tx,
            { start: orchestrator.startIn, now: new Date() },
            user,
            vacancy.id,
            {},
            item.score,
          );
          return duplicate ? "build (known vacancy)" : "build";
        }
        await tx
          .insert(applications)
          .values({
            userId: user,
            vacancyId: vacancy.id,
            stage: "fit",
            score: item.score,
          })
          .onConflictDoNothing();
        return "fit";
      });
    }
    rows.push({
      score: Math.round(item.score),
      company: item.fields.company,
      role: item.fields.title,
      ats: item.fields.ats,
      via: item.via,
      action,
      url: item.fields.applyUrl ?? item.fields.url,
    });
  }
  printTable(rows);
  console.error(
    `${scored.length} kept, ${skipped.length} skipped${dryRun ? " (dry run: nothing stored)" : ""}`,
  );
  if (args.has("verbose")) printTable(skipped);
} finally {
  await database.close();
}
