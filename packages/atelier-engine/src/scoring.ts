import {
  type BankCase,
  type CategoryId,
  categoryIds,
  type Requirement,
} from "@outegro/contracts/atelier";
import { requirementImportance } from "./role-policy.js";
import { escapeRegExp } from "./text.js";
import type { Match } from "./types.js";

/** A case as selection and fitting weigh it; `matches` follow the requirement order. */
export type ScoredCase = {
  caseId: string;
  companyId: string;
  categoryFit: number;
  evidenceFit: number;
  score: number;
  matches: number[];
  ratings: Record<CategoryId, number>;
  projectId: string;
  primaryTheme: string;
  achievementGroupId: string;
};

type Weighed = Pick<Requirement, "id" | "importance">;

/**
 * A case limited to some vacancies (whenVacancyMentions, a mobile release)
 * competes only when a requirement, its quote or its technologies name one of
 * its terms as a whole word.
 */
export function eligibleFor(
  item: BankCase,
  requirements: Pick<
    Requirement,
    "text" | "evidenceQuote" | "technologyTags"
  >[],
) {
  if (!item.whenVacancyMentions) return true;
  const texts = requirements.flatMap((requirement) => [
    requirement.text,
    requirement.evidenceQuote,
    ...requirement.technologyTags,
  ]);
  return item.whenVacancyMentions.some((term) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
      "iu",
    );
    return texts.some((text) => pattern.test(text));
  });
}

export function checkWeights(weights: Record<CategoryId, number>) {
  const values = categoryIds.map((id) => weights[id]);
  if (
    values.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1,
    ) ||
    Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-9
  )
    throw new Error("Invalid normalized category weights");
}

const totalImportance = (requirements: Weighed[]) =>
  requirements.reduce(
    (sum, item) => sum + requirementImportance[item.importance],
    0,
  );

/**
 * One case against one vacancy:
 * categoryFit = 100 · Σ_c w_c · rating_c / 5,
 * evidenceFit = 100 · Σ_r imp(r) · match(r) / Σ_r imp(r),
 * score = 0.6 · categoryFit + 0.4 · evidenceFit.
 */
export function scoreCase(
  ratings: Record<CategoryId, number>,
  matches: number[],
  requirements: Weighed[],
  weights: Record<CategoryId, number>,
) {
  const total = totalImportance(requirements);
  const categoryFit =
    100 *
    categoryIds.reduce((sum, id) => sum + (weights[id] * ratings[id]) / 5, 0);
  const evidenceFit =
    (100 *
      requirements.reduce(
        (sum, requirement, index) =>
          sum +
          requirementImportance[requirement.importance] * (matches[index] ?? 0),
        0,
      )) /
    total;
  return {
    categoryFit,
    evidenceFit,
    score: 0.6 * categoryFit + 0.4 * evidenceFit,
  };
}

/** Active, eligible cases scored and ranked best first (ties by id, numeric). */
export function scoreCases(
  cases: BankCase[],
  requirements: Requirement[],
  matches: Match[],
  weights: Record<CategoryId, number>,
): ScoredCase[] {
  checkWeights(weights);
  if (!totalImportance(requirements))
    throw new Error("Cannot rank without requirements");
  return cases
    .filter((item) => item.active && eligibleFor(item, requirements))
    .map((item) => {
      const vector = requirements.map(
        (requirement) =>
          matches.find(
            (match) =>
              match.caseId === item.id &&
              match.requirementId === requirement.id,
          )?.match ?? 0,
      );
      return {
        caseId: item.id,
        companyId: item.companyId,
        ...scoreCase(item.categoryRatings, vector, requirements, weights),
        matches: vector,
        ratings: item.categoryRatings,
        projectId: item.projectId,
        primaryTheme: item.primaryTheme,
        achievementGroupId: item.achievementGroupId,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.caseId.localeCompare(b.caseId, "en", { numeric: true }),
    );
}

export type SetMetrics = {
  utility: number;
  meanScore: number;
  requirementCoverage: number;
  categoryCoverage: number;
  projectPenalty: number;
  themePenalty: number;
};

/**
 * A whole set of bullets:
 * utility = 0.6 · mean(score) + 0.25 · reqCoverage + 0.15 · catCoverage
 *           − 1.5 · Σ_project max(0, n − 1) − Σ_theme max(0, n − 2).
 * `extra` is the best evidence per requirement of bullets that are not bank
 * cases (bullets a free-mode composition added); it counts for coverage only.
 */
export function measureSet(
  cases: ScoredCase[],
  requirements: Weighed[],
  weights: Record<CategoryId, number>,
  extra: number[] = [],
): SetMetrics {
  if (!cases.length && !extra.some((value) => value > 0))
    return {
      utility: 0,
      meanScore: 0,
      requirementCoverage: 0,
      categoryCoverage: 0,
      projectPenalty: 0,
      themePenalty: 0,
    };
  if (
    new Set(cases.map((item) => item.achievementGroupId)).size !== cases.length
  )
    throw new Error("Duplicate achievement group");
  // Hot path of exhaustive selection: plain loops, same summation order as the reduce form.
  let scoreSum = 0;
  for (const item of cases) scoreSum += item.score;
  const meanScore = cases.length ? scoreSum / cases.length : 0;
  const total = totalImportance(requirements);
  let covered = 0;
  for (let index = 0; index < requirements.length; index++) {
    let best = extra[index] ?? 0;
    for (const item of cases) {
      const match = item.matches[index] ?? 0;
      if (match > best) best = match;
    }
    covered +=
      requirementImportance[(requirements[index] as Weighed).importance] * best;
  }
  const requirementCoverage = total ? (100 * covered) / total : 0;
  let categories = 0;
  if (cases.length)
    for (const id of categoryIds) {
      let best = Number.NEGATIVE_INFINITY;
      for (const item of cases) {
        const rating = item.ratings[id];
        if (rating > best) best = rating;
      }
      categories += (weights[id] * best) / 5;
    }
  const categoryCoverage = 100 * categories;
  const counts = (key: "projectId" | "primaryTheme") => {
    const map = new Map<string, number>();
    for (const item of cases) map.set(item[key], (map.get(item[key]) ?? 0) + 1);
    return [...map.values()];
  };
  const projectPenalty =
    1.5 * counts("projectId").reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  const themePenalty = counts("primaryTheme").reduce(
    (sum, n) => sum + Math.max(0, n - 2),
    0,
  );
  return {
    utility:
      0.6 * meanScore +
      0.25 * requirementCoverage +
      0.15 * categoryCoverage -
      projectPenalty -
      themePenalty,
    meanScore,
    requirementCoverage,
    categoryCoverage,
    projectPenalty,
    themePenalty,
  };
}
