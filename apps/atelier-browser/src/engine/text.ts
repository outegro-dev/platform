/**
 * Text rules of the form engine: how a label is cleaned, compared with a
 * question from the answer bank, and how an answer picks one option.
 * Pure functions; the browser side only collects raw text.
 */

const STOPWORDS = new Set(
  (
    "a an the of to in on at for and or by as with from into about is are " +
    "be been was were do does did you your yours we our us it its this that " +
    "these those please if any have has had will would can could should " +
    "shall may might what which who whom how when where why there here " +
    "i me my e g eg etc ie"
  ).split(" "),
);

/** Required / optional markers that ATS forms add around a label. */
const MARKERS = /[*✱]|\((?:optional|required)\)|\brequired\b$/giu;

/** A label as people read it: no asterisks, no "(Optional)", one line. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(MARKERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s:]+$/u, "")
    .slice(0, 1000);
}

/** Lower case, no accents, no punctuation, single spaces. */
export function normalize(text: string): string {
  return cleanLabel(text)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

/** Form instructions that say nothing about the question itself. */
const INSTRUCTIONS =
  /\b(please )?(check|select|choose|tick|mark) (all|any|one)( (that|which|of the following))?( (apply|applies))?\b/g;

/** Content words of a text, stemmed; stopwords dropped unless nothing is left. */
export function tokens(text: string): string[] {
  const words = normalize(text)
    .replace(INSTRUCTIONS, " ")
    .split(" ")
    .filter((word) => word.length > 1 || /\d/.test(word));
  const content = words.filter((word) => !STOPWORDS.has(word));
  return [...new Set((content.length ? content : words).map(stem))];
}

/**
 * Token overlap of two texts, 0–1, over content words: the Dice coefficient
 * 2·|A∩B| / (|A|+|B|), averaged with the overlap coefficient |A∩B| / min
 * when both have two words or more (so "Expected salary" still finds
 * "Expected salary (EUR, gross per year)"); 1 for texts equal after
 * normalisation.
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  const shared = ta.filter((token) => tb.has(token)).length;
  const dice = (2 * shared) / (ta.length + tb.size);
  const smaller = Math.min(ta.length, tb.size);
  return smaller >= 2 ? (dice + shared / smaller) / 2 : dice;
}

/** Minimal overlap for a label and a bank question to count as the same question. */
export const QUESTION_MATCH = 0.6;

export type Answer = { question: string; answer: string };

/** The answer whose question matches the label best (≥ 0.6), if any. */
export function findAnswer(
  label: string,
  answers: readonly Answer[],
): Answer | null {
  let best: Answer | null = null;
  let bestScore = 0;
  for (const answer of answers) {
    if (!answer.answer.trim()) continue;
    const score = similarity(label, answer.question);
    if (score > bestScore) {
      best = answer;
      bestScore = score;
    }
  }
  return bestScore >= QUESTION_MATCH ? best : null;
}

const YES = new Set(["yes", "y", "true", "da", "si", "oui", "ja"]);
const NO = new Set(["no", "n", "false", "net", "non", "nein"]);

function polarity(text: string): "yes" | "no" | null {
  const first = normalize(text).split(" ")[0] ?? "";
  if (YES.has(first)) return "yes";
  if (NO.has(first)) return "no";
  return null;
}

/** "3-5 years", "10+", "less than 1", "60 or older" as a closed interval. */
export function numericRange(text: string): [number, number] | null {
  const t = normalize(text).replace(/(\d)\s*\+/g, "$1 plus");
  let m = t.match(
    /^(?:between )?(\d+(?:\.\d+)?) (?:to|and|-)? ?(\d+(?:\.\d+)?)\b/,
  );
  if (m && /\d+(?:\.\d+)? (?:to |and )?\d/.test(t))
    return [Number(m[1]), Number(m[2])];
  m = t.match(
    /(\d+(?:\.\d+)?) (?:plus|or more|or older|or above|and above|and up)/,
  );
  if (m) return [Number(m[1]), Number.POSITIVE_INFINITY];
  m = t.match(/(?:more than|over|above|greater than|at least) (\d+(?:\.\d+)?)/);
  if (m)
    return [
      Number(m[1]) + (/at least/.test(t) ? 0 : 1e-9),
      Number.POSITIVE_INFINITY,
    ];
  m = t.match(/(?:less than|under|below|fewer than) (\d+(?:\.\d+)?)/);
  if (m) return [Number.NEGATIVE_INFINITY, Number(m[1]) - 1e-9];
  m = t.match(/^(\d+(?:\.\d+)?)(?: [a-z ]+)?$/);
  if (m) return [Number(m[1]), Number(m[1])];
  return null;
}

/**
 * How well an option expresses an answer, 0–1: equal text, yes/no polarity,
 * a number inside an option's range, a prefix ("Yes, I am" → "Yes") or
 * token overlap.
 */
export function optionScore(answer: string, option: string): number {
  const na = normalize(answer);
  const no = normalize(option);
  if (!na || !no) return 0;
  if (na === no) return 1;
  const pa = polarity(answer);
  const po = polarity(option);
  if (pa && po) {
    if (pa !== po) return 0;
    // "Yes" for "Yes, I am authorized"; the longer equal-polarity option wins on overlap.
    return 0.8 + 0.15 * similarity(answer, option);
  }
  const number = na.match(/^\D{0,20}?(\d+(?:\.\d+)?)/);
  const range = numericRange(option);
  if (number && range && /^\D{0,20}\d/.test(na)) {
    const value = Number(number[1]);
    if (value >= range[0] && value <= range[1]) return 0.9;
  }
  if (na.startsWith(`${no} `) || no.startsWith(`${na} `)) return 0.85;
  return similarity(answer, option);
}

/** Minimal score for an option to count as the answer. */
export const OPTION_MATCH = 0.6;

/** Index of the option that best expresses the answer, or null. */
export function chooseOption(
  answer: string,
  options: readonly string[],
): number | null {
  let best: number | null = null;
  let bestScore = 0;
  options.forEach((option, index) => {
    const score = optionScore(answer, option);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return bestScore >= OPTION_MATCH ? best : null;
}

/** Options for a multi-select answer: "English, German" → both. */
export function chooseOptions(
  answer: string,
  options: readonly string[],
): number[] {
  const whole = chooseOption(answer, options);
  const parts = answer
    .split(/[,;\n]|\band\b/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chosen = new Set<number>();
  if (parts.length > 1) {
    for (const part of parts) {
      const index = chooseOption(part, options);
      if (index !== null) chosen.add(index);
    }
  }
  if (!chosen.size && whole !== null) chosen.add(whole);
  return [...chosen].sort((a, b) => a - b);
}

/** The city part of "Tbilisi, Georgia". */
export function cityOf(location: string): string {
  return (location.split(",")[0] ?? "").trim();
}

/** The country part of "Tbilisi, Georgia" (the last comma part). */
export function countryOf(location: string): string {
  const parts = location.split(",").map((part) => part.trim());
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}
