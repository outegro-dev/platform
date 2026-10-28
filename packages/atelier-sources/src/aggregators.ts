import { isAtsLink, parseAtsUrl } from "./detect.js";
import { jsonLdPostings, nuxtData } from "./embedded.js";
import { type Draft, finish } from "./fields.js";
import {
  attr,
  byTag,
  findAll,
  findFirst,
  type HtmlNode,
  htmlToText,
  inlineText,
  links,
  pageTitle,
} from "./html.js";
import { jsonLdDraft } from "./jsonld.js";
import { joinParts, prettySlug, str, toIsoUtc, toSalary } from "./normalize.js";
import { cutHirify, cutTail, mainText } from "./readable.js";
import type { AggregatorPosting, FetchResult } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/* ---------- hirify.me ---------- */

/** hirify hides the company of "Plus" postings behind this placeholder. */
const HIDDEN = /^(?:%hirify_global%|no name|company hidden)$/i;

const hirifyCompany = (value: unknown): string | null => {
  const name = str(value);
  return name && !HIDDEN.test(name) ? name : null;
};

/** The ATS link of a hirify card or page (its `contacts`, else a link in the text). */
function hirifyOriginal(vacancy: Obj, html: string): string | null {
  for (const contact of arr(vacancy.contacts)) {
    if (!isObj(contact)) continue;
    const value = str(contact.value);
    if (contact.type === "url" && value && /^https?:\/\//.test(value))
      return value;
  }
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>)]+/g))
    if (isAtsLink(match[0])) return match[0];
  return null;
}

/** A vacancy page of hirify.me: the Nuxt payload holds the text, salary and format. */
export function hirifyFromPage(
  root: HtmlNode,
  url: string,
): FetchResult | null {
  const data = nuxtData(root);
  const store = isObj(data) && isObj(data.data) ? data.data : {};
  const vacancy = Object.entries(store).find(
    ([key, value]) =>
      key.startsWith("vacancy-") &&
      isObj(value) &&
      typeof value.text === "string",
  )?.[1] as Obj | undefined;
  if (!vacancy) {
    // Layout changed: the rendered page with hirify's own blocks cut off.
    const text = cutHirify(mainText(root));
    return finish(
      { provider: "hirify", url, title: pageTitle(root), company: null, text },
      "http",
      "hirify-page-text",
    );
  }
  if (vacancy.is_archived === true)
    return {
      ok: false,
      status: "closed",
      reason: "hirify marks the vacancy archived",
    };
  const html = String(vacancy.text ?? "");
  const company = hirifyCompany(vacancy.company_title);
  const original = hirifyOriginal(vacancy, html);
  const ref = original ? parseAtsUrl(original) : null;
  const formats = arr(vacancy.work_format).map(String);
  const regions = arr(vacancy.regions)
    .map((item) => (isObj(item) ? (str(item.name_en) ?? str(item.name)) : null))
    .filter(Boolean);
  const salary = isObj(vacancy.salary) ? vacancy.salary : {};
  const title = str(vacancy.original_title) ?? str(vacancy.title);
  const body = cutHirify(
    htmlToText(
      html
        .replace(
          /(^|>|[.!?]\s+)%hirify_global%/g,
          `$1${company ?? "The company"}`,
        )
        .replace(/%hirify_global%/g, company ?? "the company"),
    ),
  );
  const draft: Draft = {
    provider: "hirify",
    url,
    originalUrl: original,
    applyUrl:
      str(vacancy.apply_url) ??
      (ref ? applyFor(ref.postingUrl, ref.ats) : original),
    ats: ref?.ats ?? null,
    atsBoard: ref?.board ?? null,
    atsJobId: ref?.jobId ?? null,
    title,
    company: company ?? (ref?.board ? prettySlug(ref.board) : "Company hidden"),
    location:
      [regions.join(", "), formats.join("/")].filter(Boolean).join(" · ") ||
      null,
    remote: formats.includes("remote") ? true : formats.length ? false : null,
    postedAt: vacancy.created_at,
    salary: toSalary(
      salary.min,
      salary.max,
      salary.currency,
      salary.salary_period,
    ),
    text: joinParts(title, body),
  };
  return finish(draft, "http", "hirify-page");
}

const applyFor = (posting: string, ats: string) =>
  ats === "lever"
    ? `${posting}/apply`
    : ats === "ashby"
      ? `${posting}/application`
      : ats === "workable"
        ? `${posting.replace(/\/$/, "")}/apply/`
        : ats === "greenhouse"
          ? `${posting}#app`
          : posting;

/** Cards of a hirify listing page (home or a category) from its Nuxt payload. */
export function hirifyListing(root: HtmlNode): AggregatorPosting[] {
  const data = nuxtData(root);
  const out: AggregatorPosting[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const item = value as Obj;
    const slug = str(item.slug);
    const title = str(item.original_title) ?? str(item.title);
    if (slug && title && typeof item.id === "number" && /^\d+-/.test(slug)) {
      const url = `https://hirify.me/jobs/${slug}`;
      if (!seen.has(url) && item.is_archived !== true) {
        seen.add(url);
        out.push({
          url,
          title,
          company: hirifyCompany(item.company_title) ?? "",
          postedAt: toIsoUtc(item.created_at),
          originalUrl: hirifyOriginal(item, ""),
        });
      }
      return;
    }
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(data, 0);
  if (out.length) return out;
  // Without the payload: the rendered cards.
  for (const card of findAll(
    root,
    (node) =>
      node.name === "a" && /^\/jobs\/\d+-/.test(attr(node, "href") ?? ""),
  )) {
    const url = new URL(attr(card, "href") ?? "", "https://hirify.me").href;
    if (seen.has(url)) continue;
    seen.add(url);
    const heading = findFirst(card, byTag("h3", "h2"));
    const company = findFirst(card, (node) =>
      /\bcompany\b/.test(attr(node, "class") ?? ""),
    );
    out.push({
      url,
      title: heading ? inlineText(heading) : inlineText(card),
      company: hirifyCompany(company ? inlineText(company) : null) ?? "",
      postedAt: null,
      originalUrl: null,
    });
  }
  return out;
}

/* ---------- wantapply.com ---------- */

/**
 * A vacancy page of wantapply.com. Written from the provider description
 * (JSON-LD JobPosting, h1, links to the original ATS): plain HTTP gets a
 * Cloudflare challenge, so this parser reads pages the browser tier renders.
 */
export function wantapplyFromPage(
  root: HtmlNode,
  url: string,
): FetchResult | null {
  const original =
    links(root, url).find(
      (link) => !/wantapply\.com/i.test(link) && isAtsLink(link),
    ) ?? null;
  const ref = original ? parseAtsUrl(original) : null;
  const slugCompany = new URL(url).pathname.match(
    /-at-([a-z0-9-]+?)\/?$/i,
  )?.[1];
  const posting = jsonLdPostings(root).find(
    (item) => typeof item.description === "string",
  );
  const base = posting ? jsonLdDraft(posting, url) : null;
  const draft: Draft = {
    ...(base ?? { provider: "wantapply", url, text: "" }),
    provider: "wantapply",
    url,
    originalUrl: original,
    applyUrl: ref ? applyFor(ref.postingUrl, ref.ats) : original,
    ats: ref?.ats ?? null,
    atsBoard: ref?.board ?? null,
    atsJobId: ref?.jobId ?? null,
    title: base?.title ?? pageTitle(root),
    company: base?.company ?? (slugCompany ? prettySlug(slugCompany) : null),
    text: base?.text || cutTail(mainText(root)),
  };
  return finish(
    draft,
    "http",
    posting ? "wantapply-json-ld" : "wantapply-page-text",
  );
}

/** Cards of a wantapply listing: links of the form /<role>-at-<company>. */
export function wantapplyListing(
  root: HtmlNode,
  base = "https://wantapply.com/",
): AggregatorPosting[] {
  const out = new Map<string, AggregatorPosting>();
  for (const anchor of findAll(root, byTag("a"))) {
    const href = attr(anchor, "href") ?? "";
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/(^|\.)wantapply\.com$/i.test(url.hostname)) continue;
    const slug = url.pathname.match(/^\/([a-z0-9-]+)-at-([a-z0-9-]+)\/?$/i);
    if (!slug?.[1] || !slug[2]) continue;
    const link = `https://wantapply.com${url.pathname.replace(/\/$/, "")}`;
    if (out.has(link)) continue;
    const card = anchor.parent ?? anchor;
    const heading =
      findFirst(anchor, byTag("h2", "h3", "h4")) ??
      findFirst(card, byTag("h2", "h3", "h4"));
    const time = findFirst(card, byTag("time"));
    out.set(link, {
      url: link,
      title:
        (heading ? inlineText(heading) : inlineText(anchor)) ||
        prettySlug(slug[1]),
      company: prettySlug(slug[2]),
      postedAt: toIsoUtc(time ? attr(time, "datetime") : null),
      originalUrl: null,
    });
  }
  return [...out.values()];
}
