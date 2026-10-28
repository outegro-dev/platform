import { attr, findAll, type HtmlNode, htmlToText, rawText } from "./html.js";

type Json = unknown;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parses JSON that pages ship with stray control characters or HTML comments. */
export function looseJson(text: string): Json | undefined {
  const trimmed = text
    .trim()
    .replace(/^<!--|-->$/g, "")
    .replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "")
    .trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {}
  try {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: raw newlines inside JSON-LD strings
    return JSON.parse(trimmed.replace(/[\u0000-\u001f]+/g, " "));
  } catch {
    return undefined;
  }
}

/** Every schema.org JobPosting on the page, outermost first. */
export function jsonLdPostings(root: HtmlNode): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const node of findAll(
    root,
    (item) =>
      item.name === "script" &&
      (attr(item, "type") ?? "").toLowerCase() === "application/ld+json",
  )) {
    const data = looseJson(rawText(node));
    const stack: unknown[] = [data];
    while (stack.length) {
      const item = stack.shift();
      if (Array.isArray(item)) stack.push(...item);
      else if (isObject(item)) {
        const type = item["@type"];
        if (
          type === "JobPosting" ||
          (Array.isArray(type) && type.includes("JobPosting"))
        )
          out.push(item);
        if (Array.isArray(item["@graph"])) stack.push(...item["@graph"]);
        if (isObject(item.mainEntity)) stack.push(item.mainEntity);
      }
    }
  }
  return out;
}

/** `<script id="__NEXT_DATA__">` as JSON. */
export function nextData(root: HtmlNode): Json | undefined {
  const node = findAll(
    root,
    (item) => item.name === "script" && attr(item, "id") === "__NEXT_DATA__",
  )[0];
  return node ? looseJson(rawText(node)) : undefined;
}

/**
 * Resolves a Nuxt 3 payload (`<script id="__NUXT_DATA__">`, devalue format):
 * a flat array where objects point at other entries by index.
 */
export function nuxtData(root: HtmlNode): Json | undefined {
  const node = findAll(
    root,
    (item) => item.name === "script" && attr(item, "id") === "__NUXT_DATA__",
  )[0];
  if (!node) return undefined;
  const flat = looseJson(rawText(node));
  return Array.isArray(flat) ? unflatten(flat) : undefined;
}

const wrappers = new Set([
  "ShallowReactive",
  "Reactive",
  "Ref",
  "ShallowRef",
  "EmptyRef",
  "EmptyShallowRef",
  "NuxtError",
  "Object",
  "Island",
]);

export function unflatten(flat: unknown[]): Json {
  const done = new Map<number, Json>();
  const resolve = (index: unknown): Json => {
    if (typeof index !== "number") return index;
    if (index < 0) return index === -3 ? Number.NaN : undefined;
    if (done.has(index)) return done.get(index);
    const value = flat[index];
    if (Array.isArray(value)) {
      const tag = value[0];
      if (typeof tag === "string") {
        if (tag === "Date") return value[1];
        if (tag === "Set") return value.slice(1).map(resolve);
        if (tag === "Map" || tag === "null") {
          const out: Record<string, Json> = {};
          done.set(index, out);
          for (let at = 1; at + 1 < value.length; at += 2)
            out[String(resolve(value[at]))] = resolve(value[at + 1]);
          return out;
        }
        if (wrappers.has(tag) || value.length === 2) return resolve(value[1]);
        return undefined;
      }
      const out: Json[] = [];
      done.set(index, out);
      for (const item of value) out.push(resolve(item));
      return out;
    }
    if (isObject(value)) {
      const out: Record<string, Json> = {};
      done.set(index, out);
      for (const [key, item] of Object.entries(value)) out[key] = resolve(item);
      return out;
    }
    done.set(index, value);
    return value;
  };
  return resolve(0);
}

/** `window.__appData = {…}` style assignments in inline scripts. */
export function windowAssignments(root: HtmlNode): Json[] {
  const out: Json[] = [];
  for (const node of findAll(
    root,
    (item) => item.name === "script" && !attr(item, "src"),
  )) {
    const text = rawText(node);
    for (const match of text.matchAll(
      /window\.(__\w+|\w*[Dd]ata\w*)\s*=\s*/g,
    )) {
      const start = (match.index ?? 0) + match[0].length;
      const object = balanced(text, start);
      if (!object) continue;
      const parsed = looseJson(object);
      if (parsed !== undefined) out.push(parsed);
    }
  }
  return out;
}

/** The JSON object or array that starts at `start`, by bracket balance. */
function balanced(text: string, start: number): string | null {
  const open = text[start];
  if (open !== "{" && open !== "[") return null;
  let depth = 0;
  let inString = false;
  for (let at = start; at < text.length; at++) {
    const char = text[at];
    if (inString) {
      if (char === "\\") at++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return text.slice(start, at + 1);
    }
  }
  return null;
}

export type JobLike = {
  title: string;
  html: string;
  company: string | null;
  location: string | null;
  postedAt: unknown;
};

const titleKeys = ["title", "jobTitle", "name", "text", "positionName"];
const bodyKeys = [
  "descriptionHtml",
  "description",
  "jobDescription",
  "content",
  "descriptionPlain",
  "body",
  "jobAd",
];
const companyKeys = [
  "companyName",
  "company_name",
  "organizationName",
  "hiringOrganization",
  "company",
  "organization",
];

/**
 * The most vacancy-like object inside embedded page data: a title and the
 * longest description (at least 200 characters of text).
 */
export function findJobLike(data: Json): JobLike | null {
  let best: JobLike | null = null;
  let bestLength = 0;
  const seen = new Set<unknown>();
  const visit = (value: Json, depth: number) => {
    if (
      depth > 14 ||
      value === null ||
      typeof value !== "object" ||
      seen.has(value)
    )
      return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const object = value as Record<string, unknown>;
    const title = titleKeys
      .map((key) => object[key])
      .find(
        (item): item is string =>
          typeof item === "string" &&
          item.trim().length >= 3 &&
          item.length <= 300,
      );
    const body = bodyKeys
      .map((key) => object[key])
      .find(
        (item): item is string =>
          typeof item === "string" && item.length >= 200,
      );
    if (title && body) {
      const length = htmlToText(body).length;
      if (length >= 200 && length > bestLength) {
        bestLength = length;
        best = {
          title: title.trim(),
          html: body,
          company: companyName(object),
          location: locationName(
            object.location ?? object.locationName ?? object.jobLocation,
          ),
          postedAt:
            object.publishedAt ??
            object.datePosted ??
            object.createdAt ??
            object.published_at ??
            object.created_at ??
            null,
        };
      }
    }
    for (const item of Object.values(object)) visit(item, depth + 1);
  };
  visit(data, 0);
  return best;
}

function companyName(object: Record<string, unknown>): string | null {
  for (const key of companyKeys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (isObject(value) && typeof value.name === "string" && value.name.trim())
      return value.name.trim();
  }
  return null;
}

function locationName(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (isObject(value)) {
    for (const key of ["name", "locationName", "city", "text"])
      if (typeof value[key] === "string" && String(value[key]).trim())
        return String(value[key]).trim();
  }
  return null;
}
