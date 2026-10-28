import { readdirSync, readFileSync, statSync } from "node:fs";

/** A company name or slug as one comparable key ("Coins Paid" → coinspaid). */
export const companyKey = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(
      /\b(inc|llc|ltd|gmbh|corp|co|group|labs?|technologies|tech)\b\.?/g,
      "",
    )
    .replace(/[^a-z0-9]+/g, "");

const atsSlug: RegExp[] = [
  /jobs(?:\.eu)?\.lever\.co\/([^/?#]+)/i,
  /jobs\.ashbyhq\.com\/([^/?#]+)/i,
  /(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i,
  /apply\.workable\.com\/([^/?#]+)/i,
  /linkedin\.com\/company\/([^/?#]+)/i,
  /\/\/([^./]+)\.(?:teamtailor|bamboohr|recruitee|breezy|personio|smartrecruiters)\./i,
  /wantapply\.com\/[^?#]*-at-([a-z0-9-]+?)(?:-\d+)?(?:[?#/]|$)/i,
];

const ignoredHosts =
  /(^|\.)(linkedin\.com|t\.me|telegram\.me|wantapply\.com|hirify\.me|hh\.ru|headhunter\.ge|google\.com|lever\.co|ashbyhq\.com|greenhouse\.io|workable\.com|github\.com)$/i;

/** Company keys a line names: ATS slugs, company domains, "1) Name" headings. */
export function keysOfLine(line: string): string[] {
  const keys: string[] = [];
  for (const url of line.match(/https?:\/\/\S+/g) ?? []) {
    for (const pattern of atsSlug) {
      const slug = pattern.exec(url)?.[1];
      if (slug) keys.push(companyKey(slug.replace(/\.(com|io|co|ai)$/i, "")));
    }
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (!ignoredHosts.test(host)) {
        const parts = host.split(".");
        const name = parts.length > 2 ? parts.at(-2) : parts[0];
        if (name && !/^(jobs|careers|apply|boards)$/.test(name))
          keys.push(companyKey(name));
      }
    } catch {
      // not a URL after all
    }
  }
  const heading = /^\s*\d+\)\s*([^\s:/][^:/]*?)\s*$/.exec(line)?.[1];
  if (heading && !/https?:/.test(heading)) keys.push(companyKey(heading));
  return keys.filter((key) => key.length >= 3);
}

/**
 * Companies to leave out: a text file of earlier applications (names,
 * links) or a folder whose subfolders are named after companies
 * (`abc_fitness`).
 */
export function loadExclusions(paths: string[]) {
  const keys = new Set<string>();
  for (const path of paths) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true }))
        if (entry.isDirectory())
          keys.add(companyKey(entry.name.replace(/_/g, " ")));
      continue;
    }
    for (const line of readFileSync(path, "utf8").split(/\r?\n/))
      for (const key of keysOfLine(line)) keys.add(key);
  }
  keys.delete("");
  return keys;
}

export function isExcluded(
  keys: Set<string>,
  ...names: (string | null | undefined)[]
) {
  return names.some((name) => {
    if (!name) return false;
    const key = companyKey(name);
    return key.length >= 3 && keys.has(key);
  });
}
