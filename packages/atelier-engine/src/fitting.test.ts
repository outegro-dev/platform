import {
  type CvDocument,
  cvDocumentSchema,
  type TexRenderResponse,
} from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { assembleCv, supportedRequirements } from "./assemble.js";
import {
  fitUtility,
  initialFitState,
  maxRenders,
  nextFitStep,
  toCvDocument,
} from "./fitting.js";
import {
  analysisOf,
  caseById,
  defined,
  profile,
  req,
} from "./fixtures/profile.js";
import { rolePolicy } from "./role-policy.js";
import { selectCases } from "./selection.js";
import type { ComposeOutput, CvDraft, FitStep, Match } from "./types.js";

const requirements = [
  req("R1", "Strong React interfaces", ["FE"], "must", ["React"]),
  req(
    "R2",
    "Server-rendered catalogs with Next.js",
    ["FE", "PF"],
    "responsibility",
    ["Next.js"],
  ),
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
const selection = selectCases(
  profile,
  requirements,
  matches,
  rolePolicy(requirements, analysis.title),
);
const compose: ComposeOutput = {
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
  changeNotes: ["Fixture."],
};
const baseDraft = (maxPages: 1 | 2 = 2): CvDraft => ({
  ...assembleCv(profile, analysis, selection, compose),
  maxPages,
});

/** A render of the document: every block measured (skills 1 line, the rest 3), one full page. */
function rendered(
  document: CvDocument,
  over: Partial<TexRenderResponse> = {},
): TexRenderResponse {
  return {
    pdfBase64: "",
    texSource: "",
    pages: 1,
    overfullPt: 0,
    fontsOk: true,
    blocks: [
      ...document.summary.map((_, index) => ({
        id: `summary:${index}`,
        lines: 3,
      })),
      ...document.skills.map((_, index) => ({
        id: `skill:${index}`,
        lines: 1,
      })),
      ...document.jobs.flatMap((job) =>
        job.bullets.map((bullet) => ({ id: `bullet:${bullet.id}`, lines: 3 })),
      ),
    ],
    lastPageFill: 0.8,
    warnings: [],
    ...over,
  };
}

/** The fitting loop as a worker runs it. */
function runFit(
  draft: CvDraft,
  render: (document: CvDocument, attempt: number) => Partial<TexRenderResponse>,
) {
  let state = initialFitState(draft);
  const documents: CvDocument[] = [];
  for (let attempt = 1; attempt <= maxRenders; attempt++) {
    const document = toCvDocument(profile, draft, state, analysis);
    documents.push(document);
    const step: FitStep = nextFitStep(
      state,
      draft,
      rendered(document, render(document, attempt)),
      attempt,
    );
    state = step.state;
    if (step.action === "accept") return { step, documents };
  }
  throw new Error("The loop did not end within the render budget");
}

const bulletTexts = (document: CvDocument) =>
  document.jobs.flatMap((job) => job.bullets.map((bullet) => bullet.text));
const shortened = (draft: CvDraft, document: CvDocument) => {
  const full = new Set(
    draft.companies.flatMap((company) =>
      company.bullets.map((bullet) => bullet.variants.full),
    ),
  );
  return bulletTexts(document).filter((text) => !full.has(text)).length;
};

describe("toCvDocument", () => {
  it("prints the draft for the template with block ids, links and PDF keywords", () => {
    const draft = baseDraft();
    const document = toCvDocument(
      profile,
      draft,
      initialFitState(draft),
      analysis,
    );
    expect(cvDocumentSchema.parse(document)).toEqual(document);
    expect(document.headline).toBe("Senior Frontend Engineer");
    expect(document.summary).toEqual([
      draft.about.profile.full,
      draft.about.aiTools.full,
    ]);
    expect(document.jobs.map((job) => job.company)).toEqual([
      "Northwind Commerce",
      "Lumen CRM",
      "Cargo Lane",
      "Oldtown Studio",
    ]);
    expect(document.jobs.at(-1)?.bullets).toEqual([
      { id: "fixed-1", text: profile.companies[4]?.fixedBullets[0] },
    ]);
    expect(document.links).toEqual(profile.person.links);
    expect(document.pdf.title).toBe("Jordan Vale | Senior Frontend Engineer");
    expect(document.pdf.keywords).toEqual(
      expect.arrayContaining([
        "Senior Frontend Engineer",
        "Front-End Developer",
        "Frontend Engineer",
        "React",
        "React.js",
        "ReactJS",
        "Next.js",
        "NextJS",
      ]),
    );
    for (const row of document.skills)
      expect(
        `${row.label}: ${row.items.join(", ")}`.length,
      ).toBeLessThanOrEqual(128);
  });
});

describe("nextFitStep", () => {
  it("accepts full content that fits at once", () => {
    const { step, documents } = runFit(baseDraft(), () => ({
      pages: 2,
      lastPageFill: 0.6,
    }));
    expect(step.action).toBe("accept");
    expect(step.state.accepted).toMatchObject({ attempt: 1, pages: 2 });
    expect(documents).toHaveLength(1);
    expect(bulletTexts(defined(documents[0]))).toHaveLength(15);
  });

  it("trims a wrapped skills line and accepts the re-render", () => {
    const { step, documents } = runFit(baseDraft(), (_, attempt) => ({
      blocks: attempt === 1 ? [{ id: "skill:1", lines: 2 }] : [],
    }));
    expect(step.state.history.map((item) => item.action)).toEqual([
      "initial",
      "trim_skills",
    ]);
    expect(step.state.accepted?.attempt).toBe(2);
    const [first, second] = documents.map(
      (document) => defined(document.skills[1]).items,
    );
    expect(second).toEqual(first?.slice(0, -1));
  });

  it("probes restorations without losing the last fitting PDF", () => {
    const draft = baseDraft(1);
    const { step, documents } = runFit(draft, (document) => ({
      pages:
        document.summary[0] === draft.about.profile.compact &&
        shortened(draft, document) > 0
          ? 1
          : 2,
    }));
    expect(step.action).toBe("accept");
    expect(step.state.history.map((item) => item.action)).toEqual([
      "initial",
      "compact_about",
      "compact_bullet",
      "restore_variant",
    ]);
    expect(step.state.accepted?.attempt).toBe(3);
    expect(toCvDocument(profile, draft, step.state, analysis)).toEqual(
      documents[2],
    );
  });

  it("puts longer text back when the second page is nearly empty", () => {
    const draft = baseDraft(2);
    const { step } = runFit(draft, (document) => {
      const compact = document.summary[0] === draft.about.profile.compact;
      const cut = shortened(draft, document);
      if (cut === 0) return { pages: 3, lastPageFill: 0.3 };
      return compact
        ? { pages: 2, lastPageFill: 0.1 }
        : { pages: 2, lastPageFill: 0.4 };
    });
    expect(step.state.history.map((item) => [item.action, item.pages])).toEqual(
      [
        ["initial", 3],
        ["compact_about", 3],
        ["compact_bullet", 2],
        ["restore_variant", 2],
      ],
    );
    expect(step.state.accepted).toMatchObject({
      attempt: 4,
      lastPageFill: 0.4,
    });
    expect(step.state.accepted?.layout.compactAbout).toBe(false);
  });

  it("accepts a sparse second page only when nothing fuller fits", () => {
    const { step } = runFit(baseDraft(2), (_, attempt) => ({
      pages: attempt === 1 ? 3 : 2,
      lastPageFill: 0.1,
    }));
    expect(step.state.history).toHaveLength(maxRenders);
    expect(step.state.accepted?.pages).toBe(2);
    expect(step.reason).toContain("10% full last page");
  });

  it("keeps the narrowest overflow when nothing meets the 2 pt tolerance, and no CV past 12 pt", () => {
    const near = runFit(baseDraft(1), (_, attempt) => ({
      overfullPt: attempt === 3 ? 4.2 : 5.43146,
    }));
    expect(near.step.state.accepted?.attempt).toBe(3);
    expect(near.step.reason).toContain("Accepted with 4.2 pt TeX overflow");
    const far = runFit(baseDraft(1), () => ({ overfullPt: 20 }));
    expect(far.step.state.accepted).toBeNull();
    expect(far.step.reason).toMatch(/^needs_edit/);
  });

  it("blocks a shorter form that ran into the margin and plans from the last render without overflow", () => {
    const draft = baseDraft(1);
    const { step } = runFit(draft, (document, attempt) =>
      attempt === 1
        ? { pages: 2 }
        : shortened(draft, document) > 0
          ? { pages: 2, overfullPt: 6 }
          : { pages: 2 },
    );
    expect(step.state.blocked.length).toBeGreaterThan(0);
    const [id, variant] = defined(step.state.blocked[0]).split(":");
    expect(
      step.state.history.filter(
        (item) => item.bulletId === id && item.action === `${variant}_bullet`,
      ),
    ).toHaveLength(1);
  });

  it("removes bullets only within company minimums and never the sole best evidence of a must requirement", () => {
    const draft = baseDraft(1);
    for (const bullet of draft.companies.flatMap((company) => company.bullets))
      bullet.variants = {
        full: bullet.variants.full,
        compact: bullet.variants.full,
        minimal: bullet.variants.full,
      };
    const { step } = runFit(draft, () => ({ pages: 2 }));
    const removed = step.state.history
      .filter((item) => item.action === "remove_bullet")
      .map((item) => item.bulletId ?? "");
    expect(removed.length).toBe(2);
    expect(removed.some((id) => id.startsWith("L") || id === "N5")).toBe(false);
    expect(step.state.accepted).toBeNull();
    expect(step.reason).toContain("No legal reductions remain");
  });

  it("stops at fonts that are not embedded", () => {
    const { step, documents } = runFit(baseDraft(), () => ({ fontsOk: false }));
    expect(documents).toHaveLength(1);
    expect(step.state.accepted).toBeNull();
    expect(step.reason).toBe(
      "needs_edit: Fonts are not embedded or not the chosen font",
    );
  });

  it("values a shorter form by what it still names", () => {
    const draft = baseDraft();
    const full = initialFitState(draft).layout;
    // The minimal N5 no longer names React, so it no longer evidences R1.
    expect(
      fitUtility(draft, { ...full, variants: { N5: "minimal" } }),
    ).toBeLessThan(fitUtility(draft, full));
    // The compact N4 had no requirement to lose.
    expect(
      fitUtility(draft, { ...full, variants: { N4: "compact" } }),
    ).toBeCloseTo(fitUtility(draft, full), 10);
  });
});
