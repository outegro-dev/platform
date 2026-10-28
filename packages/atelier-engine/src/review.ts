import type { Profile } from "@outegro/contracts/atelier";
import { adaptAbout, ownAbout } from "./assemble.js";
import { withSourceParts } from "./part-rules.js";
import { escapeRegExp, withoutLongDash } from "./text.js";
import type { CvDraft, Finding, RepairPatch } from "./types.js";
import { bulletVariants } from "./variants.js";

/** Reviews sometimes prefix a location with the prompt's data label, as in DRAFT_DATA.about.profile.full. */
export const findingLocation = (location: string) =>
  location.trim().replace(/^DRAFT(?:_DATA)?\b\W*/i, "");

/** Skills and the title are set by code, so findings about them are not actionable. */
export const isCodeFinding = (finding: Finding) =>
  /^(?:skills|title)\b/i.test(findingLocation(finding.location));

/** Bullets a review may name: everything except fixed bullets. */
const reviewable = (draft: CvDraft) =>
  draft.companies.flatMap((company) =>
    company.bullets.filter((bullet) => bullet.source !== "fixed"),
  );

const namesId = (location: string, id: string) =>
  new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`).test(location);

/**
 * Draft parts named by review findings: bullet ids, `about.profile`,
 * `about.aiTools`, `title`, `changeNotes`. Null when a finding cannot be
 * attributed to a part, so nothing generated can be trusted.
 */
export function flaggedParts(draft: CvDraft, findings: Finding[]) {
  const parts = new Set<string>();
  const bullets = reviewable(draft);
  for (const finding of findings) {
    const location = findingLocation(finding.location);
    if (/^about\b/i.test(location)) {
      for (const section of ["profile", "aiTools"])
        if (
          !/profile|aiTools/i.test(location) ||
          location.toLowerCase().includes(section.toLowerCase())
        )
          parts.add(`about.${section}`);
      continue;
    }
    if (/^title\b/i.test(location)) {
      parts.add("title");
      continue;
    }
    if (/^changeNotes\b/i.test(location)) {
      parts.add("changeNotes");
      continue;
    }
    // Reviews name bullets as bullets[P3], companies.acme.P3.full, bullet:new-1 or by index.
    const named = bullets
      .filter(
        (bullet) =>
          namesId(location, bullet.id) ||
          finding.affectedIds.some((ref) => ref.split(":")[0] === bullet.id),
      )
      .map((bullet) => bullet.id);
    const indexed = location.match(/companies\[(\d+)\]\.bullets\[(\d+)\]/);
    if (indexed) {
      const bullet =
        draft.companies[Number(indexed[1])]?.bullets[Number(indexed[2])];
      if (bullet && bullet.source !== "fixed") named.push(bullet.id);
    }
    if (!named.length) return null;
    for (const id of named) parts.add(id);
  }
  return parts;
}

/**
 * Fields a repair may rewrite for these findings: About variants
 * (`about.profile.full` …), bullet ids (their full text) and `changeNotes`.
 * Empty when no finding can be attributed; then only the source fallback helps.
 */
export function repairScope(draft: CvDraft, findings: Finding[]) {
  const fields = new Set<string>();
  const bullets = reviewable(draft);
  for (const finding of findings) {
    const location = findingLocation(finding.location);
    if (/^about\b/i.test(location)) {
      for (const section of ["profile", "aiTools"])
        if (!/profile|aiTools/i.test(location) || location.includes(section))
          for (const variant of ["full", "compact"])
            if (
              !/\.(full|compact)\b/.test(location) ||
              location.includes(`.${variant}`)
            )
              fields.add(`about.${section}.${variant}`);
      continue;
    }
    if (/^changeNotes\b/i.test(location)) {
      fields.add("changeNotes");
      continue;
    }
    for (const bullet of bullets)
      if (
        namesId(location, bullet.id) ||
        finding.affectedIds.some((ref) => ref.split(":")[0] === bullet.id)
      )
        fields.add(bullet.id);
    const indexed = location.match(/companies\[(\d+)\]\.bullets\[(\d+)\]/);
    const bullet = indexed
      ? draft.companies[Number(indexed[1])]?.bullets[Number(indexed[2])]
      : undefined;
    if (bullet && bullet.source !== "fixed") fields.add(bullet.id);
  }
  return [...fields].sort();
}

/**
 * The draft with a repair's fields replaced. A repaired bullet gets its
 * shorter forms again (from the bank while it keeps the bank's meaning).
 * The result goes through partRules and review like any draft.
 */
export function applyRepair(draft: CvDraft, patch: RepairPatch): CvDraft {
  const result: CvDraft = structuredClone(draft);
  for (const section of ["profile", "aiTools"] as const)
    for (const name of ["full", "compact"] as const) {
      const value = patch.about[section][name];
      if (value?.trim()) result.about[section][name] = value;
    }
  result.about = adaptAbout(result.about, result.years);
  for (const repaired of patch.bullets) {
    const bullet = result.companies
      .flatMap((company) => company.bullets)
      .find((item) => item.id === repaired.id && item.source !== "fixed");
    const full = withoutLongDash(repaired.full.trim());
    if (!bullet || !full) continue;
    bullet.variants = bulletVariants(full, bullet.bank);
    if (bullet.source === "bank") bullet.source = "model";
  }
  if (patch.changeNotes?.length)
    result.changes = [
      ...result.changes,
      ...patch.changeNotes
        .map((note) => withoutLongDash(note.trim()))
        .filter(Boolean),
    ];
  return result;
}

/**
 * The generation never ends in manual editing: what review could not confirm
 * takes the candidate's own text (the bank's wording, the profile's About; a
 * new bullet is left out). An unattributable finding distrusts every
 * generated part. `sourced` names the parts that changed.
 */
export function sourceFallback(
  draft: CvDraft,
  findings: Finding[],
  profile: Profile,
): { draft: CvDraft; sourced: string[] } {
  const own = ownAbout(profile, draft.years);
  const flagged = flaggedParts(
    draft,
    findings.filter((finding) => !isCodeFinding(finding)),
  );
  const parts =
    flagged ??
    new Set([
      "about.profile",
      "about.aiTools",
      ...reviewable(draft).map((bullet) => bullet.id),
    ]);
  const bullets = new Map(
    reviewable(draft).map((bullet) => [bullet.id, bullet]),
  );
  const sourced = [...parts].filter((part) => {
    if (part === "about.profile" || part === "about.aiTools") {
      const section = part.slice(6) as "profile" | "aiTools";
      return (
        draft.about[section].full !== own[section].full ||
        draft.about[section].compact !== own[section].compact
      );
    }
    if (part === "title") return draft.title !== profile.headline;
    const bullet = bullets.get(part);
    return bullet !== undefined && bullet.source !== "bank";
  });
  return {
    draft: withSourceParts(
      draft,
      sourced,
      profile,
      "Original wording kept (the fact check did not confirm the adapted text)",
    ),
    sourced,
  };
}
