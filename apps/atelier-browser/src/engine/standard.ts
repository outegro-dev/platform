import type { BrowserApplyRequest } from "@outegro/contracts/atelier";
import { normalize } from "./text.js";

/** Profile fields the engine fills without the answer bank. */
export type StandardKey =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "location"
  | "country"
  | "linkedin"
  | "github"
  | "website"
  | "currentCompany"
  | "currentTitle";

export type StandardInput = {
  /** The visible label. */
  label: string;
  /**
   * Attributes of the control as `name:… id:… ac:… type:… for:…`
   * (`for` is the `for` of a label that points at the field's entry).
   */
  hints: string;
  /** Control kind from the collector (text, email, tel, textarea, combobox, …). */
  kind: string;
};

const TEXT_KINDS = new Set(["text", "email", "tel", "url", "textarea"]);
const PICK_KINDS = new Set(["combobox", "select"]);

/** Words that make a "name" / "email" / "phone" label someone else's. */
const OTHER_PERSON =
  /\b(referr\w*|reference|recruiter|manager|emergency|company|school|university|preferred|nick ?name|pronunciation|spouse|parent|employer)\b/;

type Rule = {
  key: StandardKey;
  /** Visible label, normalised. */
  label?: RegExp;
  /** Attributes; used only when the label is short or missing. */
  hint?: RegExp;
  /** Label words that decide only in a short label ("Link to your GitHub"). */
  short?: RegExp;
  /** Attributes that decide whatever the label says (`_systemfield_*`, autocomplete). */
  strong?: RegExp;
  kinds?: Set<string>;
};

/** First rule that matches wins. */
const RULES: Rule[] = [
  {
    key: "linkedin",
    label:
      /^(your )?linked ?in( profile| url| link| page| account)?( url| link)?$/,
    short: /\blinked ?in\b/,
    hint: /linkedin/,
  },
  {
    key: "github",
    label:
      /^(your )?git ?hub( profile| url| link| username| account| handle| page)?( url| link)?$/,
    short: /\bgit ?hub\b/,
    hint: /github/,
  },
  {
    key: "firstName",
    label: /^(legal )?(first|given) name$|^first$|^forename$/,
    hint: /\b(first ?name|given name|fname)\b/,
    strong: /\bac:given name\b/,
  },
  {
    key: "lastName",
    label: /^(legal )?(last|family) name$|^surname$|^last$/,
    hint: /\b(last ?name|family name|surname|lname)\b/,
    strong: /\bac:family name\b/,
  },
  {
    key: "fullName",
    label:
      /^(your )?(full |legal |full legal )?name( and surname)?$|^name surname$|^candidate name$/,
    hint: /\bname:(name|full ?name)\b/,
    strong: /\bsystemfield name\b|\bac:name\b/,
  },
  {
    key: "email",
    label:
      /^(your )?(e ?mail|email address|e mail address)( address)?$|^(confirm|verify|repeat) (your )?e ?mail( address)?$/,
    hint: /\b(type:email|name:e ?mail|id:e ?mail)\b/,
    strong: /\bsystemfield email\b|\bac:email\b/,
  },
  {
    key: "phone",
    label:
      /^(your )?(phone|mobile|telephone|cell)( phone)?( number)?$|^contact (phone|number)$/,
    hint: /\b(type:tel|name:phone|id:phone|input phone)\b/,
    strong: /\bsystemfield phone\b|\bac:tel\b/,
  },
  {
    key: "country",
    label:
      /^(country|country of residence|current country|which country do you (currently )?live in)$/,
    kinds: PICK_KINDS,
  },
  {
    key: "location",
    label:
      /^(current |your )?(location|city|city of residence|location city|current location city)$|^where are you (currently )?(based|located)$|^(current )?city and country$/,
    hint: /\b(name:location|id:location|location input|candidate location)\b/,
    strong: /\bsystemfield location\b/,
    kinds: new Set([...TEXT_KINDS, "combobox"]),
  },
  {
    key: "website",
    label:
      /^(personal )?(website|web site|portfolio|homepage|blog)( url| link)?$|^(portfolio|website|personal) (url|link|site)$|^other website$/,
    hint: /\burls (portfolio|other)\b|\b(website|portfolio)\b/,
  },
  {
    key: "currentCompany",
    label:
      /^(current |present )?(company|employer|organi[sz]ation)( name)?$|^where do you (currently )?work$/,
    hint: /\bname:org\b|\bcurrent company\b/,
  },
  {
    key: "currentTitle",
    label: /^(current |present )?(job )?(title|role|position)$/,
    hint: /\b(current title|job title)\b/,
  },
];

/** `name:first_name id:x` → `name:first name id:x`: separators become spaces. */
export function normalizeHints(hints: string): string {
  return hints
    .toLowerCase()
    .replace(/[_\-[\].]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which profile field a control asks for, or null for a custom question. */
export function standardKeyOf(input: StandardInput): StandardKey | null {
  const label = normalize(input.label);
  const hints = normalizeHints(input.hints);
  if (!TEXT_KINDS.has(input.kind) && !PICK_KINDS.has(input.kind)) return null;
  const shortLabel = label === "" || label.split(" ").length <= 4;
  for (const rule of RULES) {
    if (!(rule.kinds ?? TEXT_KINDS).has(input.kind)) continue;
    const matched =
      (rule.strong?.test(hints) ?? false) ||
      (rule.label?.test(label) ?? false) ||
      (shortLabel && (rule.short?.test(label) ?? false)) ||
      (shortLabel && (rule.hint?.test(hints) ?? false));
    if (!matched) continue;
    if (
      (rule.key === "fullName" ||
        rule.key === "email" ||
        rule.key === "phone") &&
      OTHER_PERSON.test(label)
    )
      continue;
    return rule.key;
  }
  return null;
}

/** The value of a profile field for a request; null when the profile has none. */
export function standardValue(
  key: StandardKey,
  fields: BrowserApplyRequest["fields"],
): string | null {
  let value: string | null;
  if (key === "country") {
    const parts = fields.location.split(",").map((part) => part.trim());
    value = parts.length > 1 ? (parts.at(-1) ?? null) : null;
  } else {
    value = fields[key];
  }
  return value?.trim() ? value.trim() : null;
}
