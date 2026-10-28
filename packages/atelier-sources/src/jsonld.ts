import type { Draft } from "./fields.js";
import { htmlToText } from "./html.js";
import { joinParts, str, toRemote, toSalary } from "./normalize.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];

const decode = (value: unknown) => {
  const text = str(value);
  return text ? htmlToText(text).replace(/\s+/g, " ").trim() || null : null;
};

const nameOf = (value: unknown): string | null =>
  typeof value === "string"
    ? decode(value)
    : isObj(value)
      ? decode(value.name)
      : null;

function place(value: unknown): string | null {
  if (!isObj(value)) return typeof value === "string" ? decode(value) : null;
  const address = value.address;
  if (typeof address === "string") return decode(address);
  if (isObj(address)) {
    const parts = [
      nameOf(address.addressLocality),
      nameOf(address.addressRegion),
      nameOf(address.addressCountry),
    ].filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(", ");
  }
  return nameOf(value);
}

/** A schema.org JobPosting as draft fields. */
export function jsonLdDraft(node: Obj, url: string): Draft {
  const locations = list(node.jobLocation).map(place).filter(Boolean);
  const applicant = list(node.applicantLocationRequirements)
    .map(nameOf)
    .filter(Boolean);
  const telecommute = /telecommute/i.test(String(node.jobLocationType ?? ""));
  const location =
    [...new Set([...locations, ...applicant])].join("; ") ||
    (telecommute ? "Remote" : null);
  const base = isObj(node.baseSalary) ? node.baseSalary : {};
  const value = isObj(base.value) ? base.value : {};
  const single = typeof base.value === "number" ? base.value : value.value;
  const title = decode(node.title);
  const employment = list(node.employmentType).map(String).join(", ");
  return {
    provider: new URL(url).hostname.replace(/^www\./, ""),
    url,
    title,
    company: nameOf(node.hiringOrganization),
    location,
    remote: telecommute ? true : toRemote({ location }),
    postedAt: node.datePosted,
    salary: toSalary(
      value.minValue ?? single,
      value.maxValue ?? single,
      base.currency ?? value.currency,
      value.unitText ?? base.unitText,
    ),
    text: joinParts(
      title,
      [location, employment].filter(Boolean).join(" · "),
      htmlToText(String(node.description ?? "")),
    ),
  };
}
