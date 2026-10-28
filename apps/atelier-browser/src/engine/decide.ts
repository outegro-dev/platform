import type { BrowserApplyRequest } from "@outegro/contracts/atelier";
import { declineOption, isEeoQuestion } from "./eeo.js";
import type { RawField } from "./page-scripts.js";
import { standardKeyOf, standardValue } from "./standard.js";
import {
  chooseOption,
  chooseOptions,
  cityOf,
  cleanLabel,
  findAnswer,
  normalize,
} from "./text.js";

/** What the engine does with one field. */
export type Decision =
  | { kind: "text"; value: string }
  /** A location text input: type the city, take the first suggestion with it. */
  | { kind: "location"; value: string; city: string }
  | { kind: "file"; path: string; name: string }
  /** Options of a select, radio / checkbox group or button group, by position. */
  | { kind: "options"; indices: number[] }
  /** Open a combobox, search (if allowed) and pick an option. */
  | {
      kind: "combo";
      search: string;
      pick: (labels: readonly string[]) => number | null;
    }
  | { kind: "check"; on: boolean }
  /** On purpose left as it is (EEO without a decline option, marketing consent). */
  | { kind: "leave" }
  /** Already filled (prefilled or parsed from the CV) and nothing better to put. */
  | { kind: "keep" };

export type DecideContext = {
  req: BrowserApplyRequest;
  cvPath: string;
  cvName: string;
  /** The cover letter as a .txt, when the request has one. */
  coverPath: string | null;
  coverName: string | null;
  /** Every field of the form now (to tell the CV field among file inputs). */
  fields: readonly RawField[];
};

export const RESUME = /\b(resume|résumé|cv|curriculum)\b/i;
export const COVER =
  /cover[\s_-]?letter|motivation(al)? letter|covering letter/i;
const OTHER_FILE =
  /\b(transcript|portfolio|photo|picture|headshot|certificate|writing sample|work sample|diploma|id document|passport)\b/i;

/** Consent to process the application (privacy policy, data processing, terms). */
const CONSENT =
  /(privacy|data (processing|protection)|process(ing)? (of )?my (personal )?(data|information)|personal (data|information)|gdpr|terms (and|&) conditions|terms of (use|service)|(candidate|applicant) (privacy )?notice)/i;
/** Consents that are not needed to apply: marketing, talent pools, future roles. */
const MARKETING =
  /(marketing|newsletter|future (job )?(opportunit|role|position|opening|vacanc)|talent (pool|community|network)|contact me about|keep me (informed|updated|in mind)|other (roles|positions|opportunities)|sms|text messages?|whats ?app|job alerts?)/i;

const CHOICE = new Set(["select", "radio", "checkbox", "buttons", "combobox"]);
const TEXT = new Set([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "textarea",
]);

/** The bank's answer, matched by question, turned into an action for the field. */
function fromAnswer(field: RawField, answer: string): Decision | null {
  const labels = field.options?.map((option) => option.label) ?? [];
  if (TEXT.has(field.kind)) return { kind: "text", value: answer };
  if (field.kind === "combobox")
    return {
      kind: "combo",
      search: answer,
      pick: (options) => chooseOption(answer, options),
    };
  if (field.kind === "checkbox" && !field.options) {
    const yes = chooseOption(answer, ["Yes", "No"]);
    return yes === null ? null : { kind: "check", on: yes === 0 };
  }
  if (field.kind === "checkbox" && field.multiple) {
    const indices = chooseOptions(answer, labels);
    return indices.length ? { kind: "options", indices } : null;
  }
  if (field.options || field.kind === "select") {
    const index = chooseOption(answer, labels);
    return index === null ? null : { kind: "options", indices: [index] };
  }
  return null;
}

/** Decides what to put into one field; null means "needs an answer". */
export function decide(field: RawField, ctx: DecideContext): Decision | null {
  const label = cleanLabel(field.label);
  const about = `${label} ${field.hints} ${field.placeholder}`;
  const labels = field.options?.map((option) => option.label) ?? [];

  if (field.kind === "file") {
    if (field.answered) return { kind: "keep" };
    if (COVER.test(about))
      return ctx.coverPath && ctx.coverName
        ? { kind: "file", path: ctx.coverPath, name: ctx.coverName }
        : null;
    const files = ctx.fields.filter((other) => other.kind === "file");
    const resumeElsewhere = files.some(
      (other) =>
        other.ref !== field.ref &&
        RESUME.test(`${cleanLabel(other.label)} ${other.hints}`),
    );
    const firstUnknown =
      !resumeElsewhere &&
      files[0]?.ref === field.ref &&
      !OTHER_FILE.test(about);
    if (RESUME.test(about) || firstUnknown)
      return { kind: "file", path: ctx.cvPath, name: ctx.cvName };
    return null;
  }

  // EEO / demographic: always "decline", never an answer from the bank.
  const choice =
    CHOICE.has(field.kind) && !(field.kind === "checkbox" && !field.options);
  const byLabel = isEeoQuestion(label, "", field.options ? labels : null);
  const bySection =
    choice &&
    isEeoQuestion("", field.section) &&
    (field.kind === "combobox" || declineOption(labels) !== null);
  if (byLabel || bySection) {
    if (field.kind === "combobox")
      return {
        kind: "combo",
        search: "",
        pick: (options) => declineOption(options),
      };
    if (field.options || field.kind === "select") {
      const index = declineOption(labels);
      return index === null
        ? { kind: "leave" }
        : { kind: "options", indices: [index] };
    }
    return { kind: "leave" };
  }

  const key = standardKeyOf({ label, hints: field.hints, kind: field.kind });
  const value = key ? standardValue(key, ctx.req.fields) : null;
  if (key && value) {
    if (key === "location" || key === "country") {
      const wanted = key === "location" ? cityOf(value) || value : value;
      if (field.kind === "combobox")
        return {
          kind: "combo",
          search: wanted,
          pick: (options) =>
            key === "location"
              ? firstContaining(options, wanted)
              : (firstContaining(options, wanted) ??
                chooseOption(wanted, options)),
        };
      if (field.kind === "select") {
        const index = chooseOption(wanted, labels);
        return index === null ? null : { kind: "options", indices: [index] };
      }
      return key === "location"
        ? { kind: "location", value, city: wanted }
        : { kind: "text", value };
    }
    return { kind: "text", value };
  }

  if (TEXT.has(field.kind) && COVER.test(about) && ctx.req.coverLetter?.trim())
    return { kind: "text", value: ctx.req.coverLetter.trim() };

  if (field.kind === "checkbox" && !field.options) {
    if (MARKETING.test(label)) {
      const answer = field.required ? findAnswer(label, ctx.req.answers) : null;
      return answer ? fromAnswer(field, answer.answer) : { kind: "leave" };
    }
    if (CONSENT.test(label)) return { kind: "check", on: true };
  }

  const answer = findAnswer(label, ctx.req.answers);
  if (answer) {
    const decision = fromAnswer(field, answer.answer);
    if (decision) return decision;
  }
  return field.answered ? { kind: "keep" } : null;
}

/** First option that contains the text ("Tbilisi" → "Tbilisi, Georgia"). */
export function firstContaining(
  options: readonly string[],
  text: string,
): number | null {
  const wanted = normalize(text);
  if (!wanted) return null;
  const index = options.findIndex((option) =>
    normalize(option).includes(wanted),
  );
  return index === -1 ? null : index;
}
