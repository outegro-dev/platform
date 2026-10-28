import type { Profile } from "@outegro/contracts/atelier";
import { ownAbout } from "./assemble.js";
import {
  endsSentence,
  numbers,
  plainText,
  rawText,
  unique,
  withoutLongDash,
} from "./text.js";
import { type CvDraft, type DraftBullet, variantNames } from "./types.js";

/** A rule broken by one part: a bullet id, `about.profile`, `about.aiTools` or `title`. */
export type PartIssue = { part: string; message: string };

const aboutLimit = 1000;
const bulletLimit = 700;

/** The AI workflow paragraph names both tools, verification and personal responsibility. */
export const keepsAiWorkflow = (value: string) =>
  /\bCodex\b/i.test(value) &&
  /\bClaude(?: Code)?\b/i.test(value) &&
  /\b(?:tests?|test\w*|verif\w*|validat\w*|review\w*)\b/i.test(value) &&
  /\b(?:responsib\w*|own\w*|accountab\w*)\b/i.test(value);

/**
 * Rules each part meets on its own (composition-policy of Work Finder):
 * no raw LaTeX or line breaks, a full stop at the end, no figures in the
 * About except the tenure, an AI paragraph that keeps the tools, the checks
 * and the responsibility, and a full bullet that keeps every bank metric
 * verbatim. Strict mode: a bullet states only figures its case has. Free
 * mode: new figures are allowed, but a bank figure may not be replaced.
 */
export function draftIssues(draft: CvDraft, profile: Profile): PartIssue[] {
  const issues: PartIssue[] = [];
  if (rawText(draft.title) || !draft.title.trim())
    issues.push({
      part: "title",
      message: "Title: raw LaTeX or multiline prose",
    });
  const own = ownAbout(profile, draft.years);
  const tenure = `${draft.years}+`;
  for (const section of ["profile", "aiTools"] as const) {
    const part = `about.${section}`;
    // The profile's own About is the candidate's text; generated-About rules do not apply to it.
    const values = [
      draft.about[section].full,
      draft.about[section].compact,
    ].filter(
      (value) => value !== own[section].full && value !== own[section].compact,
    );
    const figures = unique(values.flatMap(numbers)).filter(
      (value) => value !== tenure,
    );
    if (figures.length)
      issues.push({
        part,
        message: `About ${section} contains project metrics or invented tenure: ${figures.join(", ")}`,
      });
    if (values.some((value) => rawText(value) || !value.trim()))
      issues.push({
        part,
        message: `About ${section}: raw LaTeX or multiline prose`,
      });
    if (values.some((value) => value.length > aboutLimit))
      issues.push({
        part,
        message: `About ${section}: longer than ${aboutLimit} characters`,
      });
    if (
      section === "aiTools" &&
      values.some((value) => !keepsAiWorkflow(value))
    )
      issues.push({
        part,
        message:
          "AI workflow must retain Codex and Claude Code, verification and personal responsibility",
      });
  }
  const cases = new Map(profile.bank.cases.map((item) => [item.id, item]));
  for (const bullet of draft.companies.flatMap((company) => company.bullets)) {
    if (bullet.source === "fixed" || bullet.source === "bank") continue;
    const item = bullet.caseId ? cases.get(bullet.caseId) : undefined;
    const messages = new Set<string>();
    if (!item && draft.factsMode === "strict")
      messages.add(`${bullet.id}: strict mode prints bank cases only`);
    // A shorter form may leave a figure out; no form may state a figure the case does not have.
    const known = new Set(
      item ? variantNames.flatMap((name) => numbers(item.variants[name])) : [],
    );
    for (const name of variantNames) {
      const text = plainText(bullet.variants[name]);
      if (!endsSentence(text) || rawText(text))
        messages.add(`${bullet.id}: incomplete or raw LaTeX variant`);
      if (bullet.variants[name].length > bulletLimit)
        messages.add(`${bullet.id}: longer than ${bulletLimit} characters`);
      if (item && draft.factsMode === "strict") {
        const invented = numbers(text).filter((value) => !known.has(value));
        if (invented.length)
          messages.add(
            `${bullet.id}: numbers the achievement does not have: ${invented.join(", ")}. Use the achievement's own figures or leave them out.`,
          );
      }
    }
    if (item) {
      const full = plainText(bullet.variants.full);
      for (const metric of item.metricClaims)
        if (!full.toLowerCase().includes(metric.text.toLowerCase()))
          messages.add(
            `${bullet.id}: the full form must keep the figure '${metric.text}'`,
          );
      if (draft.factsMode === "free") {
        const stated = new Set(numbers(full));
        const lost = numbers(item.variants.full).filter(
          (value) => !stated.has(value),
        );
        const added = [...stated].filter((value) => !known.has(value));
        if (lost.length && added.length)
          messages.add(
            `${bullet.id}: bank figures changed (${lost.join(", ")} became ${added.join(", ")})`,
          );
      }
    }
    for (const message of messages) issues.push({ part: bullet.id, message });
  }
  return issues;
}

/** Requirement ids a case bullet in the bank's wording evidences: every match the analysis gave it. */
const bankRequirements = (draft: CvDraft, caseId: string) =>
  unique(
    draft.fit.matches
      .filter((match) => match.caseId === caseId && match.match > 0)
      .map((match) => match.requirementId),
  );

/** A case bullet in the bank's own words, or null for a bullet the bank does not have. */
function asBank(
  bullet: DraftBullet,
  draft: CvDraft,
  profile: Profile,
): DraftBullet | null {
  if (bullet.source === "fixed") return bullet;
  if (!bullet.caseId || !bullet.bank) return null;
  const item = profile.bank.cases.find(
    (candidate) => candidate.id === bullet.caseId,
  );
  return {
    ...bullet,
    source: "bank",
    variants: { ...bullet.bank },
    requirementIds: bankRequirements(draft, bullet.caseId),
    retainedClaimIds: item
      ? [...item.keyClaims, ...item.metricClaims].map((claim) => claim.id)
      : bullet.retainedClaimIds,
  };
}

const partLabels: Record<string, string> = {
  "about.profile": "About profile",
  "about.aiTools": "About AI workflow",
  title: "title",
};

/**
 * Parts replaced by the candidate's own text: a case bullet takes the bank's
 * wording, a new bullet is left out, an About paragraph takes the profile's
 * own (with the vacancy's tenure) and the title takes the profile headline.
 */
export function withSourceParts(
  draft: CvDraft,
  parts: Iterable<string>,
  profile: Profile,
  note: string,
): CvDraft {
  const replace = new Set(parts);
  if (!replace.size) return draft;
  const own = ownAbout(profile, draft.years);
  const result: CvDraft = structuredClone(draft);
  for (const company of result.companies)
    company.bullets = company.bullets.flatMap((bullet) => {
      if (!replace.has(bullet.id)) return [bullet];
      const source = asBank(bullet, draft, profile);
      return source ? [source] : [];
    });
  for (const section of ["profile", "aiTools"] as const)
    if (replace.has(`about.${section}`))
      result.about[section] = { ...own[section] };
  if (replace.has("title")) result.title = profile.headline;
  const labels = [...replace]
    .filter((part) => part !== "changeNotes")
    .map((part) => partLabels[part] ?? part);
  if (labels.length)
    result.changes = [...result.changes, `${note}: ${labels.join(", ")}.`];
  return result;
}

/** Long dashes become plain ones in every generated part. */
function withoutLongDashes(draft: CvDraft): CvDraft {
  const result: CvDraft = structuredClone(draft);
  result.title = withoutLongDash(result.title);
  for (const section of ["profile", "aiTools"] as const)
    for (const name of ["full", "compact"] as const)
      result.about[section][name] = withoutLongDash(
        result.about[section][name],
      );
  for (const bullet of result.companies.flatMap((company) => company.bullets))
    for (const name of variantNames)
      bullet.variants[name] = withoutLongDash(bullet.variants[name]);
  return result;
}

/**
 * The draft with every rule-breaking part replaced by the candidate's own
 * text; the rest of the draft is kept. `replaced` names the parts.
 */
export function partRules(
  draft: CvDraft,
  profile: Profile,
): { draft: CvDraft; replaced: string[] } {
  const clean = withoutLongDashes(draft);
  const replaced = unique(
    draftIssues(clean, profile).map((issue) => issue.part),
  );
  return {
    draft: withSourceParts(
      clean,
      replaced,
      profile,
      "Original wording kept (the adapted text broke a CV rule)",
    ),
    replaced,
  };
}
