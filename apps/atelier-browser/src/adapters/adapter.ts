import type { browserAtsSchema } from "@outegro/contracts/atelier";
import type { Page } from "playwright";
import type { z } from "zod";

export type BrowserAts = z.infer<typeof browserAtsSchema>;

/**
 * What differs between ATS forms. Everything else (labels, matching,
 * filling, captcha and login checks, submit) is the generic engine.
 */
export interface AtsAdapter {
  readonly ats: BrowserAts;
  /** Whether a URL belongs to this ATS. */
  matches(url: URL): boolean;
  /** The application form URL for a posting or apply URL (no network). */
  formUrl(url: URL): string;
  /**
   * Follows a page that only embeds the form (a company site with a
   * Greenhouse iframe) to the hosted form; returns the URL to open.
   */
  resolve?(page: Page, url: string): Promise<string>;
  /** Root of the form's fields; the first selector that has controls wins. */
  readonly formSelectors: string[];
  /** Controls the engine never touches (resume autofill uploaders, …). */
  readonly ignoreSelectors: string[];
  readonly submitSelectors: string[];
  /** Visible once the application went through. */
  readonly successSelectors: string[];
  /** Suggestions of a plain location input that is not an ARIA combobox. */
  readonly locationSuggestions?: string;
  /** Visible once an uploaded CV is processed (parsed, stored). */
  readonly uploadDone?: string;
}

/** A path split into non-empty segments. */
export function segments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}
