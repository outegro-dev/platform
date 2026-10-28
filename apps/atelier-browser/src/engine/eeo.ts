import { normalize } from "./text.js";

/**
 * EEO / demographic questions (gender, race, veteran, disability, …). The
 * profile's answer to all of them is "decline" (formAnswersSchema.eeo), so
 * the engine never fills them from the bank: it picks the option meaning
 * "prefer not to say", or leaves an optional question empty.
 */

const DEMOGRAPHIC =
  /\b(gender|sex|sexual orientation|sexuality|lgbt\w*|transgender|trans|race|racial|ethnicity|ethnic|ethnicities|hispanic|latin[oaxe]|veteran|veterans|military status|disability|disabilities|disabled|neurodivergent|age range|age group|your age|current age|how old|date of birth|marital status|religion|religious|caste|pronouns?)\b/;

/** Section headings of the voluntary self-identification part of a form. */
const EEO_SECTION =
  /\b(equal employment|equal opportunity|eeo|eeoc|self identification|self identify|voluntary (self )?(identification|disclosure)|demographic|diversity (survey|questions|information|and inclusion)|inclusion survey)\b/;

/** Options of a demographic question ("Veteran", "Person with disability", …). */
const DEMOGRAPHIC_OPTION =
  /\b(man|woman|male|female|non binary|veteran|disability|asian|black|white|hispanic|latin[oaxe]|indigenous|pacific islander|two or more races|heterosexual|gay|lesbian|bisexual|transgender)\b/;

const DECLINE = [
  /\b(prefer|preferred) not\b/,
  /\bdecline\b/,
  /\bdeclined\b/,
  /\b(dont|do not|does not) (wish|want|care) to\b/,
  /\bwish not to\b/,
  /\brather not\b/,
  /\bchoose not to\b/,
  /\b(i )?(choose|elect) not\b/,
  /\bnot (to )?(answer|say|disclose|self identify|specify|provide|share)\b/,
  /\bnot (disclosed|specified|declared)\b/,
  /\bno answer\b/,
  /\bundisclosed\b/,
];

/** Whether an option means "decline / prefer not to say". */
export function isDeclineOption(option: string): boolean {
  const text = normalize(option);
  return DECLINE.some((pattern) => pattern.test(text));
}

/** Index of the decline option, the most explicit one first; null when none. */
export function declineOption(options: readonly string[]): number | null {
  let best: number | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  options.forEach((option, index) => {
    const text = normalize(option);
    const rank = DECLINE.findIndex((pattern) => pattern.test(text));
    if (rank !== -1 && rank < bestRank) {
      best = index;
      bestRank = rank;
    }
  });
  return best;
}

/**
 * Whether a field is an EEO / demographic question: by its label, by the
 * section it sits in, or by its options (several demographic options plus
 * a decline option).
 */
export function isEeoQuestion(
  label: string,
  section = "",
  options: readonly string[] | null = null,
): boolean {
  const text = normalize(label);
  // "Are you at least 18 years of age?" and "authorized to work" are legal questions.
  if (
    /\b(authori[sz]ed|sponsorship|legally|eligible|at least 18|18 years)\b/.test(
      text,
    )
  )
    return false;
  if (DEMOGRAPHIC.test(text)) return true;
  if (EEO_SECTION.test(normalize(section))) return true;
  if (options && options.length > 1) {
    const demographic = options.filter((option) =>
      DEMOGRAPHIC_OPTION.test(normalize(option)),
    ).length;
    if (demographic >= 2 && declineOption(options) !== null) return true;
  }
  return false;
}
