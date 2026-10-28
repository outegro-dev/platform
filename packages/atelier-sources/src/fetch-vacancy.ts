import {
  type AdapterResult,
  ashby,
  greenhouse,
  lever,
  rippling,
  smartRecruiters,
  type Trace,
  workable,
  workday,
} from "./ats.js";
import { type AtsRef, isRippling, parseAtsUrl } from "./detect.js";
import {
  defaultHttp,
  type Http,
  HttpRequestError,
  type HttpResponse,
} from "./http.js";
import { pageTier } from "./page.js";
import type { FetchResult } from "./types.js";

/** Hosts a user-supplied link must never reach from a server. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return true;
  if (
    host === "::1" ||
    host === "::" ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host)
  )
    return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return !host.includes(".") && !host.includes(":");
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

type Adapter = (
  ref: AtsRef,
  http: Http,
  trace: Trace,
) => Promise<AdapterResult>;

function adapterFor(ref: AtsRef): Adapter | null {
  if (isRippling(ref)) return rippling;
  switch (ref.ats) {
    case "lever":
      return lever;
    case "greenhouse":
      return ref.board ? greenhouse : null;
    case "ashby":
      return ashby;
    case "workable":
      return workable;
    case "smartrecruiters":
      return smartRecruiters;
    case "workday":
      return workday;
    default:
      return null;
  }
}

export type Scrape = { result: FetchResult; trace: Trace };

/** fetchVacancy with what the steps learnt, for the liveness check. */
export async function scrape(
  link: string,
  http: Http,
  prefetched?: HttpResponse | null,
): Promise<Scrape> {
  const trace: Trace = { apiStatus: null, notOnBoard: false };
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return {
      result: { ok: false, status: "failed", reason: "Not a URL" },
      trace,
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return {
      result: {
        ok: false,
        status: "failed",
        reason: "Only http(s) links are read",
      },
      trace,
    };
  if (isPrivateHost(url.hostname))
    return {
      result: {
        ok: false,
        status: "failed",
        reason: "Private or local address",
      },
      trace,
    };
  url.hash = "";
  const ref = parseAtsUrl(url.href);
  try {
    const adapter = ref ? adapterFor(ref) : null;
    let note = "";
    if (ref && adapter) {
      const step = await adapter(ref, http, trace);
      if ("result" in step) return { result: step.result, trace };
      note = step.fallback;
    }
    const pageUrl = ref && adapter ? ref.postingUrl : url.href;
    if (prefetched && !trace.page && (pageUrl === link || pageUrl === url.href))
      trace.page = prefetched;
    const result = await pageTier(pageUrl, http, trace, ref);
    if (result.ok || !note) return { result, trace };
    // The API had no posting and the page has none either.
    if (
      result.status === "closed" ||
      (/ (404|410)$/.test(note) && trace.page?.status !== 200)
    )
      return {
        result: {
          ok: false,
          status: "closed",
          reason: `${note}; ${result.reason}`,
        },
        trace,
      };
    return {
      result: { ...result, reason: `${note}; ${result.reason}` },
      trace,
    };
  } catch (error) {
    const reason =
      error instanceof HttpRequestError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return { result: { ok: false, status: "failed", reason }, trace };
  }
}

/**
 * Reads one vacancy link: the ATS public API first (Lever and Lever EU,
 * Greenhouse and Greenhouse EU, Ashby with compensation, Workable v2 and
 * widget, SmartRecruiters, Workday cxs, Rippling), else the page (aggregator
 * payloads, JSON-LD, embedded app data, main text). Pages behind bot
 * protection, logins or JavaScript come back as `browser`; nothing is
 * bypassed.
 */
export async function fetchVacancy(
  url: string,
  http: Http = defaultHttp(),
): Promise<FetchResult> {
  return (await scrape(url, http)).result;
}
