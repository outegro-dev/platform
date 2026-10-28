import type { BankCase, Requirement } from "@outegro/contracts/atelier";
import { eligibleFor } from "./scoring.js";
import { skillKey } from "./technologies.js";

/**
 * Cases worth sending to the match call: active, eligible for this vacancy
 * (whenVacancyMentions) and either sharing a technology with a requirement
 * or rated 4+ in a category of a core (must or responsibility) requirement.
 * A case left out still competes in selection by its ratings; it only gets
 * no evidence. When nothing passes, every eligible case goes.
 */
export function prefilterCases(
  cases: BankCase[],
  requirements: Requirement[],
): BankCase[] {
  const eligible = cases.filter(
    (item) => item.active && eligibleFor(item, requirements),
  );
  const tags = new Set(
    requirements.flatMap((requirement) =>
      requirement.technologyTags.map(skillKey),
    ),
  );
  const core = requirements.filter((item) => item.importance !== "preferred");
  const kept = eligible.filter(
    (item) =>
      item.technologies.some((technology) => tags.has(skillKey(technology))) ||
      core.some((requirement) =>
        requirement.categoryIds.some((id) => item.categoryRatings[id] >= 4),
      ),
  );
  return kept.length ? kept : eligible;
}
