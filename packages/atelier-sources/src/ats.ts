import type { AtsRef } from "./detect.js";
import { type Draft, finish } from "./fields.js";
import { htmlToText, tidy } from "./html.js";
import { type Http, type HttpResponse, json } from "./http.js";
import {
  joinInline,
  joinParts,
  prettySlug,
  str,
  toRemote,
  toSalary,
} from "./normalize.js";
import type { FetchResult } from "./types.js";

/** What the API step learnt, for the page step and the liveness check. */
export type Trace = {
  apiStatus: number | null;
  /** The board answered but no longer lists the posting. */
  notOnBoard: boolean;
  /** A page response an adapter already fetched. */
  page?: HttpResponse;
};

export type AdapterResult = { result: FetchResult } | { fallback: string };

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const obj = (value: unknown): Obj => (isObj(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const enc = encodeURIComponent;

const failed = (reason: string): AdapterResult => ({
  result: { ok: false, status: "failed", reason },
});

/** Where the application form of a posting is. */
export function applyUrlFor(ref: AtsRef): string | null {
  const base = ref.postingUrl.replace(/\/$/, "");
  switch (ref.ats) {
    case "lever":
      return `${base}/apply`;
    case "ashby":
      return `${base}/application`;
    case "greenhouse":
      return ref.board ? `${base}#app` : base;
    case "workable":
      return `${base}/apply/`;
    case "workday":
      return `${base}/apply`;
    case "smartrecruiters":
    case "personio":
    case "teamtailor":
    case "comeet":
      return base;
    default:
      return ref.host === "rippling" ? `${base}/apply` : null;
  }
}

async function api(
  http: Http,
  url: string,
  trace: Trace,
): Promise<{ status: number; data: unknown }> {
  const response = await http.get(url, { accept: "json" });
  trace.apiStatus = response.status;
  return { status: response.status, data: json(response) };
}

const section = (heading: unknown, html: unknown) => {
  const body = typeof html === "string" ? htmlToText(html) : "";
  if (!body) return "";
  const title = str(heading);
  return title ? `${title}\n${body}` : body;
};

/* ---------- Lever ---------- */

const leverApi = (region: "us" | "eu") =>
  `https://api${region === "eu" ? ".eu" : ""}.lever.co/v0/postings`;

export async function lever(
  ref: AtsRef,
  http: Http,
  trace: Trace,
): Promise<AdapterResult> {
  const { status, data } = await api(
    http,
    `${leverApi(ref.region)}/${enc(ref.board ?? "")}/${ref.jobId}`,
    trace,
  );
  // An unlisted posting is missing from the API but its own page still shows it.
  if (status === 404 || status === 410)
    return { fallback: `Lever API ${status}` };
  if (status >= 400) return failed(`Lever API HTTP ${status}`);
  if (!isObj(data) || typeof data.text !== "string")
    return failed("Lever API returned no posting");
  return { result: leverFields(data, ref) };
}

export function leverFields(job: Obj, ref: AtsRef): FetchResult {
  const categories = obj(job.categories);
  const allLocations = arr(categories.allLocations).filter(
    (item): item is string => typeof item === "string",
  );
  const location =
    str(categories.location) ?? (allLocations.join("; ") || null);
  const workplace = str(job.workplaceType);
  const range = obj(job.salaryRange);
  const lists = arr(job.lists).map((list) => {
    const item = obj(list);
    return section(item.text, `<ul>${String(item.content ?? "")}</ul>`);
  });
  const hosted = str(job.hostedUrl) ?? ref.postingUrl;
  const draft: Draft = {
    provider: "lever",
    url: hosted,
    applyUrl: str(job.applyUrl) ?? `${hosted}/apply`,
    ats: "lever",
    atsBoard: ref.board,
    atsJobId: str(job.id) ?? ref.jobId,
    title: str(job.text),
    company: prettySlug(ref.board ?? ""),
    location,
    remote: toRemote({
      workplace: workplace === "unspecified" ? null : workplace,
      location,
    }),
    postedAt: job.createdAt,
    salary: toSalary(range.min, range.max, range.currency, range.interval),
    text: joinParts(
      str(job.text),
      joinInline(
        location,
        str(categories.commitment),
        str(categories.team),
        workplace === "unspecified" ? null : workplace,
      ),
      htmlToText(String(job.description ?? "")) || str(job.descriptionPlain),
      ...lists,
      htmlToText(String(job.additional ?? "")),
    ),
  };
  return finish(draft, "api", "lever-api");
}

/* ---------- Greenhouse ---------- */

export const greenhouseApi = "https://boards-api.greenhouse.io/v1/boards";

export async function greenhouse(
  ref: AtsRef,
  http: Http,
  trace: Trace,
): Promise<AdapterResult> {
  if (!ref.board)
    return { fallback: "Greenhouse board is named only on the page" };
  const { status, data } = await api(
    http,
    `${greenhouseApi}/${enc(ref.board)}/jobs/${ref.jobId}?pay_transparency=true`,
    trace,
  );
  if (status === 404 || status === 410)
    return { fallback: `Greenhouse API ${status}` };
  if (status >= 400) return failed(`Greenhouse API HTTP ${status}`);
  if (!isObj(data) || typeof data.title !== "string")
    return failed("Greenhouse API returned no job");
  return { result: greenhouseFields(data, ref) };
}

export function greenhouseFields(job: Obj, ref: AtsRef): FetchResult {
  const location = str(obj(job.location).name);
  const absolute = str(job.absolute_url);
  const onGreenhouse = absolute ? /greenhouse\.io\//i.test(absolute) : false;
  const board = ref.board ?? "";
  const canonical = `https://job-boards${ref.region === "eu" || /\.eu\.greenhouse/.test(absolute ?? "") ? ".eu" : ""}.greenhouse.io/${board}/jobs/${ref.jobId}`;
  // The form sits under the posting on Greenhouse's own board (#app).
  const formPage = onGreenhouse && absolute ? absolute : canonical;
  const pay = obj(arr(job.pay_input_ranges)[0]);
  const cents = (value: unknown) =>
    typeof value === "number" ? value / 100 : value;
  const departments = arr(job.departments)
    .map((item) => str(obj(item).name))
    .filter(Boolean);
  const draft: Draft = {
    provider: "greenhouse",
    url: absolute ?? canonical,
    applyUrl: `${formPage.replace(/#.*$/, "")}#app`,
    ats: "greenhouse",
    atsBoard: board || null,
    atsJobId: String(job.id ?? ref.jobId),
    title: str(job.title),
    company: str(job.company_name) ?? prettySlug(board),
    location,
    remote: toRemote({ location }),
    postedAt: job.first_published ?? job.updated_at,
    salary: Object.keys(pay).length
      ? toSalary(
          cents(pay.min_cents),
          cents(pay.max_cents),
          pay.currency_type,
          pay.title,
          "year",
        )
      : null,
    text: joinParts(
      str(job.title),
      joinInline(location, departments.join(", ") || null),
      htmlToText(String(job.content ?? "")),
    ),
  };
  return finish(draft, "api", "greenhouse-api");
}

/** The Greenhouse board token behind a company page that embeds one (gh_jid links). */
export function greenhouseBoardIn(html: string): string | null {
  const patterns = [
    /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([A-Za-z0-9_-]+)/,
    /greenhouse\.io\/embed\/job_app\?(?:[^"'\s]*&)?for=([A-Za-z0-9_-]+)/,
    /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/,
    /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const board = html.match(pattern)?.[1];
    if (board && board !== "embed" && board !== "v1") return board;
  }
  return null;
}

/* ---------- Ashby ---------- */

export async function ashby(
  ref: AtsRef,
  http: Http,
  trace: Trace,
): Promise<AdapterResult> {
  const { status, data } = await api(
    http,
    `https://api.ashbyhq.com/posting-api/job-board/${enc(ref.board ?? "")}?includeCompensation=true`,
    trace,
  );
  if (status === 404 || status === 410)
    return { fallback: `Ashby API ${status}` };
  if (status >= 400) return failed(`Ashby API HTTP ${status}`);
  const job = arr(obj(data).jobs)
    .map(obj)
    .find((item) => String(item.id).toLowerCase() === ref.jobId);
  if (!job) {
    trace.notOnBoard = true;
    return { fallback: "Job not on the Ashby board (closed?)" };
  }
  return { result: ashbyFields(job, ref) };
}

export function ashbySalary(job: Obj) {
  const compensation = obj(job.compensation);
  const components = arr(compensation.summaryComponents).map(obj);
  const salary = components.find((item) =>
    /salary/i.test(String(item.compensationType ?? item.componentType ?? "")),
  );
  if (!salary) return null;
  return toSalary(
    salary.minValue,
    salary.maxValue,
    salary.currencyCode,
    salary.interval,
  );
}

export function ashbyFields(job: Obj, ref: AtsRef): FetchResult {
  const secondary = arr(job.secondaryLocations)
    .map((item) => str(obj(item).location) ?? str(item))
    .filter(Boolean);
  const location =
    [str(job.location), ...secondary].filter(Boolean).join("; ") || null;
  const posting = str(job.jobUrl) ?? ref.postingUrl;
  const workplace = str(job.workplaceType);
  const draft: Draft = {
    provider: "ashby",
    url: posting,
    applyUrl: str(job.applyUrl) ?? `${posting}/application`,
    ats: "ashby",
    atsBoard: ref.board,
    atsJobId: ref.jobId,
    title: str(job.title),
    company: prettySlug(ref.board ?? ""),
    location,
    remote: toRemote({
      workplace,
      flag: job.isRemote === true ? true : null,
      location,
    }),
    postedAt: job.publishedAt,
    salary: ashbySalary(job),
    text: joinParts(
      str(job.title),
      joinInline(
        location,
        str(job.employmentType),
        workplace,
        str(obj(job.compensation).compensationTierSummary),
      ),
      htmlToText(String(job.descriptionHtml ?? "")) ||
        tidy(String(job.descriptionPlain ?? "")),
    ),
  };
  return finish(draft, "api", "ashby-api");
}

/* ---------- Workable ---------- */

export async function workable(
  ref: AtsRef,
  http: Http,
  trace: Trace,
): Promise<AdapterResult> {
  const account = enc(ref.board ?? "");
  const { status, data } = await api(
    http,
    `https://apply.workable.com/api/v2/accounts/${account}/jobs/${ref.jobId}`,
    trace,
  );
  if (status < 400 && isObj(data) && typeof data.title === "string")
    return { result: workableV2Fields(data, ref) };
  if (status >= 500) return failed(`Workable API HTTP ${status}`);
  // Workable renders postings in the browser; the company's published list carries their text.
  const widget = await api(
    http,
    `https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`,
    trace,
  );
  if (widget.status === 404 || widget.status === 410)
    return {
      result: {
        ok: false,
        status: "closed",
        reason: "The Workable account no longer publishes jobs",
      },
    };
  if (widget.status >= 400)
    return failed(`Workable widget HTTP ${widget.status}`);
  const board = obj(widget.data);
  const job = arr(board.jobs)
    .map(obj)
    .find((item) => String(item.shortcode).toUpperCase() === ref.jobId);
  if (!job) {
    trace.notOnBoard = true;
    return {
      result: {
        ok: false,
        status: "closed",
        reason: "Job not on the Workable board (closed?)",
      },
    };
  }
  return { result: workableWidgetFields(job, str(board.name), ref) };
}

const workableWorkplace = (value: unknown) => {
  const text = String(value ?? "").toLowerCase();
  return text === "on_site" ? "onsite" : text || null;
};

export function workableV2Fields(job: Obj, ref: AtsRef): FetchResult {
  const place = obj(job.location);
  const location =
    [str(place.city), str(place.region), str(place.country)]
      .filter(Boolean)
      .join(", ") || null;
  const workplace = workableWorkplace(job.workplace);
  const draft: Draft = {
    provider: "workable",
    url: ref.postingUrl,
    applyUrl: `${ref.postingUrl.replace(/\/$/, "")}/apply/`,
    ats: "workable",
    atsBoard: ref.board,
    atsJobId: ref.jobId,
    title: str(job.title),
    company:
      str(obj(job.account).name) ??
      str(job.company) ??
      prettySlug(ref.board ?? ""),
    location,
    remote: toRemote({
      workplace,
      flag: job.remote === true ? true : null,
      location,
    }),
    postedAt: job.published ?? job.created,
    salary: toSalary(
      job.salary_from,
      job.salary_to,
      job.salary_currency_iso_code ?? job.salary_currency,
      job.salary_frequency,
      "year",
    ),
    text: joinParts(
      str(job.title),
      joinInline(location, workplace, str(job.type)),
      htmlToText(String(job.description ?? "")),
      section("Requirements", job.requirements),
      section("Benefits", job.benefits),
    ),
  };
  return finish(draft, "api", "workable-api");
}

export function workableWidgetFields(
  job: Obj,
  company: string | null,
  ref: AtsRef,
): FetchResult {
  const location =
    [str(job.city), str(job.state), str(job.country)]
      .filter(Boolean)
      .join(", ") || null;
  const draft: Draft = {
    provider: "workable",
    url: ref.postingUrl,
    applyUrl: `${ref.postingUrl.replace(/\/$/, "")}/apply/`,
    ats: "workable",
    atsBoard: ref.board,
    atsJobId: ref.jobId,
    title: str(job.title),
    company: company ?? prettySlug(ref.board ?? ""),
    location,
    remote: toRemote({
      flag: job.telecommuting === true ? true : null,
      location,
    }),
    postedAt: job.published_on ?? job.created_at,
    salary: null,
    text: joinParts(
      str(job.title),
      joinInline(
        location,
        job.telecommuting === true ? "Remote" : null,
        str(job.employment_type),
      ),
      htmlToText(String(job.description ?? "")),
    ),
  };
  return finish(draft, "api", "workable-widget");
}

/* ---------- SmartRecruiters ---------- */

export async function smartRecruiters(
  ref: AtsRef,
  http: Http,
  trace: Trace,
): Promise<AdapterResult> {
  const { status, data } = await api(
    http,
    `https://api.smartrecruiters.com/v1/companies/${enc(ref.board ?? "")}/postings/${enc(ref.jobId)}`,
    trace,
  );
  if (status === 404 || status === 410)
    return { fallback: `SmartRecruiters API ${status}` };
  if (status >= 400) return failed(`SmartRecruiters API HTTP ${status}`);
  if (!isObj(data) || typeof data.name !== "string")
    return failed("SmartRecruiters API returned no posting");
  return { result: smartRecruitersFields(data, ref) };
}

export function smartRecruitersFields(job: Obj, ref: AtsRef): FetchResult {
  const place = obj(job.location);
  const location =
    str(place.fullLocation) ??
    ([str(place.city), str(place.region), str(place.country)]
      .filter(Boolean)
      .join(", ") ||
      null);
  const sections = obj(obj(job.jobAd).sections);
  const order = [
    "companyDescription",
    "jobDescription",
    "qualifications",
    "additionalInformation",
  ];
  const id = str(job.id) ?? ref.jobId;
  const posting =
    str(job.postingUrl) ??
    `https://jobs.smartrecruiters.com/${ref.board}/${id}`;
  const draft: Draft = {
    provider: "smartrecruiters",
    url: posting,
    applyUrl: str(job.applyUrl) ?? posting,
    ats: "smartrecruiters",
    atsBoard: str(obj(job.company).identifier) ?? ref.board,
    atsJobId: id,
    title: str(job.name),
    company: str(obj(job.company).name) ?? prettySlug(ref.board ?? ""),
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
    postedAt: job.releasedDate,
    salary: null,
    text: joinParts(
      str(job.name),
      joinInline(
        location,
        str(obj(job.typeOfEmployment).label),
        str(obj(job.experienceLevel).label),
      ),
      ...order.map((key) => {
        const item = obj(sections[key]);
        return section(item.title, item.text);
      }),
    ),
  };
  return finish(draft, "api", "smartrecruiters-api");
}

/* ---------- Workday ---------- */

export async function workday(
  ref: AtsRef,
  http: Http,
  trace: Trace,
): Promise<AdapterResult> {
  const host = ref.host ?? "";
  const tenants = [
    ...new Set([ref.board ?? "", (ref.board ?? "").replace(/-/g, "_")]),
  ].filter(Boolean);
  const tryTenant = async (tenant: string, site: string) => {
    const { status, data } = await api(
      http,
      `https://${host}/wday/cxs/${tenant}/${site}/job/${ref.path}`,
      trace,
    );
    return {
      status,
      info: obj(obj(data).jobPostingInfo),
      data: obj(data),
      tenant,
    };
  };
  let found: Awaited<ReturnType<typeof tryTenant>> | null = null;
  for (const tenant of tenants) {
    const attempt = await tryTenant(tenant, ref.site ?? "");
    if (attempt.status < 400 && attempt.info.title) {
      found = attempt;
      break;
    }
    if (attempt.status >= 500)
      return failed(`Workday API HTTP ${attempt.status}`);
  }
  if (!found) {
    // The tenant is not always the host name; the page names it.
    const page = await http.get(ref.postingUrl, { accept: "html" });
    trace.page = page;
    const tenant = page.text.match(/tenant:\s*"([^"]+)"/)?.[1];
    const site = page.text.match(/siteId:\s*"([^"]+)"/)?.[1] ?? ref.site ?? "";
    if (tenant && !tenants.includes(tenant)) {
      const attempt = await tryTenant(tenant, site);
      if (attempt.status < 400 && attempt.info.title) found = attempt;
    }
  }
  if (!found) return { fallback: `Workday API HTTP ${trace.apiStatus}` };
  const { info, data, tenant } = found;
  if (info.posted === false)
    return {
      result: {
        ok: false,
        status: "closed",
        reason: "Workday no longer posts this job",
      },
    };
  const location = str(info.location);
  const additional = arr(info.additionalLocations).filter(
    (item): item is string => typeof item === "string",
  );
  const external = str(info.externalUrl) ?? ref.postingUrl;
  const remoteType = str(info.remoteType);
  const draft: Draft = {
    provider: "workday",
    url: external,
    applyUrl: `${external.replace(/\/$/, "")}/apply`,
    ats: "workday",
    atsBoard: tenant,
    atsJobId: str(info.jobReqId) ?? ref.jobId,
    title: str(info.title),
    company: str(obj(data.hiringOrganization).name) ?? prettySlug(tenant),
    location: [location, ...additional].filter(Boolean).join("; ") || null,
    remote: toRemote({ workplace: remoteType, location }),
    postedAt: info.startDate,
    salary: null,
    text: joinParts(
      str(info.title),
      joinInline(location, str(info.timeType), remoteType),
      htmlToText(String(info.jobDescription ?? "")),
    ),
  };
  return { result: finish(draft, "api", "workday-api") };
}

/* ---------- Rippling ---------- */

export async function rippling(
  ref: AtsRef,
  http: Http,
  trace: Trace,
): Promise<AdapterResult> {
  const { status, data } = await api(
    http,
    `https://api.rippling.com/platform/api/ats/v1/board/${enc(ref.board ?? "")}/jobs/${ref.jobId}`,
    trace,
  );
  if (status === 404 || status === 410)
    return { fallback: `Rippling API ${status}` };
  if (status >= 400) return failed(`Rippling API HTTP ${status}`);
  if (!isObj(data) || typeof data.name !== "string")
    return failed("Rippling API returned no job");
  return { result: ripplingFields(data, ref) };
}

export function ripplingFields(job: Obj, ref: AtsRef): FetchResult {
  const locations = arr(job.workLocations)
    .map((item) => str(item) ?? str(obj(item).name))
    .filter(Boolean);
  const location = locations.join("; ") || null;
  const description = obj(job.description);
  const pay = arr(job.payRangeDetails).map(obj)[0];
  const posting = str(job.url) ?? ref.postingUrl;
  const employment = obj(job.employmentType);
  const draft: Draft = {
    provider: "rippling",
    url: posting,
    applyUrl: `${posting.replace(/\/$/, "")}/apply`,
    ats: "other",
    atsBoard: ref.board,
    atsJobId: str(job.uuid) ?? ref.jobId,
    title: str(job.name),
    company: str(job.companyName) ?? prettySlug(ref.board ?? ""),
    location,
    remote: toRemote({ flag: pay?.isRemote === true ? true : null, location }),
    postedAt: job.createdOn,
    salary: pay
      ? toSalary(pay.rangeStart, pay.rangeEnd, pay.currency, pay.frequency)
      : null,
    text: joinParts(
      str(job.name),
      joinInline(
        location,
        str(obj(job.department).name),
        str(employment.id) ?? str(employment.label),
      ),
      htmlToText(String(description.role ?? "")),
      htmlToText(String(description.company ?? "")),
    ),
  };
  return finish(draft, "api", "rippling-api");
}
