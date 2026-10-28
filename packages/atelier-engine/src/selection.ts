import type { Profile, Requirement } from "@outegro/contracts/atelier";
import { groundMatches } from "./grounding.js";
import { measureSet, type ScoredCase, scoreCases } from "./scoring.js";
import type {
  CompanyQuota,
  Match,
  MatchValue,
  RolePolicy,
  Selection,
  Template,
} from "./types.js";

/** Profile companies in CV order (`order`, then their place in the profile). */
export const orderedCompanies = (profile: Profile) =>
  profile.companies
    .map((company, index) => ({ company, index }))
    .sort((a, b) => a.company.order - b.company.order || a.index - b.index)
    .map((item) => item.company);

/** Companies a template prints: an AI-only company stays out of the general one. */
export const templateCompanies = (profile: Profile, template: Template) =>
  orderedCompanies(profile).filter(
    (company) => template === "ai" || !company.aiOnly,
  );

/** Bullet quotas of the companies that get bank cases in this template. */
export function companyQuotas(profile: Profile, template: Template) {
  return templateCompanies(profile, template)
    .map((company) => ({
      companyId: company.id,
      target: company.quota[template].target,
      min: Math.min(
        company.quota[template].min,
        company.quota[template].target,
      ),
    }))
    .filter((quota) => quota.target > 0);
}

/** Every way to take `count` cases from a pool without repeating an achievement group. */
function combinations(pool: ScoredCase[], count: number): ScoredCase[][] {
  const result: ScoredCase[][] = [];
  const visit = (start: number, selected: ScoredCase[]) => {
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }
    for (
      let index = start;
      index <= pool.length - (count - selected.length);
      index++
    ) {
      const item = pool[index] as ScoredCase;
      if (
        selected.some(
          (existing) => existing.achievementGroupId === item.achievementGroupId,
        )
      )
        continue;
      selected.push(item);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

type Quota = CompanyQuota;

/**
 * Past the search limit: each company's best distinct cases, then single
 * swaps that raise the set utility until none does. Deterministic, but not
 * guaranteed optimal; the selection carries a warning.
 */
function localSearch(
  ranked: ScoredCase[],
  quotas: Quota[],
  requirements: Requirement[],
  policy: RolePolicy,
) {
  let selected: ScoredCase[] = [];
  const used = new Set<string>();
  for (const quota of quotas) {
    let picked = 0;
    for (const item of ranked) {
      if (picked === quota.count) break;
      if (
        item.companyId !== quota.companyId ||
        used.has(item.achievementGroupId)
      )
        continue;
      selected.push(item);
      used.add(item.achievementGroupId);
      picked++;
    }
  }
  const utility = (set: ScoredCase[]) =>
    measureSet(set, requirements, policy.weights).utility;
  for (let round = 0; round < 1000; round++) {
    const current = utility(selected);
    let next: ScoredCase[] | null = null;
    search: for (const [index, out] of selected.entries())
      for (const candidate of ranked) {
        if (
          candidate.companyId !== out.companyId ||
          selected.includes(candidate) ||
          selected.some(
            (item, other) =>
              other !== index &&
              item.achievementGroupId === candidate.achievementGroupId,
          )
        )
          continue;
        const swapped = selected.map((item, other) =>
          other === index ? candidate : item,
        );
        if (utility(swapped) > current + 1e-10) {
          next = swapped;
          break search;
        }
      }
    if (!next) break;
    selected = next;
  }
  const rank = new Map(ranked.map((item, index) => [item.caseId, index]));
  const company = new Map(
    quotas.map((quota, index) => [quota.companyId, index]),
  );
  return selected.sort(
    (a, b) =>
      (company.get(a.companyId) ?? 0) - (company.get(b.companyId) ?? 0) ||
      (rank.get(a.caseId) ?? 0) - (rank.get(b.caseId) ?? 0),
  );
}

/**
 * The best set of bullets under the company quotas of the template. Every
 * feasible combination is enumerated (up to `searchLimit` sets): the set with
 * the highest utility wins, a tie goes to the lexicographically smaller set
 * of case ids. A company below its minimum makes the selection `needs_edit`.
 */
export function selectCases(
  profile: Profile,
  requirements: Requirement[],
  matches: Match[],
  policy: RolePolicy,
  searchLimit = 1_000_000,
): Selection {
  if (!Number.isSafeInteger(searchLimit) || searchLimit < 1)
    throw new Error("Invalid search limit");
  const grounded = groundMatches(matches, requirements, profile.bank.cases);
  const ranked = scoreCases(
    profile.bank.cases,
    requirements,
    grounded,
    policy.weights,
  );
  const eligible = new Set(ranked.map((item) => item.caseId));
  const usedMatches = grounded.filter((match) => eligible.has(match.caseId));
  const warnings: string[] = [];
  const quotas: Quota[] = companyQuotas(profile, policy.template).map(
    (quota) => {
      const available = new Set(
        ranked
          .filter((item) => item.companyId === quota.companyId)
          .map((item) => item.achievementGroupId),
      ).size;
      const count = Math.min(quota.target, available);
      if (count < quota.target)
        warnings.push(
          `${quota.companyId}: only ${count} distinct active achievements available for target ${quota.target}`,
        );
      return { ...quota, count };
    },
  );

  const result = (
    status: Selection["status"],
    selected: ScoredCase[],
    examinedSets: number,
  ): Selection => {
    const metrics = measureSet(selected, requirements, policy.weights);
    const ids = new Set(selected.map((item) => item.caseId));
    const coverage = requirements.map((requirement, index) => ({
      requirementId: requirement.id,
      best: Math.max(
        0,
        ...selected.map((item) => item.matches[index] ?? 0),
      ) as MatchValue,
      caseIds: selected
        .filter((item) => (item.matches[index] ?? 0) > 0)
        .map((item) => item.caseId),
    }));
    return {
      status,
      template: policy.template,
      role: policy.role,
      weights: policy.weights,
      selected: selected.map(({ caseId, companyId, score }) => ({
        caseId,
        companyId,
        score,
      })),
      ranked: ranked.map((item) => ({
        caseId: item.caseId,
        companyId: item.companyId,
        score: item.score,
        categoryFit: item.categoryFit,
        evidenceFit: item.evidenceFit,
        selected: ids.has(item.caseId),
      })),
      reqCoverage: metrics.requirementCoverage,
      catCoverage: metrics.categoryCoverage,
      utility: metrics.utility,
      warnings,
      quotas,
      coverage,
      matches: usedMatches,
      examinedSets,
    };
  };

  if (quotas.some((quota) => quota.count < quota.min)) {
    warnings.push(
      "Insufficient unique achievements for minimum company quotas",
    );
    return result("needs_edit", [], 0);
  }
  const pools = quotas.map((quota) =>
    ranked.filter((item) => item.companyId === quota.companyId),
  );
  let upperBound = 1;
  for (const [index, quota] of quotas.entries()) {
    const size = (pools[index] as ScoredCase[]).length;
    let choices = 1;
    for (let i = 1; i <= quota.count; i++)
      choices = (choices * (size - quota.count + i)) / i;
    upperBound *= Math.round(choices);
  }
  const options =
    upperBound <= searchLimit
      ? quotas.map((quota, index) =>
          combinations(pools[index] as ScoredCase[], quota.count),
        )
      : null;
  const product = options
    ? options.reduce((size, sets) => size * sets.length, 1)
    : Number.POSITIVE_INFINITY;
  if (!options || product > searchLimit) {
    warnings.push(
      `Selection search space exceeds ${searchLimit} sets: best cases per company improved by single swaps`,
    );
    const selected = localSearch(ranked, quotas, requirements, policy);
    return finish(result("ok", selected, 0), requirements);
  }

  // Full enumeration guarantees the optimum for this explicit objective,
  // rather than relying on the sum of independently ranked cases.
  // Kept in an object: the search closure updates it.
  const top = {
    set: null as ScoredCase[] | null,
    utility: Number.NEGATIVE_INFINITY,
    key: "",
  };
  let examinedSets = 0;
  const usedGroups = new Set<string>();
  const visit = (index: number, selected: ScoredCase[]) => {
    if (index < options.length) {
      for (const option of options[index] as ScoredCase[][]) {
        if (option.some((item) => usedGroups.has(item.achievementGroupId)))
          continue;
        for (const item of option) usedGroups.add(item.achievementGroupId);
        visit(index + 1, [...selected, ...option]);
        for (const item of option) usedGroups.delete(item.achievementGroupId);
      }
      return;
    }
    examinedSets++;
    const utility = measureSet(selected, requirements, policy.weights).utility;
    // The tie-break key is only needed when this set can replace the best one.
    if (top.set && utility < top.utility - 1e-10) return;
    const key = selected
      .map((item) => item.caseId)
      .sort()
      .join("|");
    if (
      !top.set ||
      utility > top.utility + 1e-10 ||
      (Math.abs(utility - top.utility) <= 1e-10 && key < top.key)
    ) {
      top.set = [...selected];
      top.utility = utility;
      top.key = key;
    }
  };
  visit(0, []);
  if (!top.set) {
    warnings.push("No feasible set without duplicate achievement groups");
    return result("needs_edit", [], examinedSets);
  }
  return finish(result("ok", top.set, examinedSets), requirements);
}

/** A selected set without evidence for some requirements says so. */
function finish(selection: Selection, requirements: Requirement[]) {
  const uncovered = selection.coverage
    .filter((item) => item.best === 0)
    .map((item) => item.requirementId);
  if (uncovered.length && requirements.length)
    selection.warnings.push(
      `Selected set has no evidence for: ${uncovered.join(", ")}`,
    );
  return selection;
}
