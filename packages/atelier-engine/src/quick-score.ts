import type {
  Profile,
  VacancyFields,
  VacancyStructure,
} from "@outegro/contracts/atelier";
import { skillInventory } from "./skills.js";
import { skillKey, technologyKind } from "./technologies.js";

type Focus = VacancyStructure["roleFocus"];

/** The profile's own focus: its headline, else the balance of its cases' frontend and backend ratings. */
export function profileFocus(profile: Profile): Focus {
  const headline = profile.headline;
  if (/full[ -]?stack/i.test(headline)) return "fullstack";
  if (/\bai\b|\bml\b|llm/i.test(headline)) return "ai";
  if (/front[ -]?end/i.test(headline)) return "frontend";
  if (/back[ -]?end/i.test(headline)) return "backend";
  if (/mobile|ios|android/i.test(headline)) return "mobile";
  let fe = 0;
  let be = 0;
  for (const item of profile.bank.cases)
    if (item.active) {
      fe += item.categoryRatings.FE;
      be += item.categoryRatings.BE;
    }
  if (fe >= 2 * be && fe > 0) return "frontend";
  if (be >= 2 * fe && be > 0) return "backend";
  return fe + be > 0 ? "fullstack" : "other";
}

/**
 * Level-2 fit of a vacancy without a model, 0–100: technologies the profile
 * has (60), role focus (20), seniority and years (10), remote (10), minus 15
 * per required human language the profile lacks. Decides which vacancies
 * are worth an analysis call.
 */
export function quickScore(
  profile: Profile,
  structure: VacancyStructure,
  fields: VacancyFields,
): { score: number; covered: string[]; missing: string[]; reasons: string[] } {
  const reasons: string[] = [];
  const inventory = skillInventory(profile);
  const seen = new Set<string>();
  const technologies = structure.technologies.filter((value) => {
    const key = skillKey(value);
    if (!value.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const covered = technologies.filter((value) =>
    inventory.has(skillKey(value)),
  );
  const missing = technologies.filter(
    (value) => !inventory.has(skillKey(value)),
  );
  const tech = technologies.length
    ? (60 * covered.length) / technologies.length
    : 30;
  reasons.push(
    technologies.length
      ? `${covered.length} of ${technologies.length} technologies are in the profile`
      : "The text names no known technologies",
  );

  const focus = profileFocus(profile);
  const wanted = structure.roleFocus;
  const aiCases = profile.bank.cases.some(
    (item) => item.active && item.categoryRatings.AI >= 3,
  );
  const mobile = [...inventory.values()].some(
    (value) => technologyKind(value) === "mobile",
  );
  const role =
    wanted === focus
      ? 20
      : wanted === "ai"
        ? aiCases
          ? 16
          : 6
        : wanted === "mobile"
          ? mobile
            ? 14
            : 4
          : focus === "fullstack" &&
              (wanted === "frontend" || wanted === "backend")
            ? 16
            : wanted === "fullstack" &&
                (focus === "frontend" || focus === "backend")
              ? 12
              : wanted === "other"
                ? 10
                : 6;
  reasons.push(`Role focus ${wanted}, profile ${focus}`);

  const years = profile.baseYears;
  let seniority =
    structure.seniority === "junior"
      ? years >= 4
        ? 3
        : 10
      : structure.seniority === "lead"
        ? years >= 7
          ? 8
          : 5
        : structure.seniority === "senior"
          ? years >= 5
            ? 10
            : 5
          : structure.seniority === "middle"
            ? 9
            : 8;
  if (structure.yearsMin !== null && structure.yearsMin > years) {
    seniority = structure.yearsMin > years + 2 ? 0 : Math.min(seniority, 5);
    reasons.push(
      `Asks for ${structure.yearsMin}+ years, the profile has ${years}`,
    );
  }
  if (structure.seniority === "junior" && years >= 4)
    reasons.push("A junior role for an experienced profile");

  const remote = structure.remote ?? fields.remote;
  const wantsRemote = /remote/i.test(profile.form.workFormat);
  const place =
    remote === true
      ? 10
      : remote === null
        ? 5
        : wantsRemote
          ? profile.form.relocation
            ? 3
            : 0
          : 8;
  if (remote === false && wantsRemote) reasons.push("Not remote");

  const spoken = profile.languages.map((item) => item.name.toLowerCase());
  const lacking = structure.languages.filter(
    (language) =>
      !spoken.some(
        (name) =>
          name.includes(language.toLowerCase()) ||
          language.toLowerCase().includes(name),
      ),
  );
  if (lacking.length) reasons.push(`Requires ${lacking.join(", ")}`);
  const penalty = Math.min(30, 15 * lacking.length);

  const score = Math.max(
    0,
    Math.min(100, Math.round(tech + role + seniority + place - penalty)),
  );
  return { score, covered, missing, reasons };
}
