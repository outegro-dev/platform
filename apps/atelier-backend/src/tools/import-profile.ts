#!/usr/bin/env node
/**
 * Imports a profile into `profiles`.
 *
 *   node dist/tools/import-profile.js --work-finder <dir> --user <uuid|owner>
 *   node dist/tools/import-profile.js --work-finder <dir> --out profile.json
 *   node dist/tools/import-profile.js --stdin --user owner < profile.json
 *
 * From Work Finder: assets/profile/achievement-bank.v2.json (cases keep
 * their ids), templates/cv/content.tex (person, links, summary, skills,
 * jobs, education, languages) and 08_VOICE_ABOUT_ME_AND_MESSAGES.md. The
 * personal data stays in those files and the database, never in the repo.
 * `--user owner` stores it for the owner's account before its id is known;
 * the first sign-in with atelier.use adopts it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Profile, profileSchema } from "@outegro/contracts/atelier";
import { sql } from "drizzle-orm";
import { profiles } from "../db/schema.js";
import { fail, openDatabase, parseArgs, userKey } from "./cli.js";
import { buildProfile } from "./profile/build-profile.js";
import { parseContentTex } from "./profile/content-tex.js";
import { parseVoice } from "./profile/voice.js";

const args = parseArgs(process.argv.slice(2));

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function fromWorkFinder(dir: string): Profile {
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  return buildProfile({
    bank: JSON.parse(read("assets/profile/achievement-bank.v2.json")),
    content: parseContentTex(read("templates/cv/content.tex")),
    voice: parseVoice(read("08_VOICE_ABOUT_ME_AND_MESSAGES.md")),
  });
}

/** Bank rules of the engine; problems are printed, the import goes on. */
async function bankIssues(profile: Profile): Promise<string[]> {
  try {
    const engine = await import("@outegro/atelier-engine");
    const issues = engine.validateBank(profile);
    return Array.isArray(issues) ? issues.map(String) : [];
  } catch (error) {
    return [`validateBank unavailable: ${(error as Error).message}`];
  }
}

const dir = args.get("work-finder");
let profile: Profile;
if (args.has("stdin")) {
  const parsed = profileSchema.safeParse(JSON.parse(await readStdin()));
  if (!parsed.success)
    fail(`stdin is not a valid Profile:\n${parsed.error.message}`);
  profile = parsed.data;
} else if (dir) {
  try {
    profile = fromWorkFinder(dir);
  } catch (error) {
    fail(`could not build the profile: ${(error as Error).message}`);
  }
} else {
  fail(
    "usage: import-profile (--work-finder <dir> | --stdin) (--user <uuid|owner> | --out <file>)",
  );
}

const issues = await bankIssues(profile);
for (const issue of issues) console.warn(`bank: ${issue}`);
console.error(
  `profile: ${profile.bank.cases.length} cases, ${profile.companies.length} companies, ${profile.skills.length} skill rows, ${profile.voice.rules.length} voice rules, ${issues.length} bank issues`,
);

const out = args.get("out");
if (out) {
  writeFileSync(out, `${JSON.stringify(profile, null, 2)}\n`);
  console.error(`written to ${out}`);
}
const user = userKey(args.get("user"));
if (user) {
  const database = openDatabase();
  try {
    const [row] = await database.db
      .insert(profiles)
      .values({ userId: user, data: profile, version: 1 })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          data: profile,
          version: sql`${profiles.version} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ version: profiles.version });
    console.error(`stored for ${args.get("user")} as version ${row?.version}`);
  } finally {
    await database.close();
  }
} else if (!out) fail("nothing to do: pass --user or --out");
