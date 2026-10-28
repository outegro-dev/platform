import type { AtsKind, VacancyFields } from "@outegro/contracts/atelier";

export type FetchTier = "api" | "http";
export type FetchFailure = "browser" | "failed" | "closed";

export type FetchResult =
  | { ok: true; fields: VacancyFields; tier: FetchTier; source: string }
  | { ok: false; status: FetchFailure; reason: string };

export type BoardPosting = {
  title: string;
  location: string | null;
  remote: boolean | null;
  url: string;
  ats: AtsKind;
  board: string;
  jobId: string;
  updatedAt: string | null;
  department: string | null;
};

export type AggregatorSource = "wantapply" | "hirify";

export type AggregatorPosting = {
  url: string;
  title: string;
  company: string;
  postedAt: string | null;
  /** The ATS posting behind the aggregator card, when the listing shows it. */
  originalUrl: string | null;
};

export type DiscoveredBoard = { ats: AtsKind; board: string; count: number };

/**
 * A board or listing could not be read. `browser`: bot protection or a page
 * that renders only in a browser; `not_found`: the board does not exist;
 * `failed`: network or server error.
 */
export class SourceError extends Error {
  constructor(
    readonly status: "browser" | "failed" | "not_found",
    message: string,
    readonly url?: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}
