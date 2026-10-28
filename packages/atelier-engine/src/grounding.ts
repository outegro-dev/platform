import type {
  BankCase,
  Requirement,
  VacancyAnalysis,
} from "@outegro/contracts/atelier";
import type { Match } from "./types.js";

/** Case, typographic quotes/dashes, bullets and whitespace do not change what a quote says. */
const folded = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•·▪●◦‣⁃]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The quote occurs in the text; an elided quote ("A ... B") needs every fragment, in order. */
export function quoteInText(quote: string, text: string) {
  const haystack = folded(text);
  const fragments = folded(quote)
    .split(/\s*(?:\.{3,}|…)\s*/)
    .map((part) => part.replace(/^[\s\-*:;,.!?]+|[\s\-*:;,.!?]+$/g, ""))
    .filter(Boolean);
  let from = 0;
  for (const fragment of fragments) {
    const at = haystack.indexOf(fragment, from);
    if (at < 0) return false;
    from = at + fragment.length;
  }
  return fragments.length > 0;
}

export type DroppedRequirement = { id: string; reason: string };

/**
 * The analysis is evidence about the vacancy. What cannot be verified is
 * dropped instead of failing the step: a repeated id, a repeated requirement
 * and a quote that is not in the vacancy text. Only an analysis without any
 * grounded requirement is an error.
 */
export function groundRequirements(
  analysis: VacancyAnalysis,
  text: string,
): { analysis: VacancyAnalysis; dropped: DroppedRequirement[] } {
  const dropped: DroppedRequirement[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  const requirements: Requirement[] = [];
  for (const requirement of analysis.requirements) {
    const key = requirement.text.toLowerCase().replace(/\s+/g, " ").trim();
    const reason = ids.has(requirement.id)
      ? "duplicate id"
      : texts.has(key)
        ? "duplicate requirement"
        : quoteInText(requirement.evidenceQuote, text)
          ? null
          : "quote not found in the vacancy";
    if (reason) {
      dropped.push({ id: requirement.id, reason });
      continue;
    }
    ids.add(requirement.id);
    texts.add(key);
    requirements.push({
      ...requirement,
      categoryIds: [...new Set(requirement.categoryIds)],
    });
  }
  if (!requirements.length) {
    const why = dropped.length
      ? ` (${dropped.map((item) => `${item.id}: ${item.reason}`).join("; ")})`
      : "";
    throw new Error(`Analysis returned no grounded requirements${why}`);
  }
  return { analysis: { ...analysis, requirements }, dropped };
}

/** Claim, capability and metric ids a case can be evidenced by. */
export const evidenceIds = (item: BankCase) =>
  new Set(
    [...item.capabilities, ...item.keyClaims, ...item.metricClaims].map(
      (claim) => claim.id,
    ),
  );

/**
 * Matches keep only what can be verified: a known requirement, an active
 * case, the case's own evidence ids, one answer per pair, and evidence for
 * every positive match. Everything else is dropped, never fatal.
 */
export function groundMatches(
  matches: Match[],
  requirements: Pick<Requirement, "id">[],
  cases: BankCase[],
): Match[] {
  const known = new Set(requirements.map((item) => item.id));
  const pairs = new Set<string>();
  const result: Match[] = [];
  for (const match of matches) {
    const item = cases.find(
      (candidate) => candidate.id === match.caseId && candidate.active,
    );
    const pair = `${match.requirementId}:${match.caseId}`;
    if (!item || !known.has(match.requirementId) || pairs.has(pair)) continue;
    const evidence = evidenceIds(item);
    const evidenceRefs = [...new Set(match.evidenceRefs)].filter((ref) =>
      evidence.has(ref),
    );
    if (match.match > 0 && !evidenceRefs.length) continue;
    pairs.add(pair);
    result.push({ ...match, evidenceRefs });
  }
  return result;
}
