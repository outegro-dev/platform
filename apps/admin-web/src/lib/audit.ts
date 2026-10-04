import type { Page } from "./result";

/**
 * One timeline from several audit feeds (Identity, Notifications, Battleship,
 * Payments, Education). Each feed pages with its own opaque cursor, newest first; the
 * merged cursor keeps, per feed, the last cursor and how many items of that
 * page were already shown. Items are only emitted while every feed with
 * more data has been read at least that far back, so the order is exact.
 */

export const auditSources = [
  "identity",
  "notifications",
  "battleship",
  "payments",
  "education",
] as const;
export type AuditSource = (typeof auditSources)[number];

export type TimelineEntry = {
  source: AuditSource;
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type SourceState = { cursor: string | null; skip: number };
/** Per feed: where to continue; `false` once the feed is exhausted. */
export type MergeCursor = Partial<Record<AuditSource, SourceState | false>>;

export type Fetcher = (
  cursor: string | null,
  limit: number,
) => Promise<Page<TimelineEntry>>;

/** Feeds cap a page at 100 items; the skip is folded into the cursor early. */
const NORMALIZE_AT = 50;

export function encodeMergeCursor(cursor: MergeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeMergeCursor(value: string | undefined): MergeCursor {
  if (!value) return {};
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const result: MergeCursor = {};
    for (const source of auditSources) {
      const state = data?.[source];
      if (state === false) result[source] = false;
      else if (
        state &&
        (typeof state.cursor === "string" || state.cursor === null) &&
        Number.isInteger(state.skip) &&
        state.skip >= 0 &&
        state.skip < 100
      )
        result[source] = { cursor: state.cursor, skip: state.skip };
    }
    return result;
  } catch {
    return {};
  }
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** ISO timestamps of every feed share one format, so text order is time order. */
const newestFirst = (a: TimelineEntry, b: TimelineEntry) =>
  compare(b.createdAt, a.createdAt) ||
  compare(a.source, b.source) ||
  compare(b.id, a.id);

type Fetched = {
  source: AuditSource;
  state: SourceState;
  candidates: TimelineEntry[];
  exhausted: boolean;
  nextCursor: string | null;
};

async function read(
  source: AuditSource,
  fetch: Fetcher,
  start: SourceState,
  limit: number,
): Promise<Fetched> {
  let state = start;
  if (state.skip >= NORMALIZE_AT) {
    const skipped = await fetch(state.cursor, state.skip);
    if (!skipped.nextCursor)
      return {
        source,
        state,
        candidates: [],
        exhausted: true,
        nextCursor: null,
      };
    state = { cursor: skipped.nextCursor, skip: 0 };
  }
  const page = await fetch(state.cursor, state.skip + limit);
  return {
    source,
    state,
    candidates: page.items.slice(state.skip),
    exhausted: page.nextCursor === null,
    nextCursor: page.nextCursor,
  };
}

export async function mergePage(options: {
  sources: Partial<Record<AuditSource, Fetcher>>;
  cursor: MergeCursor;
  limit: number;
  /** Filters a feed cannot apply itself (applied to every feed; idempotent). */
  matches?: (entry: TimelineEntry) => boolean;
  /** A feed that does not exist yet (not an outage): skipped, not retried. */
  unsupported?: (error: unknown) => boolean;
}): Promise<{
  items: TimelineEntry[];
  next: MergeCursor | null;
  failed: AuditSource[];
  unsupported: AuditSource[];
}> {
  const limit = Math.min(options.limit, NORMALIZE_AT);
  const active = auditSources.filter(
    (source) => options.sources[source] && options.cursor[source] !== false,
  );
  const failed: AuditSource[] = [];
  const unsupported: AuditSource[] = [];
  const results = await Promise.all(
    active.map(async (source) => {
      const fetch = options.sources[source] as Fetcher;
      const start = (options.cursor[source] || {
        cursor: null,
        skip: 0,
      }) as SourceState;
      try {
        return await read(source, fetch, start, limit);
      } catch (error) {
        if (options.unsupported?.(error)) unsupported.push(source);
        else failed.push(source);
        return null;
      }
    }),
  );
  const fetched = results.filter((item): item is Fetched => item !== null);

  // Nothing older than the oldest item read from a feed with more data may
  // be shown yet: that feed could still have something newer.
  const boundary = fetched
    .filter((feed) => !feed.exhausted && feed.candidates.length > 0)
    .map((feed) => feed.candidates.at(-1)?.createdAt ?? "")
    .reduce((max, at) => (at > max ? at : max), "");

  const merged = fetched.flatMap((feed) => feed.candidates).sort(newestFirst);
  const consumed = new Map<AuditSource, number>();
  const items: TimelineEntry[] = [];
  for (const entry of merged) {
    if (items.length >= limit) break;
    if (boundary && entry.createdAt < boundary) break;
    consumed.set(entry.source, (consumed.get(entry.source) ?? 0) + 1);
    if (options.matches?.(entry) ?? true) items.push(entry);
  }

  const next: MergeCursor = {};
  let more = false;
  for (const source of auditSources) {
    const before = options.cursor[source];
    if (before === false) {
      next[source] = false;
      continue;
    }
    if (!options.sources[source]) continue;
    if (unsupported.includes(source)) {
      next[source] = false;
      continue;
    }
    const feed = fetched.find((item) => item.source === source);
    if (!feed) {
      // Failed this time: keep its place so a retry picks it up.
      if (before) next[source] = before;
      more = true;
      continue;
    }
    const used = consumed.get(source) ?? 0;
    if (used >= feed.candidates.length) {
      if (feed.exhausted) next[source] = false;
      else {
        next[source] = { cursor: feed.nextCursor, skip: 0 };
        more = true;
      }
    } else {
      next[source] = {
        cursor: feed.state.cursor,
        skip: feed.state.skip + used,
      };
      more = true;
    }
  }
  return { items, next: more ? next : null, failed, unsupported };
}
