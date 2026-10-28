import type { Requirement } from "@outegro/contracts/atelier";
import { skillKey, spellings } from "./technologies.js";
import { mentions } from "./text.js";

/**
 * Share of the must requirements' technologies an ATS finds in the PDF text
 * (pdftotext output). Any spelling of a technology counts (K8s for
 * Kubernetes); missing terms keep the vacancy's spelling. Without must
 * technologies the coverage is 1.
 */
export function atsCoverage(
  pdfText: string,
  requirements: Requirement[],
): { coverage: number; missingTerms: string[] } {
  const terms = new Map<string, string>();
  for (const requirement of requirements)
    if (requirement.importance === "must")
      for (const tag of requirement.technologyTags) {
        const value = tag.trim();
        if (value && !terms.has(skillKey(value)))
          terms.set(skillKey(value), value);
      }
  if (!terms.size) return { coverage: 1, missingTerms: [] };
  // Ligature-free reading: pdftotext may keep "ﬁ"; NFKC turns it into "fi".
  const text = pdfText.normalize("NFKC").replace(/\s+/g, " ");
  const missingTerms = [...terms.values()].filter(
    (term) => !spellings(term).some((spelling) => mentions(text, spelling)),
  );
  return {
    coverage: (terms.size - missingTerms.length) / terms.size,
    missingTerms,
  };
}
