import {
  type AtsKind,
  type Salary,
  type VacancyFields,
  vacancyFieldsSchema,
} from "@outegro/contracts/atelier";
import { isBrowserOnly } from "./browser-only.js";
import { tidy } from "./html.js";
import { clip, prettySlug, toIsoUtc } from "./normalize.js";
import type { FetchResult, FetchTier } from "./types.js";

export type Draft = {
  provider: string;
  url: string;
  originalUrl?: string | null;
  applyUrl?: string | null;
  ats?: AtsKind | null;
  atsBoard?: string | null;
  atsJobId?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  remote?: boolean | null;
  postedAt?: unknown;
  salary?: Salary | null;
  text: string;
};

const MAX_TEXT = 200_000;

/** Company from a careers host: careers.acme.com → Acme. */
export function companyFromHost(link: string): string {
  try {
    const parts = new URL(link).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .split(".");
    const generic = new Set([
      "careers",
      "jobs",
      "job",
      "apply",
      "work",
      "hire",
      "boards",
      "join",
      "en",
      "career",
    ]);
    const name =
      parts.slice(0, -1).find((part) => !generic.has(part)) ?? parts[0] ?? "";
    return prettySlug(name);
  } catch {
    return "Unknown";
  }
}

const validUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

/**
 * Turns what an adapter found into contract fields: the browser-only rule
 * on the text, title and company present, every value within the schema.
 */
export function finish(
  draft: Draft,
  tier: FetchTier,
  source: string,
): FetchResult {
  const text = tidy(draft.text);
  if (isBrowserOnly(text))
    return {
      ok: false,
      status: "browser",
      reason: `Only ${text.length} characters of vacancy text (${source}); read it in a browser`,
    };
  const title = clip(draft.title?.replace(/\s+/g, " ").trim() || null, 300);
  if (!title)
    return {
      ok: false,
      status: "browser",
      reason: `No vacancy title found (${source})`,
    };
  const company =
    clip(draft.company?.replace(/\s+/g, " ").trim() || null, 200) ??
    companyFromHost(draft.originalUrl ?? draft.url);
  const fields: VacancyFields = {
    provider: draft.provider.slice(0, 60),
    url: validUrl(draft.url) ?? draft.url,
    originalUrl: validUrl(draft.originalUrl),
    applyUrl: validUrl(draft.applyUrl),
    ats: draft.ats ?? null,
    atsBoard: clip(draft.atsBoard ?? null, 200),
    atsJobId: clip(draft.atsJobId ?? null, 200),
    title,
    company,
    location: clip(draft.location?.replace(/\s+/g, " ").trim() || null, 300),
    remote: draft.remote ?? null,
    postedAt: toIsoUtc(draft.postedAt),
    salary: draft.salary ?? null,
    text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
  };
  const parsed = vacancyFieldsSchema.safeParse(fields);
  if (!parsed.success)
    return {
      ok: false,
      status: "failed",
      reason: `Fields do not match the contract: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
        .slice(0, 400)}`,
    };
  return { ok: true, fields: parsed.data, tier, source };
}
