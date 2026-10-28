/*
 * Small text helpers shared by the CV rules. CV and message text may hold
 * `**…**` highlight spans; they are layout, never words or numbers.
 */

/** Text without the `**…**` highlight markers. */
export const plainText = (value: string) => value.replace(/\*\*/g, "");

export const wordCount = (value: string) => {
  const text = plainText(value).trim();
  return text ? text.split(/\s+/).length : 0;
};

/**
 * Quantities a text states, sorted. Digits inside a word (B2B, K8s, S3, EC2,
 * i18n) name things, they are not quantities. A sentence's own full stop or
 * comma after a figure ("in 2024.") is not part of it.
 */
export const numbers = (value: string) =>
  (plainText(value).match(/(?<![A-Za-z])\d[\d,.]*(?:\+|%)?/g) ?? [])
    .map((token) => token.replace(/[.,]+$/, ""))
    .sort();

/** The owner never writes a long dash: a model that does gets a plain one. */
export const withoutLongDash = (text: string) => text.replace(/ ?— ?/g, " - ");

/** Raw LaTeX or a line break inside a one-line CV part. */
export const rawText = (value: string) => /\\[a-zA-Z]|\n/.test(value);

export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The term occurs as a whole word (not inside a longer word), any case. */
export function mentions(text: string, term: string) {
  const trimmed = term.trim();
  if (!trimmed) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
}

/** Vacancy text as code reads it: one newline style, no nbsp, `- ` bullets. */
export function normalizeVacancy(input: string) {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\n[ \t]*[•●▪][ \t]*/g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Ends with a full stop (or another sentence end), ignoring highlights. */
export const endsSentence = (value: string) =>
  /[.!?]$/.test(plainText(value).trim());

/** A string cut to `max` characters on a word boundary when possible. */
export function clip(value: string, max: number) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/** FNV-1a: a short stable key for a rendered layout (no crypto needed). */
export function hashKey(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}:${value.length}`;
}

/** Unique values in first-seen order. */
export const unique = <T>(values: Iterable<T>) => [...new Set(values)];
