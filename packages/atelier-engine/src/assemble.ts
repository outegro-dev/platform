import type {
  BankCase,
  Profile,
  VacancyAnalysis,
} from "@outegro/contracts/atelier";
import {
  cvTitle,
  leadWord,
  roleTitle,
  spreadLeadWords,
  tenureYears,
  withTenure,
} from "./adaptation.js";
import { templateCompanies } from "./selection.js";
import { buildSkills, skillInventory } from "./skills.js";
import { unique, withoutLongDash, wordCount } from "./text.js";
import type {
  AboutTexts,
  ComposeOutput,
  CvDraft,
  DraftBullet,
  DraftCompany,
  Selection,
} from "./types.js";
import { bulletVariants } from "./variants.js";

/** Claim ids of a case that its text proves or that are its core: key claims and the metrics it states. */
export function evidentClaims(item: BankCase, text: string, claimed: string[]) {
  const lower = text.toLowerCase();
  const own = new Set(
    [...item.keyClaims, ...item.metricClaims].map((claim) => claim.id),
  );
  return unique([
    ...claimed.filter((id) => own.has(id)),
    ...item.keyClaims.map((claim) => claim.id),
    ...item.metricClaims
      .filter((metric) => lower.includes(metric.text.toLowerCase()))
      .map((metric) => metric.id),
  ]);
}

/** Requirements the analysis matched to a case (match > 0). */
export const supportedRequirements = (selection: Selection, caseId: string) =>
  unique(
    selection.matches
      .filter((match) => match.caseId === caseId && match.match > 0)
      .map((match) => match.requirementId),
  );

/** About with the vacancy's tenure, no long dashes, and a compact form never longer than the full one. */
export function adaptAbout(about: AboutTexts, years: number): AboutTexts {
  const section = (value: { full: string; compact: string }) => {
    const full = withoutLongDash(withTenure(value.full.trim(), years));
    const compact = withoutLongDash(withTenure(value.compact.trim(), years));
    return {
      full,
      compact: wordCount(compact) > wordCount(full) ? full : compact,
    };
  };
  return { profile: section(about.profile), aiTools: section(about.aiTools) };
}

/** The profile's own About with the vacancy's tenure: the fallback of every About part. */
export const ownAbout = (profile: Profile, years: number) =>
  adaptAbout(profile.summary, years);

/** A selected case in the bank's own words. */
export function bankBullet(
  item: BankCase,
  requirementIds: string[],
): DraftBullet {
  return {
    id: item.id,
    caseId: item.id,
    companyId: item.companyId,
    source: "bank",
    variants: { ...item.variants },
    bank: { ...item.variants },
    requirementIds,
    retainedClaimIds: [...item.keyClaims, ...item.metricClaims].map(
      (claim) => claim.id,
    ),
  };
}

/**
 * The adapted CV before fitting. The model wrote the About and one full text
 * per selected case (plus new bullets in free mode); code sets everything
 * else: the title from cvRole and the vacancy's technologies, the tenure,
 * the skill rows, the companies, their fixed bullets and the bullet order
 * (selection order, neighbours never opening with the same word). Shorter
 * forms come from the bank unless the full text left the bank's meaning.
 */
export function assembleCv(
  profile: Profile,
  analysis: VacancyAnalysis,
  selection: Selection,
  compose: ComposeOutput,
): CvDraft {
  if (selection.status !== "ok")
    throw new Error("Cannot assemble a CV from a needs_edit selection");
  const requirements = analysis.requirements;
  const requirementIds = new Set(requirements.map((item) => item.id));
  const must = new Set(
    requirements
      .filter((item) => item.importance === "must")
      .map((item) => item.id),
  );
  const template = selection.template;
  const years = tenureYears(requirements, profile.baseYears);
  const changes = compose.changeNotes
    .map((note) => withoutLongDash(note.trim()))
    .filter(Boolean);

  const _inventory = skillInventory(profile);
  const role = roleTitle(analysis.cvRole) ?? profile.headline;
  // The template prints the core stack at the right of the headline, so the
  // headline is the role alone, as on the master CV.
  const title = withoutLongDash(cvTitle(role, []));
  changes.push(`Title set to "${title}" from the vacancy role.`);
  if (years > profile.baseYears)
    changes.push(`Tenure raised to ${years}+ years, as the vacancy requires.`);

  const skills = buildSkills(profile, requirements, profile.factsMode);
  const baseKeys = new Set(
    profile.skills.flatMap((row) =>
      row.items.map((item) => item.toLowerCase()),
    ),
  );
  const added = skills.technologies.filter(
    (value) => !baseKeys.has(value.toLowerCase()),
  );
  if (added.length)
    changes.push(`Skills name the vacancy's ${added.join(", ")}.`);

  const quotas = new Map(
    selection.quotas.map((quota) => [quota.companyId, quota]),
  );
  const composed = new Map(
    compose.bullets.map((bullet) => [bullet.caseId, bullet]),
  );
  const cases = new Map(profile.bank.cases.map((item) => [item.id, item]));
  let newCount = 0;
  let fixedCount = 0;
  const companies: DraftCompany[] = templateCompanies(profile, template).map(
    (company) => {
      const quota = quotas.get(company.id);
      let bullets: DraftBullet[] = [];
      if (!quota) {
        bullets = company.fixedBullets.map((text) => {
          const clean = withoutLongDash(text);
          return {
            id: `fixed-${++fixedCount}`,
            caseId: null,
            companyId: company.id,
            source: "fixed" as const,
            variants: { full: clean, compact: clean, minimal: clean },
            bank: null,
            requirementIds: [],
            retainedClaimIds: [],
          };
        });
      } else {
        for (const selected of selection.selected) {
          if (selected.companyId !== company.id) continue;
          const item = cases.get(selected.caseId);
          if (!item) continue;
          const supported = supportedRequirements(selection, item.id);
          const bullet = composed.get(item.id);
          if (!bullet) {
            changes.push(
              `${item.id}: the bank's wording (the composition did not adapt it).`,
            );
            bullets.push(bankBullet(item, supported));
            continue;
          }
          const full = withoutLongDash(bullet.full.trim());
          bullets.push({
            id: item.id,
            caseId: item.id,
            companyId: company.id,
            source: "model",
            variants: bulletVariants(full, item.variants),
            bank: { ...item.variants },
            requirementIds: bullet.requirementIds.filter((id) =>
              supported.includes(id),
            ),
            retainedClaimIds: evidentClaims(
              item,
              full,
              bullet.retainedClaimIds,
            ),
          });
        }
        if (profile.factsMode === "free") {
          const extra = compose.newBullets
            .filter(
              (bullet) => bullet.companyId === company.id && bullet.text.trim(),
            )
            .slice(0, 2)
            .map((bullet): DraftBullet => {
              const full = withoutLongDash(bullet.text.trim());
              return {
                id: `new-${++newCount}`,
                caseId: null,
                companyId: company.id,
                source: "new",
                variants: bulletVariants(full, null),
                bank: null,
                requirementIds: unique(
                  bullet.requirementIds.filter((id) => requirementIds.has(id)),
                ),
                retainedClaimIds: [],
              };
            });
          // A new bullet for a must requirement goes right after the company's strongest case.
          for (const bullet of extra) {
            const at = bullet.requirementIds.some((id) => must.has(id))
              ? Math.min(1, bullets.length)
              : bullets.length;
            bullets.splice(at, 0, bullet);
          }
          if (extra.length)
            changes.push(
              `${company.name}: ${extra.length} new bullet${extra.length > 1 ? "s" : ""} for the vacancy.`,
            );
        }
        bullets = spreadLeadWords(bullets, (bullet) =>
          leadWord(bullet.variants.full),
        );
      }
      return {
        companyId: company.id,
        name: company.name,
        title: company.title,
        dates: company.dates,
        location: company.location,
        description: company.description,
        min: quota?.min ?? 0,
        bullets,
      };
    },
  );

  const selectedIds = new Set(selection.selected.map((item) => item.caseId));
  return {
    template,
    factsMode: profile.factsMode,
    maxPages: profile.maxPages ?? 2,
    title,
    years,
    about: adaptAbout(compose.about, years),
    skills: skills.rows,
    companies,
    technologies: skills.technologies,
    changes,
    fit: {
      requirements: requirements.map(({ id, importance, technologyTags }) => ({
        id,
        importance,
        technologyTags,
      })),
      weights: selection.weights,
      cases: selection.selected.flatMap((selected) => {
        const item = cases.get(selected.caseId);
        return item
          ? [
              {
                caseId: item.id,
                companyId: item.companyId,
                projectId: item.projectId,
                primaryTheme: item.primaryTheme,
                achievementGroupId: item.achievementGroupId,
                ratings: item.categoryRatings,
              },
            ]
          : [];
      }),
      matches: selection.matches.filter((match) =>
        selectedIds.has(match.caseId),
      ),
    },
  };
}
