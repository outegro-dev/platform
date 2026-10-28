import { createHash } from "node:crypto";

const tracking =
  /^(utm_\w+|gh_src|lever-(source|origin|via)|source|src|ref|referrer|trk|trackingid|fbclid|gclid|yclid|msclkid|mc_\w+|_hs\w+|from|dcr_ci|success|autofill|submitted)$/i;
/** Pages after the posting: its form and the "sent" screens. */
const formTail =
  /(?:\/(?:apply|application|thanks|thank-you|confirmation|success|submitted))+\/?$/i;

/**
 * One key per vacancy link: scheme, host case, "www.", fragment, trailing
 * slash, tracking parameters, the form and "thanks" pages after the posting
 * and the `?success` / `?autofill` flags do not matter. Greenhouse's two
 * board hosts and Workable's two link forms share a key.
 */
export function vacancyUrlKey(value: string): string {
  const url = new URL(value.trim());
  let host = url.hostname.toLowerCase().replace(/^www\./, "");
  let path = url.pathname;
  const segments = path.split("/").filter(Boolean);
  const tail = path.match(formTail)?.[0];
  if (tail && segments.length - tail.split("/").filter(Boolean).length >= 2)
    path = path.slice(0, path.length - tail.length);
  const greenhouse = host.match(
    /^(?:boards|job-boards)(\.eu)?\.greenhouse\.io$/,
  );
  if (greenhouse) host = `job-boards${greenhouse[1] ?? ""}.greenhouse.io`;
  const workable = host.match(/^([a-z0-9-]+)\.workable\.com$/);
  if (
    workable?.[1] &&
    !["apply", "jobs", "www"].includes(workable[1]) &&
    /^\/j\//.test(path)
  ) {
    path = `/${workable[1]}${path}`;
    host = "apply.workable.com";
  }
  if (host === "apply.workable.com")
    path = path.replace(
      /\/j\/([0-9a-f]+)/i,
      (_, code: string) => `/j/${code.toUpperCase()}`,
    );
  const params = [...url.searchParams]
    .filter(([name]) => !tracking.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  return `${host}${path.replace(/\/+$/, "")}${params.length ? `?${new URLSearchParams(params)}` : ""}`;
}

/** One key per vacancy text: case and whitespace do not matter. */
export const vacancyTextKey = (text: string): string =>
  createHash("sha256")
    .update(text.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");

const legal =
  /\b(?:inc|incorporated|ltd|limited|llc|llp|plc|gmbh|ag|sa|sas|sarl|srl|sl|bv|nv|oy|oyj|ab|as|aps|kft|sp z o o|spa|pte|pty|co|corp|corporation|company|group|holding|holdings|ооо|оао|зао|ао|тоо|ип)\b\.?/g;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function normalizeCompany(company: string): string {
  return normalize(company).replace(legal, " ").replace(/\s+/g, " ").trim();
}

const roleWords: [RegExp, string][] = [
  [/\bsr\b/g, "senior"],
  [/\bjr\b/g, "junior"],
  [/\bmid level\b|\bmid\b/g, "middle"],
  [/\bfull ?stack\b|\bfullstack\b/g, "fullstack"],
  [/\bfront ?end\b/g, "frontend"],
  [/\bback ?end\b/g, "backend"],
  [/\bdev\b|\bdeveloper\b/g, "developer"],
  [/\beng\b|\bengineer\b/g, "engineer"],
  [/\bm f d\b|\bm w d\b|\bf m d\b|\bm f x\b|\ball genders\b/g, ""],
  [/\breact js\b|\breactjs\b/g, "react"],
  [/\bnode js\b|\bnodejs\b/g, "node"],
];

export function normalizeRole(title: string): string {
  let role = normalize(title);
  for (const [pattern, replacement] of roleWords)
    role = role.replace(pattern, replacement);
  return role.replace(/\s+/g, " ").trim();
}

export function normalizeLocation(location: string | null): string {
  if (!location) return "";
  return normalize(location)
    .replace(
      /\bfully remote\b|\bremote first\b|\bwork from home\b|\bwfh\b/g,
      "remote",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The three duplicate keys of a vacancy: the link (for an aggregator pass
 * its original ATS link when known), the text hash, and company + role +
 * location for one vacancy posted on different boards.
 */
export function vacancyKeys(input: {
  url: string;
  text: string;
  company: string;
  title: string;
  location: string | null;
}): { urlKey: string; textKey: string; roleKey: string } {
  return {
    urlKey: vacancyUrlKey(input.url),
    textKey: vacancyTextKey(input.text),
    roleKey: `${normalizeCompany(input.company)}|${normalizeRole(input.title)}|${normalizeLocation(input.location)}`,
  };
}
