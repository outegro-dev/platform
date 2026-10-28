import type { Profile } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { assembleCv, supportedRequirements } from "./assemble.js";
import {
  analysisOf,
  caseById,
  defined,
  profile,
  req,
} from "./fixtures/profile.js";
import { draftIssues, partRules } from "./part-rules.js";
import { composePrompt } from "./prompts/compose.js";
import { repairPrompt, reviewPrompt } from "./prompts/review.js";
import {
  applyRepair,
  flaggedParts,
  repairScope,
  sourceFallback,
} from "./review.js";
import { rolePolicy } from "./role-policy.js";
import { selectCases } from "./selection.js";
import type {
  ComposeOutput,
  CvDraft,
  DraftBullet,
  Finding,
  Match,
  Selection,
} from "./types.js";
import {
  bulletVariants,
  keepsBankMeaning,
  shortenSentence,
} from "./variants.js";

const requirements = [
  req("R1", "Strong React interfaces", ["FE"], "must", ["React"]),
  req(
    "R2",
    "Server-rendered catalogs with Next.js",
    ["FE", "PF"],
    "responsibility",
    ["Next.js"],
  ),
  req("R3", "7+ years of experience", ["OW"]),
];
const analysis = analysisOf(requirements);
const matches: Match[] = [
  { requirementId: "R1", caseId: "N5", match: 1, evidenceRefs: ["N5:core"] },
  { requirementId: "R2", caseId: "N6", match: 1, evidenceRefs: ["N6:core"] },
  {
    requirementId: "R1",
    caseId: "L4",
    match: 0.5,
    evidenceRefs: ["L4:delivery"],
  },
];
const selectionFor = (base: Profile = profile): Selection =>
  selectCases(
    base,
    requirements,
    matches,
    rolePolicy(requirements, analysis.title),
  );
const selection = selectionFor();

/** A composition that keeps the bank's words, as a well-behaved model would for this fixture. */
const composed = (over: Partial<ComposeOutput> = {}): ComposeOutput => ({
  about: {
    profile: {
      full: "Senior frontend engineer with 5+ years of commercial experience building e-commerce and CRM products in React and TypeScript, focused on dependable interfaces.",
      compact:
        "Senior frontend engineer with 5+ years of commercial experience in React products.",
    },
    aiTools: { ...profile.summary.aiTools },
  },
  bullets: selection.selected.map((item) => ({
    caseId: item.caseId,
    full: caseById(item.caseId).variants.full,
    requirementIds: supportedRequirements(selection, item.caseId),
    retainedClaimIds: [],
  })),
  newBullets: [],
  changeNotes: ["Frontend work first."],
  ...over,
});
const free: Profile = { ...profile, factsMode: "free" };
const bulletOf = (draft: CvDraft, id: string) =>
  draft.companies
    .flatMap((company) => company.bullets)
    .find((bullet) => bullet.id === id) as DraftBullet;
const withBullet = (id: string, full: string) =>
  composed({
    bullets: composed().bullets.map((bullet) =>
      bullet.caseId === id ? { ...bullet, full } : bullet,
    ),
  });

describe("assembleCv", () => {
  it("builds title, tenure, companies in profile order, fixed bullets and fit metadata", () => {
    const draft = assembleCv(profile, analysis, selection, composed());
    expect(draft.title).toBe("Senior Frontend Engineer");
    expect(draft.years).toBe(7);
    expect(draft.about.profile.full).toContain(
      "7+ years of commercial experience",
    );
    expect(
      draft.companies.map((company) => [
        company.companyId,
        company.bullets.length,
      ]),
    ).toEqual([
      ["northwind", 6],
      ["lumen", 4],
      ["cargo", 4],
      ["oldtown", 1],
    ]);
    expect(draft.companies.at(-1)?.bullets[0]).toMatchObject({
      id: "fixed-1",
      source: "fixed",
      caseId: null,
    });
    expect(draft.companies.map((company) => company.min)).toEqual([5, 4, 3, 0]);
    expect(draft.fit.cases).toHaveLength(14);
    expect(
      draft.fit.matches.every((match) =>
        draft.fit.cases.some((item) => item.caseId === match.caseId),
      ),
    ).toBe(true);
    expect(draft.changes).toContain(
      'Title set to "Senior Frontend Engineer" from the vacancy role.',
    );
    expect(draft.changes).toContain(
      "Tenure raised to 7+ years, as the vacancy requires.",
    );
    expect(bulletOf(draft, "N5").requirementIds).toEqual(["R1"]);
  });

  it("prints a selected case the composition skipped in the bank's words", () => {
    const draft = assembleCv(
      profile,
      analysis,
      selection,
      composed({ bullets: composed().bullets.slice(1) }),
    );
    const first = defined(selection.selected[0]).caseId;
    expect(bulletOf(draft, first)).toMatchObject({
      source: "bank",
      variants: caseById(first).variants,
    });
    expect(
      draft.changes.some((note) =>
        note.startsWith(`${first}: the bank's wording`),
      ),
    ).toBe(true);
  });

  it("keeps the bank's short forms for a close rewrite and cuts its own for a new meaning", () => {
    const n6 = caseById("N6");
    const close = n6.variants.full.replace(
      "Moved the public catalog",
      "Moved the **public catalog**",
    );
    expect(bulletVariants(close, n6.variants)).toEqual({
      full: close,
      compact: n6.variants.compact,
      minimal: n6.variants.minimal,
    });
    const rewrite =
      "Designed a GraphQL gateway for partner integrations, with schema stitching and persisted queries, which reduced integration effort for every new partner team.";
    expect(keepsBankMeaning(rewrite, n6.variants.full)).toBe(false);
    const derived = bulletVariants(rewrite, n6.variants);
    expect(derived.compact).toBe(
      "Designed a GraphQL gateway for partner integrations, with schema stitching and persisted queries.",
    );
    expect(derived.minimal).toBe(
      "Designed a GraphQL gateway for partner integrations.",
    );
    expect(shortenSentence("Too short to cut.", 0.5)).toBeNull();
  });

  it("adds at most two new bullets per company in free mode, never in strict mode", () => {
    const extra = [
      {
        companyId: "northwind",
        text: "Built a Vue storefront widget for partner shops with shared React design tokens.",
        requirementIds: ["R1", "R9"],
      },
      {
        companyId: "northwind",
        text: "Added server-side rendering checks to the Next.js release pipeline.",
        requirementIds: ["R2"],
      },
      { companyId: "northwind", text: "A third one.", requirementIds: [] },
    ];
    const strictDraft = assembleCv(
      profile,
      analysis,
      selection,
      composed({ newBullets: extra }),
    );
    expect(
      strictDraft.companies[0]?.bullets.some(
        (bullet) => bullet.source === "new",
      ),
    ).toBe(false);
    const freeSelection = selectionFor(free);
    const freeDraft = assembleCv(
      free,
      analysis,
      freeSelection,
      composed({ newBullets: extra }),
    );
    const northwind = defined(freeDraft.companies[0]).bullets;
    expect(northwind).toHaveLength(8);
    // The bullet for a must requirement comes right after the strongest case.
    expect(northwind[1]).toMatchObject({
      id: "new-1",
      source: "new",
      requirementIds: ["R1"],
    });
    expect(northwind.some((bullet) => bullet.id === "new-2")).toBe(true);
  });

  it("refuses a needs_edit selection", () => {
    expect(() =>
      assembleCv(
        profile,
        analysis,
        { ...selection, status: "needs_edit", selected: [] },
        composed(),
      ),
    ).toThrow("needs_edit");
  });
});

describe("partRules", () => {
  it("accepts the bank's own facts and the vacancy's tenure", () => {
    const draft = assembleCv(profile, analysis, selection, composed());
    expect(draftIssues(draft, profile)).toEqual([]);
    expect(partRules(draft, profile).replaced).toEqual([]);
  });

  it("strict: a figure the case does not have sends the bullet back to the bank", () => {
    const n5 = caseById("N5");
    const draft = assembleCv(
      profile,
      analysis,
      selection,
      withBullet(
        "N5",
        n5.variants.full.replace(/\.$/, ", improving load time by 40%."),
      ),
    );
    const { draft: fixed, replaced } = partRules(draft, profile);
    expect(replaced).toEqual(["N5"]);
    expect(bulletOf(fixed, "N5")).toMatchObject({
      source: "bank",
      variants: n5.variants,
    });
    expect(fixed.changes.at(-1)).toBe(
      "Original wording kept (the adapted text broke a CV rule): N5.",
    );
  });

  it("free: new figures are allowed, an altered bank figure is not", () => {
    const freeSelection = selectionFor(free);
    const n1 = caseById("N1");
    const added = assembleCv(
      free,
      analysis,
      freeSelection,
      withBullet(
        "N1",
        n1.variants.full.replace(/\.$/, " for 40 partner shops."),
      ),
    );
    expect(partRules(added, free).replaced).toEqual([]);
    const altered = assembleCv(
      free,
      analysis,
      freeSelection,
      withBullet("N1", n1.variants.full.replace("3 months", "2 months")),
    );
    expect(draftIssues(altered, free).map((issue) => issue.message)).toEqual([
      "N1: the full form must keep the figure '3 months'",
      "N1: bank figures changed (3 became 2)",
    ]);
  });

  it("checks About figures, the AI workflow, LaTeX and sentence ends; long dashes are fixed silently", () => {
    const about = composed().about;
    const draft = assembleCv(
      profile,
      analysis,
      selection,
      composed({
        about: {
          profile: {
            ...about.profile,
            full: `${about.profile.full} Grew revenue 40% in 3 months.`,
          },
          aiTools: {
            full: "I use Claude Code with tests and own the results.",
            compact: about.aiTools.compact,
          },
        },
        bullets: composed().bullets.map((bullet) =>
          bullet.caseId === "L3"
            ? {
                ...bullet,
                full: "Unified \\textbf{messaging} providers in Node.js.",
              }
            : bullet.caseId === "C1"
              ? {
                  ...bullet,
                  full: "Built a checkout BFF — it turned 7 service calls into 2 browser requests.",
                }
              : bullet,
        ),
      }),
    );
    const { draft: fixed, replaced } = partRules(draft, profile);
    expect(replaced.sort()).toEqual(["L3", "about.aiTools", "about.profile"]);
    expect(fixed.about.profile.full).toBe(
      profile.summary.profile.full.replace("5+", "7+"),
    );
    expect(fixed.about.aiTools).toEqual(profile.summary.aiTools);
    expect(bulletOf(fixed, "C1").variants.full).toBe(
      "Built a checkout BFF - it turned 7 service calls into 2 browser requests.",
    );
  });

  it("a full form without its metric and a broken new bullet are replaced", () => {
    const freeSelection = selectionFor(free);
    const draft = assembleCv(
      free,
      analysis,
      freeSelection,
      composed({
        bullets: composed().bullets.map((bullet) =>
          bullet.caseId === "L1"
            ? {
                ...bullet,
                full: "Rebuilt the notification setup as a React wizard.",
              }
            : bullet,
        ),
        newBullets: [
          {
            companyId: "lumen",
            text: "Built a broken bullet without an end",
            requirementIds: [],
          },
        ],
      }),
    );
    const { draft: fixed, replaced } = partRules(draft, free);
    expect(replaced).toEqual(["L1", "new-1"]);
    expect(bulletOf(fixed, "L1").variants.full).toBe(
      caseById("L1").variants.full,
    );
    expect(
      fixed.companies
        .flatMap((company) => company.bullets)
        .some((bullet) => bullet.id === "new-1"),
    ).toBe(false);
  });
});

describe("compose prompt", () => {
  it("sends voice, base About, cases with variants and supported matches, never rules files or TeX", () => {
    const prompt = composePrompt({ profile, analysis, selection });
    expect(prompt.purpose).toBe("resume.compose");
    expect(prompt.system).toContain(
      "state '7+ years of commercial experience'",
    );
    expect(prompt.system).toContain(
      "Both tools, verification and responsibility must survive",
    );
    expect(prompt.system).toContain("FACTS: strict");
    expect(prompt.system).toContain("newBullets must be []");
    expect(prompt.input).toContain(
      '"voiceRules":["Write simply, in short sentences."',
    );
    expect(prompt.input).toContain(
      '"supportedMatches":[{"requirementId":"R1","match":1',
    );
    expect(prompt.input).not.toMatch(/\\begin|\\documentclass|\\cvjob/);
    expect(
      composePrompt({ profile: free, analysis, selection: selectionFor(free) })
        .system,
    ).toContain("FACTS: free");
  });

  it("parses one bullet per selected case with supported tags and evident claims", () => {
    const prompt = composePrompt({ profile, analysis, selection });
    const answer = {
      ...composed(),
      bullets: [
        {
          caseId: "N5",
          full: caseById("N5").variants.full,
          requirementIds: ["R1", "R2", "R404"],
          retainedClaimIds: ["N1:core"],
        },
        {
          caseId: "N5",
          full: "A repeat.",
          requirementIds: [],
          retainedClaimIds: [],
        },
        {
          caseId: "S1",
          full: "Not selected.",
          requirementIds: [],
          retainedClaimIds: [],
        },
        {
          caseId: "N1",
          full: caseById("N1").variants.full,
          requirementIds: [],
          retainedClaimIds: [],
        },
      ],
      newBullets: [
        {
          companyId: "northwind",
          text: "Strict mode drops this.",
          requirementIds: [],
        },
      ],
      changeNotes: [" Frontend work first — then backend. ", ""],
    };
    const parsed = prompt.parse(answer);
    expect(parsed.bullets.map((bullet) => bullet.caseId)).toEqual(["N5", "N1"]);
    expect(parsed.bullets[0]?.requirementIds).toEqual(["R1"]);
    expect(parsed.bullets[0]?.retainedClaimIds).toEqual(["N5:core"]);
    expect(parsed.bullets[1]?.retainedClaimIds).toEqual([
      "N1:core",
      "N1:metric_1",
    ]);
    expect(parsed.newBullets).toEqual([]);
    expect(parsed.changeNotes).toEqual(["Frontend work first - then backend."]);
  });

  it("keeps at most two new bullets per quota company in free mode", () => {
    const freeSelection = selectionFor(free);
    const prompt = composePrompt({
      profile: free,
      analysis,
      selection: freeSelection,
    });
    const parsed = prompt.parse({
      ...composed(),
      newBullets: [
        { companyId: "northwind", text: "One.", requirementIds: ["R1", "R77"] },
        { companyId: "northwind", text: "Two.", requirementIds: [] },
        { companyId: "northwind", text: "Three.", requirementIds: [] },
        { companyId: "oldtown", text: "No quota here.", requirementIds: [] },
      ],
    });
    expect(parsed.newBullets).toEqual([
      { companyId: "northwind", text: "One.", requirementIds: ["R1"] },
      { companyId: "northwind", text: "Two.", requirementIds: [] },
    ]);
  });
});

const finding = (
  location: string,
  affectedIds: string[] = [],
  code: Finding["code"] = "essential_claim_lost",
): Finding => ({
  code,
  location,
  affectedIds,
  explanation: "x",
});

describe("review, repair and the source fallback", () => {
  const draft = assembleCv(profile, analysis, selection, composed());

  it("reviews the About and the bullets, never the title or the skills", () => {
    const prompt = reviewPrompt({ profile, analysis, draft });
    expect(prompt.system).toContain("never emit findings about them");
    expect(prompt.system).toContain("7+ years");
    expect(prompt.system).toContain("FACTS: strict");
    expect(prompt.input).not.toContain('"skills"');
    expect(prompt.input).not.toContain(draft.title);
    expect(prompt.input).not.toContain("fixed-1");
    const { findings } = prompt.parse({
      findings: [
        finding("skills[0]"),
        finding("DRAFT_DATA.title"),
        finding("bullets.N5.full", ["N5:core"], "generic_wording"),
      ],
    });
    expect(findings.map((item) => item.location)).toEqual(["bullets.N5.full"]);
    expect(
      reviewPrompt({
        profile: free,
        analysis,
        draft: { ...draft, factsMode: "free" },
      }).system,
    ).toContain("plausibility");
  });

  it("names the flagged parts in any location style; an unattributable finding distrusts everything", () => {
    const [first, second] = defined(draft.companies[0])
      .bullets as DraftBullet[];
    expect(
      [
        ...(flaggedParts(draft, [
          finding(`companies[0].bullets[${first?.id}].full`),
          finding("companies.lumen.L3.full"),
        ]) ?? []),
      ].sort(),
    ).toEqual([first?.id, "L3"].sort());
    expect([
      ...(flaggedParts(draft, [finding("companies[0].bullets[1].full")]) ?? []),
    ]).toEqual([second?.id]);
    // An About finding may cite the bullet it duplicates; only the About paragraph is at fault.
    expect([
      ...(flaggedParts(draft, [
        finding("DRAFT_DATA.about.profile.full", ["N1"]),
      ]) ?? []),
    ]).toEqual(["about.profile"]);
    expect([...(flaggedParts(draft, [finding("about")]) ?? [])]).toEqual([
      "about.profile",
      "about.aiTools",
    ]);
    expect(flaggedParts(draft, [finding("companies")])).toBeNull();
    expect(repairScope(draft, [finding("about.profile.full", ["N1"])])).toEqual(
      ["about.profile.full"],
    );
    expect(repairScope(draft, [finding("bullets.N5", ["N5:core"])])).toEqual([
      "N5",
    ]);
  });

  it("repairs only the allowed fields and re-derives a repaired bullet's short forms", () => {
    const findings = [
      finding("about.profile.full", [], "about_duplicate"),
      finding("bullets.N5.full", ["N5:core"]),
    ];
    const prompt = repairPrompt({ profile, analysis, draft, findings });
    expect(prompt.input).toContain(
      'ALLOWED_FIELDS=["N5","about.profile.full"]',
    );
    const patch = prompt.parse({
      about: {
        profile: {
          full: "Senior frontend engineer with 5+ years of commercial experience in React interfaces for commerce.",
          compact: "Not allowed.",
        },
        aiTools: { full: null, compact: null },
      },
      bullets: [
        {
          id: "N5",
          full: "Reworked the editor's canvas state in React with undo history and incremental rendering for large designs.",
        },
        { id: "N1", full: "Not allowed." },
      ],
      changeNotes: ["Not allowed either."],
    });
    expect(patch.about.profile.compact).toBeNull();
    expect(patch.bullets.map((bullet) => bullet.id)).toEqual(["N5"]);
    expect(patch.changeNotes).toBeNull();
    const repaired = applyRepair(draft, patch);
    expect(repaired.about.profile.full).toContain("7+ years");
    expect(bulletOf(repaired, "N5")).toMatchObject({ source: "model" });
    expect(bulletOf(repaired, "N5").variants.compact).toBe(
      caseById("N5").variants.compact,
    );
    expect(bulletOf(repaired, "N1")).toEqual(bulletOf(draft, "N1"));
    expect(() =>
      repairPrompt({
        profile,
        analysis,
        draft,
        findings: [finding("companies")],
      }),
    ).toThrow("no safe repair scope");
  });

  it("falls back to the candidate's own text for flagged parts only, or for everything", () => {
    const freeSelection = selectionFor(free);
    const adapted = assembleCv(
      free,
      analysis,
      freeSelection,
      composed({
        bullets: composed().bullets.map((bullet) =>
          bullet.caseId === "L3"
            ? {
                ...bullet,
                full: `${bullet.full.slice(0, -1)} for every client.`,
              }
            : bullet,
        ),
        newBullets: [
          {
            companyId: "lumen",
            text: "Built a plausible new bullet.",
            requirementIds: [],
          },
        ],
      }),
    );
    const partial = sourceFallback(
      adapted,
      [finding("bullets.L3.full"), finding("about.aiTools.compact")],
      free,
    );
    // The AI paragraph already is the profile's own text: nothing to replace there.
    expect(partial.sourced).toEqual(["L3"]);
    expect(bulletOf(partial.draft, "L3").variants).toEqual(
      caseById("L3").variants,
    );
    expect(partial.draft.about).toEqual(adapted.about);
    const everything = sourceFallback(adapted, [finding("somewhere")], free);
    expect(everything.sourced).toEqual(
      expect.arrayContaining(["about.profile", "L3", "new-1"]),
    );
    expect(everything.draft.about.profile.full).toBe(
      free.summary.profile.full.replace("5+", "7+"),
    );
    expect(
      everything.draft.companies
        .flatMap((company) => company.bullets)
        .some((bullet) => bullet.source === "new"),
    ).toBe(false);
    expect(everything.draft.companies.at(-1)?.bullets[0]?.source).toBe("fixed");
    expect(sourceFallback(adapted, [], free).sourced).toEqual([]);
  });
});
