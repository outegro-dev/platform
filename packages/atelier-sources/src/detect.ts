import type { AtsKind } from "@outegro/contracts/atelier";

/** What a vacancy link says about its ATS posting. */
export type AtsRef = {
  ats: AtsKind;
  /** Board / company slug; `null` when only the page can tell (gh_jid). */
  board: string | null;
  jobId: string;
  /** Data region of Lever and Greenhouse boards. */
  region: "us" | "eu";
  /** The posting's own page on the ATS. */
  postingUrl: string;
  /** Workday host (`acme.wd5.myworkdayjobs.com`) or Personio / Teamtailor host. */
  host?: string;
  /** Workday career site. */
  site?: string;
  /** Workday path after `/job/`. */
  path?: string;
};

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const locale = "(?:[a-z]{2}(?:-[A-Za-z]{2})?/)?";

/** Recognises the posting behind a link on a known ATS host. */
export function parseAtsUrl(link: string): AtsRef | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;

  const m1 = host.match(/^jobs(\.eu)?\.lever\.co$/);
  if (m1) {
    const match = m1;
    const parts = path.match(new RegExp(`^/([^/]+)/(${uuid})`, "i"));
    if (!parts) return null;
    const region = match[1] ? "eu" : "us";
    return {
      ats: "lever",
      board: decodeURIComponent(parts[1] ?? ""),
      jobId: (parts[2] ?? "").toLowerCase(),
      region,
      postingUrl: `https://${host}/${parts[1]}/${(parts[2] ?? "").toLowerCase()}`,
    };
  }

  const m2 = host.match(/^(?:boards|job-boards)(\.eu)?\.greenhouse\.io$/);
  if (m2) {
    const match = m2;
    const region = match[1] ? "eu" : "us";
    const embedded =
      url.searchParams.get("token") ?? url.searchParams.get("gh_jid");
    const embedBoard = url.searchParams.get("for");
    if (/^\/embed\/job_app/.test(path) && embedded && embedBoard)
      return greenhouse(embedBoard, embedded, region);
    const parts = path.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (parts?.[1] && parts[2]) return greenhouse(parts[1], parts[2], region);
    return null;
  }

  if (host === "jobs.ashbyhq.com") {
    const parts = path.match(new RegExp(`^/([^/]+)/(${uuid})`, "i"));
    if (!parts?.[1] || !parts[2]) return null;
    const board = decodeURIComponent(parts[1]);
    const jobId = parts[2].toLowerCase();
    return {
      ats: "ashby",
      board,
      jobId,
      region: "us",
      postingUrl: `https://jobs.ashbyhq.com/${parts[1]}/${jobId}`,
    };
  }

  if (host === "apply.workable.com") {
    const parts = path.match(/^\/([^/]+)\/j\/([0-9A-F]{6,})/i);
    if (parts?.[1] && parts[2] && parts[1] !== "j")
      return workable(parts[1], parts[2]);
    return null;
  }
  const m3 = host.match(/^([a-z0-9-]+)\.workable\.com$/);
  if (m3) {
    const match = m3;
    const parts = path.match(/^\/j\/([0-9A-F]{6,})/i);
    if (match[1] && parts?.[1] && !["apply", "jobs", "www"].includes(match[1]))
      return workable(match[1], parts[1]);
    return null;
  }

  if (/^(?:jobs|careers)\.smartrecruiters\.com$/.test(host)) {
    const oneClick = path.match(
      /^\/oneclick-ui\/company\/([^/]+)\/publication\/([0-9a-f-]{36})/i,
    );
    if (oneClick?.[1] && oneClick[2])
      return smartRecruiters(oneClick[1], oneClick[2].toLowerCase());
    const parts = path.match(/^\/([^/]+)\/(\d{6,})/);
    if (parts?.[1] && parts[2]) return smartRecruiters(parts[1], parts[2]);
    return null;
  }

  const m4 = host.match(/^([a-z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (m4) {
    const match = m4;
    const parts = path.match(new RegExp(`^/${locale}([^/]+)/job/(.+?)/?$`));
    if (!parts?.[1] || !parts[2]) return null;
    return workday(host, match[1] ?? "", parts[1], parts[2]);
  }
  if (/^wd\d+\.myworkdaysite\.com$/.test(host)) {
    const parts = path.match(
      new RegExp(`^/${locale}recruiting/([^/]+)/([^/]+)/job/(.+?)/?$`),
    );
    if (!parts?.[1] || !parts[2] || !parts[3]) return null;
    return workday(host, parts[1], parts[2], parts[3]);
  }

  if (host === "ats.rippling.com") {
    const parts = path.match(
      new RegExp(`^/${locale}([^/]+)/jobs/(${uuid})`, "i"),
    );
    if (!parts?.[1] || !parts[2]) return null;
    const jobId = parts[2].toLowerCase();
    return {
      ats: "other",
      board: parts[1],
      jobId,
      region: "us",
      postingUrl: `https://ats.rippling.com/${parts[1]}/jobs/${jobId}`,
      host: "rippling",
    };
  }

  const m5 = host.match(/^([a-z0-9-]+)\.teamtailor\.com$/);
  if (m5) {
    const match = m5;
    const parts = path.match(new RegExp(`^/${locale}jobs/(\\d+)(?:-[^/]*)?`));
    if (!match[1] || !parts?.[1]) return null;
    return {
      ats: "teamtailor",
      board: match[1],
      jobId: parts[1],
      region: "us",
      postingUrl: `https://${host}${path.replace(/\/(?:apply|applications.*)\/?$/, "")}`,
      host,
    };
  }

  const m6 = host.match(/^([a-z0-9-]+)\.jobs\.personio\.(?:de|com)$/);
  if (m6) {
    const match = m6;
    const parts = path.match(/^\/job\/(\d+)/);
    if (!match[1] || !parts?.[1]) return null;
    return {
      ats: "personio",
      board: match[1],
      jobId: parts[1],
      region: "us",
      postingUrl: `https://${host}/job/${parts[1]}`,
      host,
    };
  }

  if (host === "comeet.com" || host === "comeet.co") {
    const parts = path.match(/^\/jobs\/([^/]+)\/([^/]+)\/[^/]+\/([0-9A-F.]+)/i);
    if (!parts?.[1] || !parts[3]) return null;
    return {
      ats: "comeet",
      board: parts[1],
      jobId: parts[3],
      region: "us",
      postingUrl: `https://www.comeet.com${path}`,
    };
  }

  // A company page with an embedded Greenhouse board.
  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid))
    return {
      ats: "greenhouse",
      board: null,
      jobId: ghJid,
      region: "us",
      postingUrl: url.href,
    };
  return null;
}

/** Rippling is not an `AtsKind` of the contract; it is stored as `other`. */
export const isRippling = (ref: AtsRef) => ref.host === "rippling";

function greenhouse(board: string, jobId: string, region: "us" | "eu"): AtsRef {
  return {
    ats: "greenhouse",
    board,
    jobId,
    region,
    postingUrl: `https://job-boards${region === "eu" ? ".eu" : ""}.greenhouse.io/${board}/jobs/${jobId}`,
  };
}

function workable(account: string, shortcode: string): AtsRef {
  const code = shortcode.toUpperCase();
  return {
    ats: "workable",
    board: account,
    jobId: code,
    region: "us",
    postingUrl: `https://apply.workable.com/${account}/j/${code}/`,
  };
}

function smartRecruiters(company: string, jobId: string): AtsRef {
  return {
    ats: "smartrecruiters",
    board: company,
    jobId,
    region: "us",
    postingUrl: /^\d+$/.test(jobId)
      ? `https://jobs.smartrecruiters.com/${company}/${jobId}`
      : `https://jobs.smartrecruiters.com/oneclick-ui/company/${company}/publication/${jobId}`,
  };
}

function workday(
  host: string,
  tenant: string,
  site: string,
  rest: string,
): AtsRef {
  const path = rest.replace(/\/apply(?:\/.*)?$/, "");
  return {
    ats: "workday",
    board: tenant,
    jobId: path.split("/").at(-1) ?? path,
    region: "us",
    postingUrl: host.endsWith("myworkdaysite.com")
      ? `https://${host}/recruiting/${tenant}/${site}/job/${path}`
      : `https://${host}/${site}/job/${path}`,
    host,
    site,
    path,
  };
}

/** Hosts of the aggregators with their own parsers. */
export function aggregatorOf(link: string): "hirify" | "wantapply" | null {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "hirify.me") return "hirify";
    if (host === "wantapply.com") return "wantapply";
  } catch {}
  return null;
}

const atsHost =
  /(?:^|\.)(?:lever\.co|greenhouse\.io|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|myworkdaysite\.com|rippling\.com|teamtailor\.com|personio\.(?:de|com)|comeet\.com|recruitee\.com|bamboohr\.com|breezy\.hr|jobvite\.com|icims\.com|pinpointhq\.com|applytojob\.com|join\.com|homerun\.co|factorialhr\.com|peopleforce\.io|huntflow\.(?:ru|io))$/i;

/** True for links that point at an ATS posting (the original behind an aggregator). */
export function isAtsLink(link: string): boolean {
  try {
    const url = new URL(link);
    if (parseAtsUrl(link)) return true;
    return (
      atsHost.test(url.hostname) &&
      url.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}
