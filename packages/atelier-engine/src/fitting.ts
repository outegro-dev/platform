import {
  type CvDocument,
  type CvRole,
  cvDocumentSchema,
  type Profile,
  type TexRenderResponse,
  type VacancyAnalysis,
} from "@outegro/contracts/atelier";
import { roleTitle } from "./adaptation.js";
import { measureSet, type ScoredCase, scoreCase } from "./scoring.js";
import { skillLine, sortedItems } from "./skills.js";
import { spellings } from "./technologies.js";
import { clip, hashKey, mentions, plainText } from "./text.js";
import type {
  CvDraft,
  DraftBullet,
  FitAction,
  FitCandidate,
  FitLayout,
  FitState,
  FitStep,
  Variant,
} from "./types.js";

/*
 * Fitting the CV on its pages (fitting.ts and fit-resume.ts of Work Finder,
 * generalised to profile.maxPages). Each render is judged; the next layout
 * first unwraps skill lines, then (with an accepted render) probes
 * restorations, else uses the compact About and then shortens the bullet
 * with the least utility loss per saved line, full → compact → minimal,
 * removing a bullet only when nothing is left to shorten. Company minimums
 * and the best evidence of every must requirement are never lost.
 */

/** Renders per CV, the first one included. */
export const maxRenders = 12;
/** Overfull \hbox tolerated in an accepted PDF. */
const overflowTolerancePt = 2;
/** Past this a line visibly runs into the margin (12 pt is about 4 mm). */
const nearMissPt = 12;
/** A second page under this fill looks unfinished. */
const sparseFill = 0.25;

const variantOf = (layout: FitLayout, id: string): Variant =>
  layout.variants[id] ?? "full";

const bulletsOf = (draft: CvDraft) =>
  draft.companies.flatMap((company) => company.bullets);

const shown = (draft: CvDraft, layout: FitLayout) =>
  bulletsOf(draft).filter((bullet) => !layout.removed.includes(bullet.id));

export function initialFitState(_draft: CvDraft): FitState {
  return {
    layout: { compactAbout: false, variants: {}, removed: [], skillDrops: {} },
    action: {
      kind: "initial",
      bulletId: null,
      detail: "Render the composed full content.",
      utilityLoss: 0,
      savedLines: 0,
    },
    visited: [],
    blocked: [],
    reference: null,
    best: null,
    sparse: null,
    candidates: [],
    accepted: null,
    history: [],
  };
}

/** The texts a layout prints: two About paragraphs, the skill lines, each company's bullets. */
export function layoutTexts(draft: CvDraft, layout: FitLayout) {
  const about = layout.compactAbout ? "compact" : "full";
  return {
    summary: [draft.about.profile[about], draft.about.aiTools[about]],
    skills: draft.skills.map((row, index) => ({
      label: row.label,
      items: skillLine(
        row.label,
        sortedItems(row).map((item) => item.value),
        layout.skillDrops[String(index)] ?? 0,
      ),
    })),
    jobs: draft.companies.map((company) => ({
      company,
      bullets: company.bullets
        .filter((bullet) => !layout.removed.includes(bullet.id))
        .map((bullet) => ({
          id: bullet.id,
          text: bullet.variants[variantOf(layout, bullet.id)],
        })),
    })),
  };
}

/** Two layouts that print the same text share a key; no text is rendered twice. */
function contentKey(draft: CvDraft, layout: FitLayout) {
  const texts = layoutTexts(draft, layout);
  return hashKey(
    JSON.stringify([
      texts.summary,
      texts.skills.map((row) => row.items),
      texts.jobs.map((job) => job.bullets),
    ]),
  );
}

const richness = (draft: CvDraft, layout: FitLayout) => {
  const texts = layoutTexts(draft, layout);
  return [
    ...texts.summary,
    ...texts.jobs.flatMap((job) => job.bullets.map((bullet) => bullet.text)),
    ...texts.skills.map((row) => row.items.join(", ")),
  ].join("").length;
};

/**
 * Requirements a bullet's printed form still evidences. The full text keeps
 * what the composition claimed; a shorter form keeps a technology
 * requirement only while it still names one spelling of its technologies.
 */
function retainedRequirements(
  draft: CvDraft,
  bullet: DraftBullet,
  variant: Variant,
) {
  if (variant === "full") return bullet.requirementIds;
  const text = plainText(bullet.variants[variant]);
  return bullet.requirementIds.filter((id) => {
    const tags =
      draft.fit.requirements.find((requirement) => requirement.id === id)
        ?.technologyTags ?? [];
    return (
      !tags.length ||
      tags.some((tag) =>
        spellings(tag).some((spelling) => mentions(text, spelling)),
      )
    );
  });
}

/** Selected cases as the layout prints them, and the coverage of new bullets (0.5 per requirement). */
function retainedScores(draft: CvDraft, layout: FitLayout) {
  const requirements = draft.fit.requirements;
  const bullets = new Map(
    shown(draft, layout).map((bullet) => [bullet.id, bullet]),
  );
  const cases: ScoredCase[] = draft.fit.cases.flatMap((item) => {
    const bullet = bullets.get(item.caseId);
    if (!bullet) return [];
    const kept = new Set(
      retainedRequirements(draft, bullet, variantOf(layout, bullet.id)),
    );
    const matches = requirements.map((requirement) =>
      kept.has(requirement.id)
        ? (draft.fit.matches.find(
            (match) =>
              match.caseId === item.caseId &&
              match.requirementId === requirement.id,
          )?.match ?? 0)
        : 0,
    );
    return [
      {
        caseId: item.caseId,
        companyId: item.companyId,
        ...scoreCase(item.ratings, matches, requirements, draft.fit.weights),
        matches,
        ratings: item.ratings,
        projectId: item.projectId,
        primaryTheme: item.primaryTheme,
        achievementGroupId: item.achievementGroupId,
      },
    ];
  });
  const added = [...bullets.values()].filter(
    (bullet) => bullet.source === "new",
  );
  const extra = requirements.map((requirement) =>
    added.some((bullet) =>
      retainedRequirements(
        draft,
        bullet,
        variantOf(layout, bullet.id),
      ).includes(requirement.id),
    )
      ? 0.5
      : 0,
  );
  return { cases, extra };
}

/** Set utility of what a layout prints (selection's objective, on the printed forms). */
export function fitUtility(draft: CvDraft, layout: FitLayout) {
  const { cases, extra } = retainedScores(draft, layout);
  return measureSet(cases, draft.fit.requirements, draft.fit.weights, extra)
    .utility;
}

/** Company minimums hold and no must requirement loses its best evidence. */
function legal(draft: CvDraft, current: FitLayout, next: FitLayout) {
  for (const company of draft.companies) {
    if (company.min <= 0) continue;
    const left = company.bullets.filter(
      (bullet) =>
        bullet.source !== "fixed" && !next.removed.includes(bullet.id),
    ).length;
    if (left < company.min) return false;
  }
  const best = (layout: FitLayout) => {
    const { cases, extra } = retainedScores(draft, layout);
    return draft.fit.requirements.map((_, index) =>
      Math.max(
        extra[index] ?? 0,
        ...cases.map((item) => item.matches[index] ?? 0),
      ),
    );
  };
  const before = best(current);
  const after = best(next);
  return draft.fit.requirements.every(
    (requirement, index) =>
      requirement.importance !== "must" ||
      (after[index] ?? 0) >= (before[index] ?? 0),
  );
}

type FitOption = {
  layout: FitLayout;
  action: FitAction;
  utility: number;
  richness: number;
};
type Blocks = { id: string; lines: number }[];

const measuredLines = (blocks: Blocks, id: string) => {
  const lines = blocks.find((block) => block.id === id)?.lines;
  return lines ? lines : null;
};

const option = (
  draft: CvDraft,
  layout: FitLayout,
  action: Omit<FitAction, "utilityLoss" | "savedLines"> &
    Partial<Pick<FitAction, "utilityLoss" | "savedLines">>,
): FitOption => ({
  layout,
  action: { utilityLoss: 0, savedLines: 0, ...action },
  utility: fitUtility(draft, layout),
  richness: richness(draft, layout),
});

/** A skills line the PDF wrapped loses its lowest-priority item; checked before any page-level reduction. */
function skillLineTrim(draft: CvDraft, layout: FitLayout, blocks: Blocks) {
  const texts = layoutTexts(draft, layout);
  const drops = { ...layout.skillDrops };
  const wrapped: string[] = [];
  texts.skills.forEach((row, index) => {
    const lines = measuredLines(blocks, `skill:${index}`);
    if (lines !== null && lines > 1 && row.items.length > 1) {
      drops[String(index)] = (drops[String(index)] ?? 0) + 1;
      wrapped.push(row.label);
    }
  });
  if (!wrapped.length) return null;
  return option(
    draft,
    { ...layout, skillDrops: drops },
    {
      kind: "trim_skills",
      bulletId: null,
      detail: `Skills line longer than one line: drop the least relevant item in ${wrapped.join(", ")}.`,
      savedLines: wrapped.length,
    },
  );
}

/** Both compact About paragraphs, unless they print the same text. */
function compactFoundation(draft: CvDraft, layout: FitLayout) {
  if (layout.compactAbout) return null;
  const next = { ...layout, compactAbout: true };
  if (contentKey(draft, next) === contentKey(draft, layout)) return null;
  return option(draft, next, {
    kind: "compact_about",
    bulletId: null,
    detail: "Use both compact About paragraphs.",
  });
}

/** Shortenings ordered by utility loss per saved line; removals only when nothing is left to shorten. */
function reductionOptions(
  draft: CvDraft,
  layout: FitLayout,
  blocks: Blocks,
  blocked: string[],
) {
  const current = fitUtility(draft, layout);
  const options: FitOption[] = [];
  const candidates = shown(draft, layout).filter(
    (bullet) => bullet.source !== "fixed",
  );
  for (const bullet of candidates) {
    const now = variantOf(layout, bullet.id);
    const before = bullet.variants[now];
    const alternatives: Variant[] =
      now === "full"
        ? ["compact", "minimal"]
        : now === "compact"
          ? ["minimal"]
          : [];
    // Identical or longer alternatives save nothing.
    const shorter = alternatives.find(
      (name) =>
        bullet.variants[name].length < before.length &&
        !blocked.includes(`${bullet.id}:${name}`),
    );
    if (!shorter) continue;
    const next = {
      ...layout,
      variants: { ...layout.variants, [bullet.id]: shorter },
    };
    if (!legal(draft, layout, next)) continue;
    const lines = measuredLines(blocks, `bullet:${bullet.id}`);
    const after = bullet.variants[shorter];
    const saved =
      lines === null
        ? 0
        : Math.max(
            0,
            lines - Math.ceil((lines * after.length) / before.length),
          );
    const made = option(draft, next, {
      kind: shorter === "compact" ? "compact_bullet" : "minimal_bullet",
      bulletId: bullet.id,
      detail: `${now} → ${shorter}; ${lines === null ? "line measurement unavailable" : "savings estimated from measured lines"}.`,
      savedLines: saved,
    });
    made.action.utilityLoss = Math.max(0, current - made.utility);
    options.push(made);
  }
  // Removing an achievement is permitted only after shortening is exhausted.
  if (!options.length)
    for (const bullet of candidates) {
      const next = { ...layout, removed: [...layout.removed, bullet.id] };
      if (!legal(draft, layout, next)) continue;
      const made = option(draft, next, {
        kind: "remove_bullet",
        bulletId: bullet.id,
        detail:
          "Remove a whole bullet within company minimums without weakening must-requirement coverage.",
        savedLines: measuredLines(blocks, `bullet:${bullet.id}`) ?? 0,
      });
      made.action.utilityLoss = Math.max(0, current - made.utility);
      options.push(made);
    }
  return options.sort(
    (a, b) =>
      a.action.utilityLoss / Math.max(1, a.action.savedLines) -
        b.action.utilityLoss / Math.max(1, b.action.savedLines) ||
      b.action.savedLines - a.action.savedLines ||
      b.richness - a.richness ||
      String(a.action.bulletId).localeCompare(String(b.action.bulletId), "en", {
        numeric: true,
      }),
  );
}

/** Longer forms and removed bullets back, never lowering utility; best first. */
function restorationOptions(draft: CvDraft, layout: FitLayout) {
  const candidates: FitOption[] = [];
  for (const id of layout.removed)
    candidates.push(
      option(
        draft,
        { ...layout, removed: layout.removed.filter((value) => value !== id) },
        {
          kind: "restore_bullet",
          bulletId: id,
          detail:
            "Probe restoring a removed bullet; the last fitting PDF stays if it overflows.",
        },
      ),
    );
  for (const bullet of shown(draft, layout)) {
    const now = variantOf(layout, bullet.id);
    const longer: Variant[] =
      now === "minimal"
        ? ["compact", "full"]
        : now === "compact"
          ? ["full"]
          : [];
    for (const name of longer)
      if (bullet.variants[name].length > bullet.variants[now].length)
        candidates.push(
          option(
            draft,
            { ...layout, variants: { ...layout.variants, [bullet.id]: name } },
            {
              kind: "restore_variant",
              bulletId: bullet.id,
              detail: `${now} → ${name}: probe a longer form.`,
            },
          ),
        );
  }
  if (layout.compactAbout)
    candidates.push(
      option(
        draft,
        { ...layout, compactAbout: false },
        {
          kind: "restore_variant",
          bulletId: null,
          detail: "Probe the full About paragraphs.",
        },
      ),
    );
  const current = fitUtility(draft, layout);
  return candidates
    .filter(
      (item) =>
        legal(draft, layout, item.layout) && item.utility >= current - 1e-9,
    )
    .sort(
      (a, b) =>
        b.utility - a.utility ||
        b.richness - a.richness ||
        String(a.action.bulletId).localeCompare(
          String(b.action.bulletId),
          "en",
          {
            numeric: true,
          },
        ),
    );
}

type Verdict = {
  valid: boolean;
  fatal: boolean;
  overflow: boolean;
  sparse: boolean;
  reason: string;
};

/** Acceptance of one render: fonts, page count, overflow and, on two pages, the fill of the second. */
function judge(render: TexRenderResponse, maxPages: number): Verdict {
  if (!render.fontsOk)
    return {
      valid: false,
      fatal: true,
      overflow: false,
      sparse: false,
      reason: "Fonts are not embedded or not the chosen font",
    };
  if (render.pages < 1)
    return {
      valid: false,
      fatal: true,
      overflow: false,
      sparse: false,
      reason: "The PDF has no pages",
    };
  const overflow = render.overfullPt > overflowTolerancePt;
  const over = render.pages > maxPages;
  const sparse =
    maxPages === 2 && render.pages === 2 && render.lastPageFill < sparseFill;
  const reason = over
    ? `${render.pages} pages, the limit is ${maxPages}`
    : overflow
      ? `Excessive TeX overflow (${render.overfullPt} pt)`
      : sparse
        ? `The second page is only ${Math.round(render.lastPageFill * 100)}% full`
        : `${render.pages} A4 page${render.pages > 1 ? "s" : ""}, fonts embedded, overflow within ${overflowTolerancePt} pt`;
  return {
    valid: !over && !overflow && !sparse,
    fatal: false,
    overflow,
    sparse: sparse && !overflow,
    reason,
  };
}

const accept = (
  state: FitState,
  candidate: FitCandidate,
  reason: string,
): FitStep => ({
  action: "accept",
  state: { ...state, layout: candidate.layout, accepted: candidate },
  reason,
});

const needsEdit = (state: FitState, reason: string): FitStep => ({
  action: "accept",
  state: { ...state, accepted: null },
  reason: `needs_edit: ${reason}`,
});

const renderNext = (
  state: FitState,
  next: FitOption,
  reason: string,
): FitStep => ({
  action: "render",
  state: { ...state, layout: next.layout, action: next.action },
  reason,
});

/**
 * No dead end for a cosmetic flaw: when nothing met every rule, the render
 * with the narrowest overflow (≤ 12 pt) within the page limit wins, then the
 * richer one. A two-page render with a sparse second page counts here.
 */
function finish(state: FitState, reason: string): FitStep {
  if (state.best)
    return accept(state, state.best, `${reason}; the last accepted PDF stays`);
  const fallback = [...state.candidates].sort(
    (a, b) =>
      Number(a.overfullPt > overflowTolerancePt) -
        Number(b.overfullPt > overflowTolerancePt) ||
      a.overfullPt - b.overfullPt ||
      b.utility - a.utility ||
      a.attempt - b.attempt,
  )[0];
  if (fallback)
    return accept(
      state,
      fallback,
      fallback.overfullPt > overflowTolerancePt
        ? `Accepted with ${fallback.overfullPt} pt TeX overflow: nothing met the ${overflowTolerancePt} pt tolerance (${reason})`
        : `Accepted with a ${Math.round(fallback.lastPageFill * 100)}% full last page: nothing fuller fitted (${reason})`,
    );
  return needsEdit(
    state,
    `${reason}; no render fits the page limit within 12 pt of overflow`,
  );
}

/**
 * The fitting loop, one render at a time. `attempt` is the 1-based number of
 * the render just made (at most 12). `render` asks for toCvDocument(…,
 * state.layout) to be rendered next; `accept` ends the loop: the PDF of
 * render `state.accepted.attempt` is the CV, and `state.accepted === null`
 * means no PDF is acceptable (the application needs an edit).
 */
export function nextFitStep(
  previous: FitState,
  draft: CvDraft,
  render: TexRenderResponse,
  attempt: number,
): FitStep {
  const state: FitState = structuredClone(previous);
  const layout = state.layout;
  const visited = (candidate: FitLayout) =>
    state.visited.includes(contentKey(draft, candidate));
  const key = contentKey(draft, layout);
  if (!state.visited.includes(key)) state.visited.push(key);
  const verdict = judge(render, draft.maxPages);
  const candidate: FitCandidate = {
    attempt,
    layout,
    pages: render.pages,
    overfullPt: render.overfullPt,
    lastPageFill: render.lastPageFill,
    utility: fitUtility(draft, layout),
  };
  state.history.push({
    attempt,
    action: state.action.kind,
    bulletId: state.action.bulletId,
    pages: render.pages,
    overfullPt: render.overfullPt,
    lastPageFill: render.lastPageFill,
    verdict: verdict.reason,
  });
  // A shorter sentence may create an unbreakable line: that form is not tried again.
  if (
    verdict.overflow &&
    state.action.bulletId &&
    (state.action.kind === "compact_bullet" ||
      state.action.kind === "minimal_bullet")
  )
    state.blocked.push(
      `${state.action.bulletId}:${variantOf(layout, state.action.bulletId)}`,
    );
  if (!verdict.fatal && !verdict.overflow)
    state.reference = { layout, blocks: render.blocks };
  if (verdict.valid) state.best = candidate;
  if (verdict.sparse) state.sparse = candidate;
  if (
    !verdict.fatal &&
    render.pages <= draft.maxPages &&
    render.overfullPt <= nearMissPt
  )
    state.candidates.push(candidate);
  if (verdict.fatal) return needsEdit(state, verdict.reason);
  if (attempt >= maxRenders) return finish(state, "Fit budget exhausted");

  // Every skills line must fit one line; a valid wrapped candidate above stays the fallback.
  const trim = skillLineTrim(draft, layout, render.blocks);
  if (trim && !visited(trim.layout))
    return renderNext(state, trim, trim.action.detail);

  if (state.best) {
    const restore = restorationOptions(draft, state.best.layout).find(
      (item) => !visited(item.layout),
    );
    if (!restore)
      return accept(
        state,
        state.best,
        verdict.valid
          ? verdict.reason
          : "No untested legal restoration remains",
      );
    return renderNext(
      state,
      restore,
      `Accepted render ${state.best.attempt} stays; ${restore.action.detail}`,
    );
  }
  // A near-empty second page: put longer text back before shrinking further.
  if (state.sparse) {
    const restore = restorationOptions(draft, state.sparse.layout).find(
      (item) => !visited(item.layout),
    );
    if (restore)
      return renderNext(
        state,
        restore,
        `${verdict.reason}; ${restore.action.detail}`,
      );
  }
  // A shorter sentence that overflowed is discarded: plan from the last render without overflow.
  let base = layout;
  if (verdict.overflow && state.reference) base = state.reference.layout;
  if (state.sparse && render.pages > draft.maxPages) base = state.sparse.layout;
  const foundation = compactFoundation(draft, base);
  const options =
    foundation && !visited(foundation.layout)
      ? [foundation]
      : reductionOptions(
          draft,
          base,
          state.reference?.blocks ?? render.blocks,
          state.blocked,
        );
  const next = options.find((item) => !visited(item.layout));
  if (!next)
    return finish(
      state,
      "No legal reductions remain within company minimums and must coverage",
    );
  return renderNext(state, next, `${verdict.reason}; ${next.action.detail}`);
}

/* ---------- The document for atelier-tex ---------- */

const focusSpellings: Record<CvRole["focus"], string[]> = {
  Frontend: ["Frontend", "Front-End", "Front End"],
  Backend: ["Backend", "Back-End", "Back End"],
  "Full-Stack": ["Full-Stack", "Full Stack", "Fullstack"],
  AI: ["AI"],
  Software: ["Software"],
};

/** The role in the spellings ATS searches use: Full-Stack / Full Stack / Fullstack × Engineer / Developer. */
export function roleSpellings(role: CvRole | null, fallback: string) {
  if (!role) return [fallback];
  const nouns =
    role.noun === "Engineer"
      ? ["Engineer", "Developer"]
      : ["Developer", "Engineer"];
  const names = focusSpellings[role.focus].flatMap((focus) =>
    nouns.map((noun) => `${focus} ${noun}`),
  );
  return [
    roleTitle(role) ?? fallback,
    ...(role.senior ? names.map((name) => `Senior ${name}`) : []),
    ...names,
  ];
}

const uniqueCaseless = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Tools and process words never shown in the header stack line. */
const notStack =
  /^(claude code|cursor|codex|openai codex|kimi|minimax|mcp|git|github|gitlab|ci\/cd|github actions|gitlab ci\/cd|jira|confluence|figma|agile|scrum|rest|rest api|restful apis?|llms?|ai agents?)$/i;

/**
 * The header's stack line: up to six of the vacancy's technologies the CV
 * names (languages and frameworks, not tools), topped up from the profile's
 * own stack, joined by middle dots like the master CV.
 */
export function cvStack(profile: Profile, technologies: string[]): string {
  const keyOf = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  // "AI/LLM" stays one item: only dots, bars and commas separate the stack.
  const base = profile.stack
    .split(/\s*[·|,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  // Only what the master CV itself lists, in the master CV's own spelling
  // (TypeScript, not the vacancy's "Typescript"): the header states the core stack.
  const spelling = new Map<string, string>();
  for (const item of [...profile.skills.flatMap((row) => row.items), ...base])
    if (!spelling.has(keyOf(item))) spelling.set(keyOf(item), item.trim());
  const fromVacancy = technologies
    .filter(
      (value) => !notStack.test(value.trim()) && spelling.has(keyOf(value)),
    )
    .map((value) => spelling.get(keyOf(value)) as string);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const item of [...fromVacancy, ...base]) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
    if (picked.length === 6) break;
  }
  return picked.join(" · ");
}

/**
 * The CV as data for the "Minimal violet" template, as the layout prints it.
 * Block ids the renderer measures: `summary:0`, `summary:1`, `skill:<row>`,
 * `bullet:<bullet id>`.
 */
export function toCvDocument(
  profile: Profile,
  draft: CvDraft,
  state: FitState,
  analysis: VacancyAnalysis,
): CvDocument {
  const texts = layoutTexts(draft, state.layout);
  const person = profile.person;
  const role = roleTitle(analysis.cvRole) ?? profile.headline;
  const technologies = draft.technologies;
  return cvDocumentSchema.parse({
    name: person.name,
    location: person.location,
    phoneDisplay: person.phoneDisplay,
    phoneDigits: person.phoneDigits,
    headline: clip(draft.title, 120),
    stack: clip(cvStack(profile, technologies), 160),
    links: person.links.slice(0, 8),
    summary: texts.summary
      .map((text) => clip(text, 1200))
      .filter(Boolean)
      .slice(0, 2),
    skills: texts.skills.slice(0, 14).map((row) => ({
      label: clip(row.label, 60),
      items: row.items.slice(0, 40).map((item) => clip(item, 80)),
    })),
    jobs: texts.jobs.slice(0, 10).map(({ company, bullets }) => ({
      title: clip(company.title, 120),
      company: clip(company.name, 120),
      dates: clip(company.dates, 60),
      location: clip(company.location, 60),
      description: clip(company.description, 200),
      bullets: bullets
        .slice(0, 20)
        .map((bullet) => ({ id: bullet.id, text: clip(bullet.text, 700) })),
    })),
    education: profile.education.slice(0, 4).map((item) => ({
      degree: clip(item.degree, 160),
      school: clip(item.school, 160),
      dates: clip(item.dates, 60),
    })),
    languages: profile.languages.slice(0, 6).map((item) => ({
      name: clip(item.name, 40),
      level: clip(item.level, 80),
    })),
    pdf: {
      title: clip(`${person.name} | ${draft.title}`, 300),
      subject: clip(
        `${role} CV${technologies.length ? `: ${technologies.join(", ")}` : ""}`,
        500,
      ),
      keywords: uniqueCaseless([
        ...roleSpellings(analysis.cvRole, role),
        ...technologies.flatMap((technology) => spellings(technology)),
      ])
        .filter((keyword) => keyword.length <= 80)
        .slice(0, 200),
    },
  });
}
