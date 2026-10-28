import {
  type CategoryId,
  categoryIds,
  type Requirement,
} from "@outegro/contracts/atelier";
import type { RolePolicy, RoleProfile } from "./types.js";

/** Category priorities of each role (06_ROLE_PRIORITY_MAP of Work Finder). */
export const rolePriorities: Record<RoleProfile, Record<CategoryId, number>> = {
  frontend: {
    FE: 24,
    BE: 4,
    AR: 8,
    RE: 6,
    PF: 10,
    QA: 8,
    SE: 4,
    OW: 8,
    EE: 8,
    CO: 5,
    UX: 13,
    AI: 2,
  },
  backend: {
    FE: 3,
    BE: 24,
    AR: 13,
    RE: 13,
    PF: 8,
    QA: 8,
    SE: 10,
    OW: 8,
    EE: 7,
    CO: 4,
    UX: 1,
    AI: 1,
  },
  fullstack: {
    FE: 16,
    BE: 16,
    AR: 10,
    RE: 8,
    PF: 6,
    QA: 8,
    SE: 5,
    OW: 10,
    EE: 12,
    CO: 5,
    UX: 3,
    AI: 1,
  },
  ai: {
    FE: 8,
    BE: 12,
    AR: 10,
    RE: 10,
    PF: 4,
    QA: 8,
    SE: 5,
    OW: 8,
    EE: 10,
    CO: 3,
    UX: 2,
    AI: 20,
  },
};

export const requirementImportance = {
  must: 3,
  responsibility: 2,
  preferred: 1,
} as const;

/** Building AI into the product, as opposed to coding with AI tools. */
const aiProductPattern =
  /\b(rag|llm|agents?|inference|tool calling|model integration|ai features?|ai products?)\b|(?:разработка|интеграция)\s+(?:ии|агентов)|генеративн|нейросет/i;

/**
 * Role and template of a vacancy. The AI template is chosen only when a core
 * (not preferred) AI requirement is about building AI product capabilities;
 * AI tooling for the developer alone is not evidence of an AI product role.
 * Then the title decides, then the demand: FE ≥ 2·BE → frontend, BE ≥ 2·FE →
 * backend, else fullstack. Weights blend the role's priorities (60%) with
 * the vacancy's own category signal (40%).
 */
export function rolePolicy(
  requirements: Requirement[],
  title: string,
): RolePolicy {
  const core = requirements.filter((item) => item.importance !== "preferred");
  const demand = (category: CategoryId) =>
    core.filter((item) => item.categoryIds.includes(category)).length;
  const aiProduct = core.some(
    (item) =>
      item.categoryIds.includes("AI") &&
      aiProductPattern.test(`${item.text} ${item.evidenceQuote}`),
  );
  const frontend = /front[ -]?end|фронтенд/i.test(title);
  const backend = /back[ -]?end|бэкенд/i.test(title);
  const fullstack = /full[ -]?stack|фуллстек/i.test(title);
  const role: RoleProfile = aiProduct
    ? "ai"
    : fullstack
      ? "fullstack"
      : frontend && !backend
        ? "frontend"
        : backend && !frontend
          ? "backend"
          : demand("FE") >= 2 * demand("BE") && demand("FE") > 0
            ? "frontend"
            : demand("BE") >= 2 * demand("FE") && demand("BE") > 0
              ? "backend"
              : "fullstack";
  const signals = Object.fromEntries(
    categoryIds.map((id) => [id, 0]),
  ) as Record<CategoryId, number>;
  for (const item of requirements)
    for (const id of item.categoryIds)
      signals[id] +=
        requirementImportance[item.importance] / item.categoryIds.length;
  const total = Object.values(signals).reduce((a, b) => a + b, 0);
  const priorities = rolePriorities[role];
  const priorTotal = Object.values(priorities).reduce((a, b) => a + b, 0);
  const weights = Object.fromEntries(
    categoryIds.map((id) => [
      id,
      total
        ? (0.6 * priorities[id]) / priorTotal + (0.4 * signals[id]) / total
        : priorities[id] / priorTotal,
    ]),
  ) as Record<CategoryId, number>;
  return { role, template: aiProduct ? "ai" : "general", weights };
}
