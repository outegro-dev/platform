import type {
  CategoryId,
  Profile,
  Requirement,
  VacancyAnalysis,
  VacancyFields,
} from "@outegro/contracts/atelier";

/*
 * Shapes the engine passes between pipeline steps. Every one is plain JSON,
 * so a worker can store a step's output and the next worker can read it back.
 */

export type Template = "general" | "ai";
export type RoleProfile = "frontend" | "backend" | "fullstack" | "ai";
export type FactsMode = Profile["factsMode"];

/** A prompt for llm-gateway: the answer schema and the code that checks it. */
export type Prompt<T> = {
  /** What the call is for, logged by the gateway (never the text). */
  purpose: string;
  system: string;
  input: string;
  /** JSON Schema of the answer, strict: every property required, no extras. */
  schema: Record<string, unknown>;
  /** Validates and cleans the model's answer; throws when it is unusable. */
  parse(output: unknown): T;
};

export type MatchValue = 0 | 0.5 | 1;

/** How well one bank case evidences one requirement, with the claim ids. */
export type Match = {
  requirementId: string;
  caseId: string;
  match: MatchValue;
  evidenceRefs: string[];
};

export type RolePolicy = {
  role: RoleProfile;
  template: Template;
  /** Normalised category weights; they sum to 1. */
  weights: Record<CategoryId, number>;
};

export type SelectedCase = { caseId: string; companyId: string; score: number };

export type RankedCase = SelectedCase & {
  categoryFit: number;
  evidenceFit: number;
  selected: boolean;
};

/** Bullets one company gets in the chosen template. */
export type CompanyQuota = {
  companyId: string;
  target: number;
  min: number;
  /** min(target, distinct achievements the bank has). */
  count: number;
};

export type RequirementCoverage = {
  requirementId: string;
  best: MatchValue;
  caseIds: string[];
};

export type Selection = {
  status: "ok" | "needs_edit";
  template: Template;
  role: RoleProfile;
  weights: Record<CategoryId, number>;
  /** In company order, each company in its rank order. */
  selected: SelectedCase[];
  /** Every eligible active case, best first. */
  ranked: RankedCase[];
  /** 0–100: importance-weighted best evidence over the requirements. */
  reqCoverage: number;
  /** 0–100: weighted best category rating over the categories. */
  catCoverage: number;
  utility: number;
  warnings: string[];
  quotas: CompanyQuota[];
  coverage: RequirementCoverage[];
  /** The grounded matches of eligible cases the scores were computed from. */
  matches: Match[];
  examinedSets: number;
};

export type AboutTexts = {
  profile: { full: string; compact: string };
  aiTools: { full: string; compact: string };
};

export type ComposeInput = {
  profile: Profile;
  analysis: VacancyAnalysis;
  selection: Selection;
};

export type ComposedBullet = {
  caseId: string;
  full: string;
  requirementIds: string[];
  retainedClaimIds: string[];
};

export type NewBullet = {
  companyId: string;
  text: string;
  requirementIds: string[];
};

export type ComposeOutput = {
  about: AboutTexts;
  /** One adapted full variant per selected case. */
  bullets: ComposedBullet[];
  /** Free mode only: at most two per company, within its domain. */
  newBullets: NewBullet[];
  changeNotes: string[];
};

export type Variant = "full" | "compact" | "minimal";
export const variantNames = ["full", "compact", "minimal"] as const;

/**
 * model: the composition's text; bank: the case's own wording; new: a bullet
 * the composition added (free mode); fixed: a company's fixed bullets.
 */
export type BulletSource = "model" | "bank" | "new" | "fixed";

export type DraftBullet = {
  /** Case id, `new-<n>` or `fixed-<n>`; the CV block is `bullet:<id>`. */
  id: string;
  caseId: string | null;
  companyId: string;
  source: BulletSource;
  variants: Record<Variant, string>;
  /** The bank's own wording of the case; repairs and fallbacks go back to it. */
  bank: Record<Variant, string> | null;
  requirementIds: string[];
  retainedClaimIds: string[];
};

export type DraftCompany = {
  companyId: string;
  name: string;
  title: string;
  dates: string;
  location: string;
  description: string;
  /** Fitting never leaves fewer bullets than this. */
  min: number;
  bullets: DraftBullet[];
};

export type SkillItem = {
  value: string;
  /** 0–100; fitting drops the lowest first when a row does not fit. */
  priority: number;
  requirementIds: string[];
};

export type DraftSkillRow = { label: string; items: SkillItem[] };

/** A selected case as fitting weighs it. */
export type FitCase = {
  caseId: string;
  companyId: string;
  projectId: string;
  primaryTheme: string;
  achievementGroupId: string;
  ratings: Record<CategoryId, number>;
};

export type CvDraft = {
  template: Template;
  factsMode: FactsMode;
  maxPages: 1 | 2;
  title: string;
  /** Tenure stated in the About. */
  years: number;
  about: AboutTexts;
  skills: DraftSkillRow[];
  companies: DraftCompany[];
  /** Vacancy technologies the CV names, in the vacancy's spelling. */
  technologies: string[];
  /** What was adapted, for the card ("changes" of the CV version). */
  changes: string[];
  /** What fitting needs to weigh a shortening or a removal. */
  fit: {
    requirements: Pick<Requirement, "id" | "importance" | "technologyTags">[];
    weights: Record<CategoryId, number>;
    cases: FitCase[];
    matches: Match[];
  };
};

export const findingCodes = [
  "missing_case",
  "duplicate_case",
  "duplicate_achievement",
  "about_duplicate",
  "metric_changed",
  "generic_wording",
  "essential_claim_lost",
  "false_coverage",
  "category_lost",
  "ai_tools_lost",
  "fixed_field_changed",
] as const;
export type FindingCode = (typeof findingCodes)[number];

export type Finding = {
  code: FindingCode;
  /** about.profile.full, about.aiTools.compact, bullets.<id>, changeNotes… */
  location: string;
  affectedIds: string[];
  explanation: string;
};

export type ReviewInput = {
  profile: Profile;
  analysis: VacancyAnalysis;
  draft: CvDraft;
};

export type RepairInput = ReviewInput & { findings: Finding[] };

/** Only the flagged parts; null leaves a part as it is. */
export type RepairPatch = {
  about: {
    profile: { full: string | null; compact: string | null };
    aiTools: { full: string | null; compact: string | null };
  };
  bullets: { id: string; full: string }[];
  changeNotes: string[] | null;
};

export const materialKinds = [
  "cover_letter",
  "email_en",
  "linkedin_inmail",
  "linkedin_connect",
] as const;
export type MaterialKind = (typeof materialKinds)[number];

export type Material = {
  kind: MaterialKind;
  locale: "en" | "ru";
  subject: string | null;
  body: string;
};

export type TextsInput = {
  profile: Profile;
  analysis: VacancyAnalysis;
  fields: VacancyFields;
  cv: CvDraft;
  kinds: MaterialKind[];
  questions: string[];
};

export type TextsOutput = {
  materials: Material[];
  answers: { question: string; answer: string }[];
};

/* ---------- Fitting ---------- */

export type FitActionKind =
  | "initial"
  | "trim_skills"
  | "compact_about"
  | "compact_bullet"
  | "minimal_bullet"
  | "remove_bullet"
  | "restore_bullet"
  | "restore_variant";

export type FitAction = {
  kind: FitActionKind;
  bulletId: string | null;
  detail: string;
  utilityLoss: number;
  savedLines: number;
};

/** What one render shows: About length, bullet lengths, removed bullets, skill drops. */
export type FitLayout = {
  compactAbout: boolean;
  /** Bullet id → variant; a bullet not listed shows its full text. */
  variants: Record<string, Variant>;
  removed: string[];
  /** Skill row index → extra items dropped after the line budget. */
  skillDrops: Record<string, number>;
};

/** One rendered layout as acceptance and the fallback remember it. */
export type FitCandidate = {
  attempt: number;
  layout: FitLayout;
  pages: number;
  overfullPt: number;
  lastPageFill: number;
  utility: number;
};

export type FitState = {
  /** What the next (or the accepted) document shows. */
  layout: FitLayout;
  /** How `layout` came from the previous render. */
  action: FitAction;
  /** Content keys already rendered; no layout is rendered twice. */
  visited: string[];
  /** `bulletId:variant` pairs whose text ran past the margin. */
  blocked: string[];
  /** The last render without fatal flaws or overflow, with its line counts. */
  reference: {
    layout: FitLayout;
    blocks: { id: string; lines: number }[];
  } | null;
  /** The last render that met every acceptance rule. */
  best: FitCandidate | null;
  /** The last two-page render whose second page is under a quarter full. */
  sparse: FitCandidate | null;
  /** Renders within the page limit and 12 pt overflow, for the fallback. */
  candidates: FitCandidate[];
  /**
   * Set when nextFitStep answers `accept`: the render whose PDF to keep.
   * `accept` with `accepted: null` means no PDF is acceptable (needs_edit).
   */
  accepted: FitCandidate | null;
  history: {
    attempt: number;
    action: FitActionKind;
    bulletId: string | null;
    pages: number;
    overfullPt: number;
    lastPageFill: number;
    verdict: string;
  }[];
};

export type FitStep = {
  action: "accept" | "render";
  state: FitState;
  reason: string;
};
