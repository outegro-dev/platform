import type {
  CategoryId,
  Profile,
  Requirement,
} from "@outegro/contracts/atelier";
import {
  labelKinds,
  skillKey,
  type TechnologyKind,
  technologyKind,
} from "./technologies.js";
import { mentions } from "./text.js";
import type { DraftSkillRow, FactsMode, SkillItem } from "./types.js";

/**
 * "Label: items" characters that fit one skills line of the two-page
 * template (the longest master line is 128); renders confirm it and fitting
 * drops one more item from a row that still wraps.
 */
export const skillLineBudget = 128;

/** Highest priorities first; lower ones are left out only when the line would not fit, plus measured drops. */
export function skillLine(label: string, values: string[], drops = 0) {
  const kept: string[] = [];
  for (const value of values) {
    if (
      kept.length &&
      `${label}: ${[...kept, value].join(", ")}`.length > skillLineBudget
    )
      break;
    kept.push(value);
  }
  return kept.slice(0, Math.max(1, kept.length - drops));
}

/** Items of a row in print order: priority, then their place in the row. */
export const sortedItems = (row: DraftSkillRow) =>
  row.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.priority - a.item.priority || a.index - b.index)
    .map(({ item }) => item);

/**
 * Every technology the profile can claim, by skill key: its skill rows and the
 * technologies of its active cases, in their own spelling.
 */
export function skillInventory(profile: Profile) {
  const inventory = new Map<string, string>();
  for (const row of profile.skills)
    for (const item of row.items)
      if (!inventory.has(skillKey(item))) inventory.set(skillKey(item), item);
  for (const item of profile.bank.cases)
    if (item.active)
      for (const technology of item.technologies)
        if (!inventory.has(skillKey(technology)))
          inventory.set(skillKey(technology), technology);
  return inventory;
}

const tagPriority = { must: 95, responsibility: 85, preferred: 75 } as const;

/** One vacancy technology: its spelling, its strongest importance and the requirements naming it. */
export type VacancyTechnology = {
  value: string;
  key: string;
  priority: number;
  requirementIds: string[];
  categoryIds: CategoryId[];
};

/** Technology tags of the requirements, merged by skill key, the most important first. */
export function vacancyTechnologies(requirements: Requirement[]) {
  const byKey = new Map<string, VacancyTechnology & { order: number }>();
  for (const requirement of requirements)
    for (const tag of requirement.technologyTags) {
      const value = tag.trim();
      if (!value) continue;
      const key = skillKey(value);
      const entry = byKey.get(key) ?? {
        value,
        key,
        priority: 0,
        requirementIds: [],
        categoryIds: [],
        order: byKey.size,
      };
      entry.priority = Math.max(
        entry.priority,
        tagPriority[requirement.importance],
      );
      if (!entry.requirementIds.includes(requirement.id))
        entry.requirementIds.push(requirement.id);
      for (const id of requirement.categoryIds)
        if (!entry.categoryIds.includes(id)) entry.categoryIds.push(id);
      byKey.set(key, entry);
    }
  return [...byKey.values()]
    .sort((a, b) => b.priority - a.priority || a.order - b.order)
    .map(({ order: _, ...item }) => item);
}

/** Where a technology of each kind goes when no row names its kind. */
const kindFallback: Record<TechnologyKind, TechnologyKind[]> = {
  language: ["language", "backend", "frontend"],
  frontend: ["frontend"],
  mobile: ["mobile", "frontend"],
  backend: ["backend"],
  data: ["data", "backend"],
  cloud: ["cloud", "backend"],
  ai: ["ai", "tools", "backend"],
  testing: ["testing", "tools"],
  tools: ["tools", "ai", "testing"],
};

/** Requirement categories that point to a row kind. */
const categoryKind: Partial<Record<CategoryId, TechnologyKind>> = {
  FE: "frontend",
  UX: "frontend",
  BE: "backend",
  AR: "backend",
  SE: "backend",
  RE: "cloud",
  PF: "cloud",
  QA: "testing",
  AI: "ai",
};

/** The row a new technology joins: by its kind (label first, then the row's items), else by its requirements' categories. */
function rowFor(
  rows: DraftSkillRow[],
  technology: VacancyTechnology,
): number | null {
  const rowKinds = rows.map((row) => {
    const named = labelKinds(row.label);
    const items = row.items
      .map((item) => technologyKind(item.value))
      .filter((kind): kind is TechnologyKind => kind !== null);
    return { named, items };
  });
  const find = (kinds: TechnologyKind[]) => {
    for (const kind of kinds) {
      const byLabel = rowKinds.findIndex((row) => row.named.includes(kind));
      if (byLabel >= 0) return byLabel;
    }
    for (const kind of kinds) {
      let bestRow = -1;
      let bestCount = 0;
      rowKinds.forEach((row, index) => {
        const count = row.items.filter((item) => item === kind).length;
        if (count > bestCount) {
          bestRow = index;
          bestCount = count;
        }
      });
      if (bestRow >= 0) return bestRow;
    }
    return null;
  };
  const kind = technologyKind(technology.value);
  if (kind) {
    const row = find(kindFallback[kind]);
    if (row !== null) return row;
  }
  const kinds = technology.categoryIds
    .map((id) => categoryKind[id])
    .filter((value): value is TechnologyKind => value !== undefined);
  return kinds.length ? find(kinds) : null;
}

/**
 * Skill rows of the CV: the profile's own rows and labels, every base item
 * kept, vacancy technologies added in the vacancy's spelling and ordered by
 * requirement importance (rules 02 §6, §11). Strict mode adds only what the
 * profile can claim (skill rows and case technologies); free mode also adds
 * any technology the dictionary knows, in the row of its kind. A base item
 * named again by the vacancy takes the vacancy's spelling and is never added
 * twice. A row holds at most its base items plus 20 (30 in all).
 */
export function buildSkills(
  profile: Profile,
  requirements: Requirement[],
  factsMode: FactsMode,
): { rows: DraftSkillRow[]; technologies: string[]; skipped: string[] } {
  const inventory = skillInventory(profile);
  const quoted = requirements.flatMap((item) => [
    item.text,
    item.evidenceQuote,
  ]);
  const rows: DraftSkillRow[] = profile.skills.map((row) => ({
    label: row.label,
    items: row.items.map((value) => ({
      value,
      // A base item the requirements name in their text ranks above the rest.
      priority: quoted.some((text) => mentions(text, value)) ? 70 : 50,
      requirementIds: [],
    })),
  }));
  const technologies: string[] = [];
  const skipped: string[] = [];
  for (const technology of vacancyTechnologies(requirements)) {
    const known =
      inventory.has(technology.key) ||
      (factsMode === "free" && technologyKind(technology.value) !== null);
    if (!known) {
      skipped.push(technology.value);
      continue;
    }
    const item: SkillItem = {
      value: technology.value,
      priority: technology.priority,
      requirementIds: technology.requirementIds,
    };
    let placed = false;
    for (const row of rows)
      for (const [index, existing] of row.items.entries())
        if (skillKey(existing.value) === technology.key) {
          row.items[index] = { ...item };
          placed = true;
        }
    if (!placed) {
      const index = rowFor(rows, technology);
      if (index === null) {
        skipped.push(technology.value);
        continue;
      }
      (rows[index] as DraftSkillRow).items.push(item);
    }
    technologies.push(technology.value);
  }
  const limited = rows.map((row, index) => {
    const base = profile.skills[index]?.items.length ?? 0;
    const limit = Math.min(30, base + 20);
    const sorted = sortedItems(row);
    return { label: row.label, items: sorted.slice(0, limit) };
  });
  return { rows: limited, technologies, skipped };
}
