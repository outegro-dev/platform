import { hirifyFromPage, wantapplyFromPage } from "./aggregators.js";
import {
  applyUrlFor,
  greenhouse,
  greenhouseBoardIn,
  type Trace,
} from "./ats.js";
import { isChallenge, isLoginWall, redirectedToList } from "./browser-only.js";
import { type AtsRef, aggregatorOf, isRippling } from "./detect.js";
import {
  findJobLike,
  jsonLdPostings,
  nextData,
  nuxtData,
  windowAssignments,
} from "./embedded.js";
import { companyFromHost, type Draft, finish } from "./fields.js";
import {
  type HtmlNode,
  htmlToText,
  metaContent,
  pageTitle,
  parseHtml,
} from "./html.js";
import type { Http, HttpResponse } from "./http.js";
import { jsonLdDraft } from "./jsonld.js";
import { joinParts, prettySlug, toRemote } from "./normalize.js";
import { cutHirify, cutTail, mainText } from "./readable.js";
import type { FetchResult } from "./types.js";

export type ExtractOptions = {
  /** The ATS posting the link points at, when known: fills ats, board, job id, apply link. */
  ref?: AtsRef | null;
};

/**
 * Vacancy fields from a page's HTML, without the network: aggregator
 * payloads, JSON-LD JobPosting, embedded app data (`__NEXT_DATA__`, Nuxt,
 * `window.__appData`), then the page's main text. The browser tier passes
 * rendered HTML here too.
 */
export function extractVacancyFromHtml(
  url: string,
  html: string,
  options: ExtractOptions = {},
): FetchResult {
  const root = parseHtml(html);
  const aggregator = aggregatorOf(url);
  if (aggregator === "hirify") {
    const result = hirifyFromPage(root, url);
    if (result) return result;
  }
  if (aggregator === "wantapply") {
    const result = wantapplyFromPage(root, url);
    if (result) return result;
  }
  const ref = options.ref ?? null;
  // On an ATS host the page names the ATS, not the company: the board slug does.
  const company = ref?.board ? prettySlug(ref.board) : siteName(root, url);
  const tagged = (draft: Draft): Draft =>
    ref
      ? {
          ...draft,
          provider: isRippling(ref) ? "rippling" : ref.ats,
          url: ref.postingUrl,
          ats: ref.ats,
          atsBoard: ref.board,
          atsJobId: ref.jobId,
          applyUrl: applyUrlFor(ref),
          company: draft.company ?? company,
        }
      : draft;

  let firstFailure: FetchResult | null = null;
  const attempt = (draft: Draft, source: string): FetchResult | null => {
    const result = finish(tagged(draft), "http", source);
    if (result.ok) return result;
    firstFailure ??= result;
    return null;
  };

  for (const posting of jsonLdPostings(root)) {
    if (typeof posting.description !== "string") continue;
    const result = attempt(jsonLdDraft(posting, url), "json-ld");
    if (result) return result;
  }

  const embedded: [unknown, string][] = [
    [nextData(root), "next-data"],
    [nuxtData(root), "nuxt-data"],
    ...windowAssignments(root).map((item): [unknown, string] => [
      item,
      "embedded-json",
    ]),
  ];
  for (const [data, source] of embedded) {
    if (data === undefined) continue;
    const job = findJobLike(data);
    if (!job) continue;
    const result = attempt(
      {
        provider: hostOf(url),
        url,
        title: job.title,
        company: job.company ?? company,
        location: job.location,
        remote: toRemote({ location: job.location }),
        postedAt: job.postedAt,
        text: joinParts(job.title, job.location, htmlToText(job.html)),
      },
      source,
    );
    if (result) return result;
  }

  const raw = mainText(root);
  const text = aggregator === "hirify" ? cutHirify(raw) : cutTail(raw);
  const title = pageTitle(root);
  const result = attempt(
    {
      provider: hostOf(url),
      url,
      title: title ? cleanTitle(title, root) : null,
      company,
      text,
    },
    "page-text",
  );
  return (
    result ??
    firstFailure ?? {
      ok: false,
      status: "browser",
      reason: "No vacancy on the page",
    }
  );
}

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

function siteName(root: HtmlNode, url: string): string {
  return metaContent(root, "og:site_name") ?? companyFromHost(url);
}

/** "Senior Engineer | Acme Careers" → "Senior Engineer" when the h1 is missing. */
function cleanTitle(title: string, root: HtmlNode): string {
  const site = metaContent(root, "og:site_name");
  const parts = title.split(/\s+[|–—-]\s+/);
  if (
    parts.length > 1 &&
    (site ? parts.some((part) => part.includes(site)) : true)
  )
    return parts[0] ?? title;
  return title;
}

/** The page step: one GET, protection and closure signals, then extraction. */
export async function pageTier(
  url: string,
  http: Http,
  trace: Trace,
  ref: AtsRef | null,
): Promise<FetchResult> {
  const response: HttpResponse =
    trace.page ?? (await http.get(url, { accept: "html" }));
  trace.page = response;
  if (isChallenge(response))
    return {
      ok: false,
      status: "browser",
      reason: `Bot protection on ${hostOf(response.url || url)} (HTTP ${response.status}); not bypassed, read it in a browser`,
    };
  if (response.status === 404 || response.status === 410)
    return {
      ok: false,
      status: "closed",
      reason: `The page answers ${response.status}: no vacancy`,
    };
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 429
  )
    return {
      ok: false,
      status: "browser",
      reason: `The page answers ${response.status}`,
    };
  if (response.status >= 400)
    return {
      ok: false,
      status: "failed",
      reason: `The page answers ${response.status}`,
    };
  if (redirectedToList(url, response.url))
    return {
      ok: false,
      status: "closed",
      reason: `Redirects to a list of jobs: ${response.url}`,
    };
  if (isLoginWall(response))
    return { ok: false, status: "browser", reason: "The page asks to sign in" };

  // A company page that embeds a Greenhouse board (gh_jid links).
  if (ref?.ats === "greenhouse" && !ref.board) {
    const board = greenhouseBoardIn(response.text);
    if (board) {
      const step = await greenhouse({ ...ref, board }, http, {
        apiStatus: null,
        notOnBoard: false,
      });
      if ("result" in step && step.result.ok)
        return {
          ...step.result,
          fields: { ...step.result.fields, url },
          source: "greenhouse-api(gh_jid)",
        };
    }
  }
  const result = extractVacancyFromHtml(response.url || url, response.text, {
    ref: ref?.ats === "greenhouse" && !ref.board ? null : ref,
  });
  if (!result.ok && trace.notOnBoard)
    return {
      ok: false,
      status: "closed",
      reason: "Job not on the Ashby board (closed?)",
    };
  return result;
}
