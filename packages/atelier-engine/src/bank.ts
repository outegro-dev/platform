import type { Profile } from "@outegro/contracts/atelier";
import { numbers, rawText } from "./text.js";

const variantLimit = 600;

/** The letters a case id starts with: `P` for P12. */
const prefixOf = (id: string) => id.match(/^[A-Z]+/)?.[0] ?? "";

/**
 * Integrity rules of the achievement bank (profile/domain/bank.ts of Work
 * Finder), as messages; an empty list means the bank is valid. Each company
 * has one id prefix, taken from the bank itself (the prefix most of its
 * cases use), and no two companies share one.
 */
export function validateBank(profile: Profile): string[] {
  const errors: string[] = [];
  const cases = profile.bank.cases;
  const duplicates = (values: string[], label: string) => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const value of values) (seen.has(value) ? repeated : seen).add(value);
    if (repeated.size)
      errors.push(`Duplicate ${label}: ${[...repeated].join(", ")}`);
  };
  duplicates(
    profile.companies.map((company) => company.id),
    "company IDs",
  );
  duplicates(
    cases.map((item) => item.id),
    "case IDs",
  );
  duplicates(
    cases.flatMap((item) =>
      [...item.capabilities, ...item.keyClaims, ...item.metricClaims].map(
        (claim) => claim.id,
      ),
    ),
    "claim/capability IDs",
  );

  const companies = new Set(profile.companies.map((company) => company.id));
  const prefixes = new Map<string, string>();
  for (const companyId of new Set(cases.map((item) => item.companyId))) {
    const counts = new Map<string, number>();
    for (const item of cases)
      if (item.companyId === companyId)
        counts.set(prefixOf(item.id), (counts.get(prefixOf(item.id)) ?? 0) + 1);
    const [prefix] = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0] ?? [""];
    prefixes.set(companyId, prefix);
  }
  const owners = new Map<string, string>();
  for (const [companyId, prefix] of prefixes) {
    const other = owners.get(prefix);
    if (other)
      errors.push(
        `Companies ${other} and ${companyId} share the case ID prefix ${prefix}`,
      );
    else owners.set(prefix, companyId);
  }

  for (const company of profile.companies)
    for (const template of ["general", "ai"] as const) {
      const quota = company.quota[template];
      if (quota.min > quota.target)
        errors.push(
          `${company.id}: ${template} quota minimum ${quota.min} exceeds its target ${quota.target}`,
        );
    }

  for (const item of cases) {
    if (!companies.has(item.companyId))
      errors.push(`${item.id}: unknown company ${item.companyId}`);
    if (prefixOf(item.id) !== prefixes.get(item.companyId))
      errors.push(
        `${item.id}: company mismatch (${item.companyId} cases start with ${prefixes.get(item.companyId)})`,
      );
    const scores = Object.values(item.categoryRatings);
    if (
      scores.filter((x) => x === 5).length > 2 ||
      scores.filter((x) => x >= 4).length > 4
    )
      errors.push(
        `${item.id}: inflated ratings (at most two 5s and four ratings of 4+)`,
      );
    for (const part of [
      ...item.capabilities,
      ...item.keyClaims,
      ...item.metricClaims,
    ])
      if (!part.id.startsWith(`${item.id}:`))
        errors.push(`${item.id}: foreign claim/capability ID ${part.id}`);
    const variants = [
      item.variants.full,
      item.variants.compact,
      item.variants.minimal,
    ];
    // Digits inside a word (B2B, K8s, S3) name things; they are not quantities.
    const fullNumbers = JSON.stringify(numbers(item.variants.full));
    if (
      variants.some(
        (variant) => JSON.stringify(numbers(variant)) !== fullNumbers,
      )
    )
      errors.push(`${item.id}: numerical claims changed between variants`);
    for (const metric of item.metricClaims)
      if (
        variants.some(
          (variant) =>
            !variant.toLowerCase().includes(metric.text.toLowerCase()),
        )
      )
        errors.push(`${item.id}: metric '${metric.text}' lost in a variant`);
    if (
      variants.some(
        (variant) => !variant.trim().endsWith(".") || rawText(variant),
      )
    )
      errors.push(`${item.id}: incomplete or raw LaTeX variant`);
    if (variants.some((variant) => variant.length > variantLimit))
      errors.push(
        `${item.id}: a variant is longer than ${variantLimit} characters`,
      );
    const words = variants.map((variant) => variant.trim().split(/\s+/).length);
    if ((words[1] ?? 0) > (words[0] ?? 0) || (words[2] ?? 0) > (words[1] ?? 0))
      errors.push(`${item.id}: variants do not shorten progressively`);
  }
  for (const company of profile.companies) {
    const active = cases.filter(
      (item) => item.companyId === company.id && item.active,
    ).length;
    for (const template of ["general", "ai"] as const)
      if (
        company.quota[template].target > 0 &&
        active === 0 &&
        !(template === "general" && company.aiOnly)
      )
        errors.push(
          `${company.id}: ${template} quota ${company.quota[template].target} but no active cases`,
        );
  }
  return errors;
}
