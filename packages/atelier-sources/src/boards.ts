import type { AtsKind } from "@outegro/contracts/atelier";
import { hirifyListing, wantapplyListing } from "./aggregators.js";
import { greenhouseApi } from "./ats.js";
import { isChallenge } from "./browser-only.js";
import { parseHtml } from "./html.js";
import { defaultHttp, type Http, type HttpResponse, json } from "./http.js";
import { str, toIsoUtc, toRemote } from "./normalize.js";
import {
  type AggregatorPosting,
  type AggregatorSource,
  type BoardPosting,
  type DiscoveredBoard,
  SourceError,
} from "./types.js";

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const enc = encodeURIComponent;

export type BoardAts =
  | "lever"
  | "greenhouse"
  | "ashby"
  | "workable"
  | "smartrecruiters";
export const boardAts: BoardAts[] = [
  "lever",
  "greenhouse",
  "ashby",
  "workable",
  "smartrecruiters",
];

async function getBoard(http: Http, url: string): Promise<HttpResponse> {
  const response = await http.get(url, { accept: "json" });
  if (isChallenge(response))
    throw new SourceError("browser", `Bot protection at ${url}`, url);
  if (response.status === 404 || response.status === 410)
    throw new SourceError("not_found", `No board at ${url}`, url);
  if (response.status >= 400)
    throw new SourceError("failed", `HTTP ${response.status} at ${url}`, url);
  return response;
}

const posting = (
  ats: AtsKind,
  board: string,
  item: {
    title: string | null;
    location: string | null;
    remote: boolean | null;
    url: string | null;
    jobId: string | null;
    updatedAt: unknown;
    department: string | null;
  },
): BoardPosting | null =>
  item.title && item.url && item.jobId
    ? {
        title: item.title,
        location: item.location,
        remote: item.remote,
        url: item.url,
        ats,
        board,
        jobId: item.jobId,
        updatedAt: toIsoUtc(item.updatedAt),
        department: item.department,
      }
    : null;

async function lever(board: string, http: Http): Promise<BoardPosting[]> {
  const eu = board.startsWith("eu:");
  const slug = board.replace(/^eu:/, "");
  let response: HttpResponse;
  try {
    response = await getBoard(
      http,
      `https://api${eu ? ".eu" : ""}.lever.co/v0/postings/${enc(slug)}?mode=json`,
    );
  } catch (error) {
    // EU boards live on their own host.
    if (eu || !(error instanceof SourceError) || error.status !== "not_found")
      throw error;
    response = await getBoard(
      http,
      `https://api.eu.lever.co/v0/postings/${enc(slug)}?mode=json`,
    );
  }
  return arr(json(response)).flatMap((value) => {
    const job = obj(value);
    const categories = obj(job.categories);
    const location = str(categories.location);
    const workplace = str(job.workplaceType);
    const item = posting("lever", slug, {
      title: str(job.text),
      location,
      remote: toRemote({
        workplace: workplace === "unspecified" ? null : workplace,
        location,
      }),
      url: str(job.hostedUrl),
      jobId: str(job.id),
      updatedAt: job.createdAt,
      department: str(categories.department) ?? str(categories.team),
    });
    return item ? [item] : [];
  });
}

async function greenhouse(board: string, http: Http): Promise<BoardPosting[]> {
  const response = await getBoard(http, `${greenhouseApi}/${enc(board)}/jobs`);
  return arr(obj(json(response)).jobs).flatMap((value) => {
    const job = obj(value);
    const location = str(obj(job.location).name);
    const item = posting("greenhouse", board, {
      title: str(job.title),
      location,
      remote: toRemote({ location }),
      url: str(job.absolute_url),
      jobId: job.id === undefined ? null : String(job.id),
      updatedAt: job.updated_at ?? job.first_published,
      department: str(obj(arr(job.departments)[0]).name),
    });
    return item ? [item] : [];
  });
}

async function ashby(board: string, http: Http): Promise<BoardPosting[]> {
  const response = await getBoard(
    http,
    `https://api.ashbyhq.com/posting-api/job-board/${enc(board)}`,
  );
  return arr(obj(json(response)).jobs).flatMap((value) => {
    const job = obj(value);
    if (job.isListed === false) return [];
    const location =
      [
        str(job.location),
        ...arr(job.secondaryLocations).map((item) => str(obj(item).location)),
      ]
        .filter(Boolean)
        .join("; ") || null;
    const item = posting("ashby", board, {
      title: str(job.title),
      location,
      remote: toRemote({
        workplace: str(job.workplaceType),
        flag: job.isRemote === true ? true : null,
        location,
      }),
      url: str(job.jobUrl),
      jobId: str(job.id),
      updatedAt: job.publishedAt,
      department: str(job.department) ?? str(job.team),
    });
    return item ? [item] : [];
  });
}

async function workable(board: string, http: Http): Promise<BoardPosting[]> {
  const response = await getBoard(
    http,
    `https://apply.workable.com/api/v1/widget/accounts/${enc(board)}`,
  );
  // The widget lists a job once per location: one posting, locations joined.
  const byCode = new Map<string, BoardPosting>();
  for (const value of arr(obj(json(response)).jobs)) {
    const job = obj(value);
    const code = str(job.shortcode)?.toUpperCase() ?? null;
    const location =
      [str(job.city), str(job.state), str(job.country)]
        .filter(Boolean)
        .join(", ") || null;
    const known = code ? byCode.get(code) : undefined;
    if (known) {
      if (location && !known.location?.includes(location))
        known.location = known.location
          ? `${known.location}; ${location}`
          : location;
      continue;
    }
    const item = posting("workable", board, {
      title: str(job.title),
      location,
      remote: toRemote({
        flag: job.telecommuting === true ? true : null,
        location,
      }),
      url: code ? `https://apply.workable.com/${board}/j/${code}/` : null,
      jobId: code,
      updatedAt: job.published_on ?? job.created_at,
      department: str(job.department),
    });
    if (item && code) byCode.set(code, item);
  }
  return [...byCode.values()];
}

async function smartRecruiters(
  board: string,
  http: Http,
): Promise<BoardPosting[]> {
  const out: BoardPosting[] = [];
  const limit = 100;
  // Five pages at most: 500 postings.
  for (let page = 0; page < 5; page++) {
    const response = await getBoard(
      http,
      `https://api.smartrecruiters.com/v1/companies/${enc(board)}/postings?limit=${limit}&offset=${page * limit}`,
    );
    const data = obj(json(response));
    const content = arr(data.content);
    for (const value of content) {
      const job = obj(value);
      const place = obj(job.location);
      const location =
        str(place.fullLocation) ??
        ([str(place.city), str(place.country)].filter(Boolean).join(", ") ||
          null);
      const id = str(job.id);
      const item = posting("smartrecruiters", board, {
        title: str(job.name),
        location,
        remote: toRemote({
          workplace:
            place.remote === true
              ? "remote"
              : place.hybrid === true
                ? "hybrid"
                : null,
          flag: typeof place.remote === "boolean" ? place.remote : null,
          location,
        }),
        url: id ? `https://jobs.smartrecruiters.com/${board}/${id}` : null,
        jobId: id,
        updatedAt: job.releasedDate,
        department: str(obj(job.department).label),
      });
      if (item) out.push(item);
    }
    const total = typeof data.totalFound === "number" ? data.totalFound : 0;
    if (content.length < limit || out.length >= total) break;
  }
  return out;
}

/**
 * Open postings of one ATS board through its public API. A Lever board
 * missing on the US host is looked up on the EU host (`eu:<slug>` goes
 * there directly); Greenhouse serves EU boards from the same API. Throws
 * `SourceError` (`not_found`, `failed`, `browser`).
 */
export async function listBoard(
  ats: AtsKind,
  board: string,
  http: Http = defaultHttp(),
): Promise<BoardPosting[]> {
  switch (ats) {
    case "lever":
      return lever(board, http);
    case "greenhouse":
      return greenhouse(board, http);
    case "ashby":
      return ashby(board, http);
    case "workable":
      return workable(board, http);
    case "smartrecruiters":
      return smartRecruiters(board, http);
    default:
      throw new SourceError("failed", `listBoard does not support ${ats}`);
  }
}

const legalSuffix =
  /^(?:inc|incorporated|ltd|limited|llc|llp|plc|gmbh|ag|sa|sas|srl|sl|bv|nv|oy|ab|as|aps|corp|corporation|co|company|pte|pty|spa|kft|ооо|ао)$/i;
const descriptiveSuffix =
  /^(?:labs?|technologies|technology|tech|software|group|hq|io|ai|app|apps|holdings?|solutions|systems|studio|studios|digital|global|international|careers|jobs|team)$/i;

/** Slugs a company may use on ATS boards: "Acme Labs, Inc." → acmelabs, acme-labs, acme. */
export function companySlugVariants(company: string): string[] {
  const words = company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\.(com|io|ai|co|dev|app)\b/g, " $1")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const named = words.filter((word) => !legalSuffix.test(word));
  let core = [...named];
  while (core.length > 1 && descriptiveSuffix.test(core.at(-1) ?? ""))
    core = core.slice(0, -1);
  const variants = [
    named.join(""),
    named.join("-"),
    core.join(""),
    core.join("-"),
    words.join(""),
  ].filter((slug) => slug.length >= 2);
  return [...new Set(variants)].slice(0, 5);
}

async function countBoard(
  ats: BoardAts,
  slug: string,
  http: Http,
): Promise<{ board: string; count: number } | null> {
  try {
    switch (ats) {
      case "lever": {
        const us = await http.get(
          `https://api.lever.co/v0/postings/${enc(slug)}?mode=json&limit=100`,
          { accept: "json" },
        );
        if (us.status === 200)
          return { board: slug, count: arr(json(us)).length };
        if (us.status !== 404) return null;
        const eu = await http.get(
          `https://api.eu.lever.co/v0/postings/${enc(slug)}?mode=json&limit=100`,
          { accept: "json" },
        );
        return eu.status === 200
          ? { board: slug, count: arr(json(eu)).length }
          : null;
      }
      case "greenhouse": {
        const response = await http.get(`${greenhouseApi}/${enc(slug)}/jobs`, {
          accept: "json",
        });
        return response.status === 200
          ? { board: slug, count: arr(obj(json(response)).jobs).length }
          : null;
      }
      case "ashby": {
        const response = await http.get(
          `https://api.ashbyhq.com/posting-api/job-board/${enc(slug)}`,
          { accept: "json" },
        );
        return response.status === 200
          ? { board: slug, count: arr(obj(json(response)).jobs).length }
          : null;
      }
      case "workable": {
        const response = await http.get(
          `https://apply.workable.com/api/v1/widget/accounts/${enc(slug)}`,
          { accept: "json" },
        );
        return response.status === 200
          ? { board: slug, count: arr(obj(json(response)).jobs).length }
          : null;
      }
      case "smartrecruiters": {
        const response = await http.get(
          `https://api.smartrecruiters.com/v1/companies/${enc(slug)}/postings?limit=1`,
          { accept: "json" },
        );
        const total = obj(json(response)).totalFound;
        return response.status === 200 && typeof total === "number"
          ? { board: slug, count: total }
          : null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Which public ATS boards a company has: slug variants of its name probed
 * on Lever (US and EU), Greenhouse, Ashby, Workable and SmartRecruiters.
 * Only boards with at least one open posting are returned; each ATS stops
 * at its first hit. Requests to different ATS run in parallel.
 */
export async function discoverBoards(
  company: string,
  http: Http = defaultHttp(),
): Promise<DiscoveredBoard[]> {
  const variants = companySlugVariants(company);
  const found = await Promise.all(
    boardAts.map(async (ats): Promise<DiscoveredBoard | null> => {
      for (const slug of variants) {
        const hit = await countBoard(ats, slug, http);
        if (hit && hit.count > 0)
          return { ats, board: hit.board, count: hit.count };
      }
      return null;
    }),
  );
  return found.filter((item): item is DiscoveredBoard => item !== null);
}

/** hirify listing pages for software roles; its robots.txt disallows `?page=` and `/api/`. */
export const hirifyCategories = [
  "frontend-dev-jobs",
  "backend-dev-jobs",
  "fullstack-dev-jobs",
  "ai-engineering-jobs",
  "web-dev-jobs",
  "",
];

export type DiscoverAggregatorOptions = {
  /** Listing pages to read: hirify categories in the order above, wantapply pages. Default 4 and 2. */
  pages?: number;
  /** Kept when the title contains it, case-insensitively. */
  query?: string;
  /** Pause between two requests; 2 s by default (1 request / 2 s). */
  intervalMs?: number;
};

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fresh postings from aggregator listing pages without logging in:
 * hirify.me software categories (the Nuxt payload: title, company unless
 * hidden, created date and often the original ATS link) and wantapply.com.
 * wantapply answers plain HTTP with a Cloudflare challenge, which is not
 * bypassed: `SourceError("browser")`.
 */
export async function discoverAggregator(
  source: AggregatorSource,
  options: DiscoverAggregatorOptions = {},
  http: Http = defaultHttp(),
): Promise<AggregatorPosting[]> {
  const interval = options.intervalMs ?? 2000;
  const urls =
    source === "hirify"
      ? hirifyCategories
          .slice(0, Math.max(1, options.pages ?? 4))
          .map((path) => `https://hirify.me/${path}`)
      : Array.from({ length: Math.max(1, options.pages ?? 2) }, (_, index) =>
          index === 0
            ? "https://wantapply.com/"
            : `https://wantapply.com/?page=${index + 1}`,
        );
  const out = new Map<string, AggregatorPosting>();
  for (const [index, url] of urls.entries()) {
    if (index > 0 && interval > 0) await pause(interval);
    let response: HttpResponse;
    try {
      response = await http.get(url, { accept: "html" });
    } catch (error) {
      throw new SourceError(
        "failed",
        error instanceof Error ? error.message : String(error),
        url,
      );
    }
    if (isChallenge(response))
      throw new SourceError(
        "browser",
        `${new URL(url).hostname} answers with bot protection (HTTP ${response.status}); not bypassed`,
        url,
      );
    if (response.status >= 400)
      throw new SourceError("failed", `HTTP ${response.status} at ${url}`, url);
    const root = parseHtml(response.text);
    const cards =
      source === "hirify"
        ? hirifyListing(root)
        : wantapplyListing(root, response.url || url);
    for (const card of cards) {
      const known = out.get(card.url);
      if (!known) out.set(card.url, card);
      else known.originalUrl ??= card.originalUrl;
    }
    if (source === "wantapply" && cards.length === 0) break;
  }
  const query = options.query?.trim().toLowerCase();
  const items = [...out.values()];
  const filtered = query
    ? items.filter((item) => item.title.toLowerCase().includes(query))
    : items;
  return filtered.sort((a, b) =>
    (b.postedAt ?? "").localeCompare(a.postedAt ?? ""),
  );
}
