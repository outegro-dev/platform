import type { CvRole, Requirement } from "@outegro/contracts/atelier";

// "7+ years", "5-7 years" (the lower bound), "от 5 лет"; a figure above 15 is a misread, not a requirement.
const yearsPattern =
  /(?<![\d.])(\d{1,2})(?:\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?|лет|года?)(?!\p{L})/giu;

/**
 * Years of commercial experience the CV states: the profile's base tenure,
 * or more when a core (not preferred) requirement asks for more.
 */
export function tenureYears(
  requirements: Pick<Requirement, "importance" | "text" | "evidenceQuote">[],
  baseYears: number,
) {
  let years = baseYears;
  for (const requirement of requirements) {
    if (requirement.importance === "preferred") continue;
    for (const text of [requirement.text, requirement.evidenceQuote])
      for (const match of text.matchAll(yearsPattern)) {
        const value = Number(match[1]);
        if (value <= 15) years = Math.max(years, value);
      }
  }
  return years;
}

/** Every "N+ years" in a text states the tenure the vacancy needs. */
export const withTenure = (text: string, years: number) =>
  text.replace(/(?<![\d.])\d{1,2}\+(?=\s*(?:years?|yrs?)\b)/gi, `${years}+`);

/** The CV role from the vacancy's cvRole, e.g. "Senior Backend Engineer". */
export const roleTitle = (role: CvRole | null) =>
  role ? `${role.senior ? "Senior " : ""}${role.focus} ${role.noun}` : null;

// A long role with technologies would wrap the header line.
export const titleLimit = 64;

/**
 * The CV title: the role, then " | " and up to three technologies while the
 * whole line stays within 64 characters (fewer technologies otherwise).
 */
export function cvTitle(role: string, technologies: string[]) {
  for (let count = Math.min(3, technologies.length); count > 0; count--) {
    const full = `${role} | ${technologies.slice(0, count).join(" / ")}`;
    if (full.length <= titleLimit) return full;
  }
  return role;
}

export const leadWord = (text: string) =>
  (text.replace(/\*\*/g, "").trim().split(/\s+/)[0] ?? "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");

/**
 * One company's bullets keep their order, except that two neighbours never
 * open with the same word ("Built …", "Built …"): the next bullet that opens
 * differently moves up. Repeats remain only when nothing else is left.
 */
export function spreadLeadWords<T>(items: T[], lead: (item: T) => string): T[] {
  const rest = [...items];
  const result: T[] = [];
  while (rest.length) {
    const last = result.at(-1);
    const previous = last === undefined ? null : lead(last);
    const index = rest.findIndex((item) => lead(item) !== previous);
    result.push(...rest.splice(Math.max(index, 0), 1));
  }
  return result;
}
