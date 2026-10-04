import {
  type AccessRule,
  type AdminOverview,
  accessRuleSchema,
  type BookStatus,
  bookStatusSchema,
  type EduAuditAction,
  eduFeatures,
  eduService,
} from "@outegro/contracts/edu";
import { z } from "zod";
import { isBookSlug } from "./adapters/edu";
import type { Loaded } from "./result";

/**
 * Education rules as the console offers them. A paid book opens with one of
 * three feature sets; the form sends the set's name, never a list (FormData
 * keeps only the last of repeated field names).
 */
export const featurePresets = ["either", "library", "book"] as const;
export type FeaturePreset = (typeof featurePresets)[number];

export const accessModes = ["free", "signed_in", "grant"] as const;
export type AccessMode = (typeof accessModes)[number];

export function presetFeatures(preset: FeaturePreset, slug: string): string[] {
  switch (preset) {
    case "either":
      return [eduFeatures.library, eduFeatures.book(slug)];
    case "library":
      return [eduFeatures.library];
    case "book":
      return [eduFeatures.book(slug)];
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  [...new Set(a)].sort().join(" ") === [...new Set(b)].sort().join(" ");

/** The preset a rule's features match (any order); null for any other set. */
export function presetOf(
  features: readonly string[],
  slug: string,
): FeaturePreset | null {
  return (
    featurePresets.find((preset) =>
      sameSet(presetFeatures(preset, slug), features),
    ) ?? null
  );
}

/** The access dialog's single-value fields as the contract's rule. */
export function ruleOf(input: {
  slug: string;
  mode: AccessMode;
  features?: FeaturePreset;
  previewChapters?: number;
}): AccessRule | null {
  if (input.mode !== "grant") return { mode: input.mode };
  if (!input.features) return null;
  return {
    mode: "grant",
    features: presetFeatures(input.features, input.slug),
    previewChapters: input.previewChapters ?? 0,
  };
}

/** What edu-backend records with a status or access change. */
const statusChangeSchema = z.object({
  before: z.object({ status: bookStatusSchema }),
  after: z.object({ status: bookStatusSchema }),
});
const ruleChangeSchema = z.object({
  before: z.object({ rule: accessRuleSchema }),
  after: z.object({ rule: accessRuleSchema }),
});
const statusChanged: EduAuditAction = "book.status.changed";
const accessChanged: EduAuditAction = "book.access.changed";

export type BookChange =
  | { kind: "status"; before: BookStatus; after: BookStatus }
  | { kind: "rule"; before: AccessRule; after: AccessRule };

/**
 * Before and after of an Education audit entry that changed a book's status
 * (`{ before: { status }, after: { status } }`) or access rule (the same with
 * `rule`); null for any other entry and for one that does not carry both.
 */
export function bookChangeOf(entry: {
  action: string;
  data: Record<string, unknown>;
}): BookChange | null {
  if (entry.action === statusChanged) {
    const change = statusChangeSchema.safeParse(entry.data);
    return change.success
      ? {
          kind: "status",
          before: change.data.before.status,
          after: change.data.after.status,
        }
      : null;
  }
  if (entry.action === accessChanged) {
    const change = ruleChangeSchema.safeParse(entry.data);
    return change.success
      ? {
          kind: "rule",
          before: change.data.before.rule,
          after: change.data.after.rule,
        }
      : null;
  }
  return null;
}

/**
 * The `book` filter of a list page: a book the list knows, or any
 * well-formed slug while the list cannot be read (the service still filters
 * by it); anything else is dropped, never sent on.
 */
export function knownBook(
  value: string | undefined,
  books: Loaded<readonly { slug: string }[]>,
): string | undefined {
  if (!value) return undefined;
  const known = books.ok
    ? books.data.some((book) => book.slug === value)
    : isBookSlug(value);
  return known ? value : undefined;
}

type AssistToday = Pick<
  AdminOverview["assist"],
  "enabled" | "globalDailyLimit" | "globalUsedToday"
>;

/**
 * Today's (UTC) model calls of all readers against the spending cap; null
 * without a cap (0). Reached at the cap and past it: the cap may be lowered
 * during the day, below what was already spent.
 */
export function assistCap(
  assist: Pick<AssistToday, "globalDailyLimit" | "globalUsedToday">,
): { used: number; limit: number; reached: boolean } | null {
  const limit = assist.globalDailyLimit;
  if (limit <= 0) return null;
  const used = assist.globalUsedToday;
  return { used, limit, reached: used >= limit };
}

/**
 * What readers get from the AI assistant now, as the console names and tones
 * it: answers ("on"), no new answers until 00:00 UTC because the spending cap
 * is reached ("paused"; cached answers are still served), or no assistant at
 * all ("off": no model key, safe mode, switched off), whatever the cap.
 */
export const assistStates = ["on", "paused", "off"] as const;
export type AssistState = (typeof assistStates)[number];
export function assistState(assist: AssistToday): AssistState {
  if (!assist.enabled) return "off";
  return assistCap(assist)?.reached ? "paused" : "on";
}

/**
 * Shares of the assistant's week: answers from the cache and requests that
 * ended without a full answer, of every request (null without requests).
 */
export function assistShares(
  assist: Pick<AdminOverview["assist"], "requests7d" | "cached7d" | "failed7d">,
): { cached: number | null; failed: number | null } {
  const of = (part: number) =>
    assist.requests7d > 0 ? part / assist.requests7d : null;
  return { cached: of(assist.cached7d), failed: of(assist.failed7d) };
}

/** The feature that opens every published book. */
export const libraryFeature = eduFeatures.library;

/** What a manual grant in Payments carries: `edu:library`, `edu:book.<slug>`. */
export const grantTargetOf = (feature: string) => `${eduService}:${feature}`;
export const libraryTarget = grantTargetOf(libraryFeature);
export const bookTarget = (slug: string) =>
  grantTargetOf(eduFeatures.book(slug));

/** The book a feature opens (`book.<slug>`); null for the library and others. */
export function bookOfFeature(feature: string): string | null {
  const prefix = eduFeatures.book("");
  return feature.startsWith(prefix) && feature.length > prefix.length
    ? feature.slice(prefix.length)
    : null;
}

/**
 * Targets of a manual grant: the catalog's products as they are, then the
 * Education library and each book (no product sells them yet, so this is how
 * an operator gives someone a book). A catalog entry for the same target
 * keeps its own title; without the book list (Education not connected or
 * not readable) only the catalog is offered.
 */
export function withEducationTargets(
  catalog: readonly (readonly [string, string])[],
  books: readonly { slug: string; title: string }[] | null,
  names: { library: string; book: (title: string) => string },
): [string, string][] {
  const targets = new Map<string, string>(catalog);
  if (books) {
    const add = (value: string, title: string) => {
      if (!targets.has(value)) targets.set(value, title);
    };
    add(libraryTarget, names.library);
    for (const book of books)
      add(bookTarget(book.slug), names.book(book.title));
  }
  return [...targets];
}
