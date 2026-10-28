import type { VacancyStructure } from "@outegro/contracts/atelier";
import { findTechnologies } from "./lexicon.js";

type Seniority = VacancyStructure["seniority"];
type RoleFocus = VacancyStructure["roleFocus"];

/** Title words per grade, strongest first; English and Russian. */
const grades: [Exclude<Seniority, "unknown">, RegExp][] = [
  [
    "lead",
    /\b(?:lead|leader|tech[\s-]?lead|team[\s-]?lead|staff|principal|architect|head of|director|vp of engineering)\b|тимлид|техлид|(?<![а-яё])лид(?![а-яё])|ведущ[а-яё]*|руководител[а-яё]*|архитектор/i,
  ],
  [
    "senior",
    /\b(?:senior|sr\.?|snr|iii|expert)\b|сень[оё]р[а-яё]*|синь[оё]р[а-яё]*|старш[а-яё]*/i,
  ],
  [
    "middle",
    /\b(?:middle|mid|mid-level|midlevel|intermediate|ii|regular)\b|мидл[а-яё]*|миддл[а-яё]*/i,
  ],
  [
    "junior",
    /\b(?:junior|jr\.?|intern|internship|trainee|entry[\s-]level|graduate|i)\b|джун[а-яё]*|младш[а-яё]*|стаж[её]р[а-яё]*/i,
  ],
];

/** Explicit grade statements inside a text ("Level: Senior", "#middle", "уровень: сеньор"). */
const gradeInText: [Exclude<Seniority, "unknown">, RegExp][] = [
  [
    "lead",
    /(?:level|grade|seniority|уровень|грейд)\s*[:\-–]?\s*#?(?:lead|staff|principal|лид)|#lead\b/i,
  ],
  [
    "senior",
    /(?:level|grade|seniority|уровень|грейд)\s*[:\-–]?\s*#?(?:senior|сеньор|синьор)|#senior\b|\bwe(?:'re| are) (?:looking for|hiring|seeking) an? (?:experienced |strong )?senior\b|ищем (?:опытного )?(?:senior|сеньор)/i,
  ],
  [
    "middle",
    /(?:level|grade|seniority|уровень|грейд)\s*[:\-–]?\s*#?(?:middle|mid|мидл)|#middle\b|\bwe(?:'re| are) (?:looking for|hiring|seeking) an? (?:mid-level|middle)\b|ищем (?:middle|мидл)/i,
  ],
  [
    "junior",
    /(?:level|grade|seniority|уровень|грейд)\s*[:\-–]?\s*#?(?:junior|entry|джун)|#junior\b|\bwe(?:'re| are) (?:looking for|hiring|seeking) an? junior\b|ищем (?:junior|джуна)/i,
  ],
];

export function seniorityOf(title: string, text: string): Seniority {
  for (const [grade, pattern] of grades) if (pattern.test(title)) return grade;
  const head = text.slice(0, 4000);
  for (const [grade, pattern] of gradeInText)
    if (pattern.test(head)) return grade;
  return "unknown";
}

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
  одного: 1,
  двух: 2,
  трех: 3,
  трёх: 3,
  четырех: 4,
  четырёх: 4,
  пяти: 5,
  шести: 6,
  семи: 7,
  восьми: 8,
  десяти: 10,
};
const num =
  "(?<![\\d.,])(\\d{1,2}(?:[.,]5)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|одного|двух|тр[её]х|четыр[её]х|пяти|шести|семи|восьми|десяти)";
const yearPatterns = [
  // "3-5 years", "3 to 5 years", "от 3 до 5 лет"
  new RegExp(
    `${num}\\s*\\+?\\s*(?:[-–—]|to|до)\\s*${num}\\s*\\+?\\s*(?:years?|yrs?|лет|года?)`,
    "gi",
  ),
  // "5+ years", "5 years", "at least 5 years", "minimum of 5 years"
  new RegExp(`${num}\\s*(?:\\+|plus)?\\s*(?:years?|yrs?)`, "gi"),
  // "от 3 лет", "не менее 3 лет", "3+ года", "от 3-х лет"
  new RegExp(
    `(?:от|не менее|минимум|более|больше)\\s*${num}(?:-?[хи]|-?ти)?\\s*(?:лет|года?|год)`,
    "gi",
  ),
  new RegExp(`${num}\\s*\\+\\s*(?:лет|года?|год)`, "gi"),
  // "опыт 3 года"
  new RegExp(`${num}(?:-?[хи]|-?ти)?\\s*(?:лет|года?)(?![а-яё])`, "gi"),
];
const experienceContext =
  /experience|exp\b|background|track record|working with|work with|developing|building|в разработке|опыт|коммерческ|стаж|разработк|programming|engineering|industry|professional|hands-on|production/i;
const noise =
  /\b(?:ago|old|founded|since|history|anniversary|in business|warranty|of age|age)\b|лет назад|возраст|основан/i;
const companyAge =
  /^[\s,]*(?:now\s+)?(?:we|we['’]ve|we['’]re|our|the company|it has|they)\b|^[\s,]*(?:мы|наша|компания)(?![а-яё])/i;

const toNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const word =
    numberWords[value.toLowerCase().replace("ё", "е")] ??
    numberWords[value.toLowerCase()];
  if (word !== undefined) return word;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

/**
 * Minimum years of experience: the lower bound of each "N+ years",
 * "N-M years", "от N лет" said about experience; the largest of those
 * bounds (the overall requirement, not a sub-skill one).
 */
export function yearsMinOf(text: string): number | null {
  let best: number | null = null;
  const taken: [number, number][] = [];
  for (const pattern of yearPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      const around = text.slice(
        Math.max(0, start - 80),
        Math.min(text.length, end + 80),
      );
      if (
        !experienceContext.test(around) ||
        noise.test(text.slice(end, end + 25)) ||
        // "For over 11 years, we've been building…" is the company's age.
        companyAge.test(text.slice(end, end + 30))
      )
        continue;
      const value = toNumber(match[1]);
      if (value === null || value < 0 || value > 20) continue;
      taken.push([start, end]);
      best = best === null ? value : Math.max(best, value);
    }
  }
  return best;
}

const remoteYes =
  /\b(?:fully[\s-]remote|100% remote|remote[\s-](?:first|only|friendly|work|position|role|job|opportunity|team|company|option)|work from anywhere|work from home|wfh|fully distributed|remote\b(?! sensing))|удал[её]нн?\w*|удаленк[а-яё]*|из любой (?:точки|страны)/i;
const remoteNo =
  /\b(?:not (?:a )?remote|no remote|on-?site only|onsite only|in[- ]office only|this (?:role|position) is (?:on-?site|in[- ]office|hybrid)|must be (?:located|based) (?:in|near) (?:our|the) office)\b|без удал[её]нки|только офис/i;
const officeOrHybrid =
  /\b(?:hybrid|on-?site|in[- ]office|office[- ]based|days? (?:a|per) week in (?:the )?office)\b|гибрид[а-яё]*|в офисе|офис[а-яё]*/i;

/** Remote from the title and the first part of the text: true, false (on-site or hybrid) or unknown. */
export function remoteOf(title: string, text: string): boolean | null {
  const blob = `${title}\n${text.slice(0, 5000)}`;
  if (remoteNo.test(blob)) return false;
  if (remoteYes.test(blob)) return true;
  if (officeOrHybrid.test(blob)) return false;
  return null;
}

const languages: [string, RegExp][] = [
  ["English", /\benglish\b|английск[а-яё]*/i],
  ["Russian", /\brussian\b|русск[а-яё]*/i],
  ["Ukrainian", /\bukrainian\b|украинск[а-яё]*/i],
  ["German", /\bgerman\b|\bdeutsch\b|немецк[а-яё]*/i],
  ["French", /\bfrench\b|французск[а-яё]*/i],
  ["Spanish", /\bspanish\b|испанск[а-яё]*/i],
  ["Portuguese", /\bportuguese\b|португальск[а-яё]*/i],
  ["Italian", /\bitalian\b|итальянск[а-яё]*/i],
  ["Dutch", /\bdutch\b|нидерландск[а-яё]*|голландск[а-яё]*/i],
  ["Polish", /\bpolish\b(?! (?:the|your|our|ui|code))|польск[а-яё]*/i],
  ["Czech", /\bczech\b|чешск[а-яё]*/i],
  ["Romanian", /\bromanian\b|румынск[а-яё]*/i],
  ["Hungarian", /\bhungarian\b|венгерск[а-яё]*/i],
  ["Greek", /\bgreek\b|греческ[а-яё]*/i],
  ["Turkish", /\bturkish\b|турецк[а-яё]*/i],
  ["Hebrew", /\bhebrew\b|иврит[а-яё]*/i],
  ["Arabic", /\barabic\b|арабск[а-яё]*/i],
  ["Georgian", /\bgeorgian\b|грузинск[а-яё]*/i],
  ["Armenian", /\barmenian\b|армянск[а-яё]*/i],
  ["Kazakh", /\bkazakh\b|казахск[а-яё]*/i],
  ["Swedish", /\bswedish\b|шведск[а-яё]*/i],
  ["Norwegian", /\bnorwegian\b|норвежск[а-яё]*/i],
  ["Danish", /\bdanish\b|датск[а-яё]*/i],
  ["Finnish", /\bfinnish\b|финск[а-яё]*/i],
  ["Chinese", /\b(?:chinese|mandarin|cantonese)\b|китайск[а-яё]*/i],
  ["Japanese", /\bjapanese\b|японск[а-яё]*/i],
  ["Korean", /\bkorean\b|корейск[а-яё]*/i],
  ["Hindi", /\bhindi\b/i],
  ["Vietnamese", /\bvietnamese\b|вьетнамск[а-яё]*/i],
  ["Indonesian", /\b(?:indonesian|bahasa)\b/i],
];
const proficiency =
  /fluen|proficien|native|mother tongue|business[\s-]level|conversational|working (?:knowledge|proficiency)|written and (?:spoken|verbal)|spoken|speak|speaking|bilingual|\blanguage\b|\blevel\b|\b[abc][12]\b\+?|intermediate|upper|advanced|communication skills|язык|уровень|уровне|разговорн|свободн|владени|знание|носител/i;

/** Spoken languages the text asks for ("fluent German", "English B2+", "английский язык"). */
export function languagesOf(text: string): string[] {
  const found: { name: string; index: number }[] = [];
  const sentences = text.split(/(?<=[.!?;])\s+|\n+/);
  let offset = 0;
  for (const sentence of sentences) {
    for (const [name, pattern] of languages) {
      const match = sentence.match(pattern);
      if (!match) continue;
      const rest = sentence.replace(match[0], " ");
      const speaking = /[-\s]speaking\b|говорящ/i.test(
        sentence.slice(
          (match.index ?? 0) + match[0].length,
          (match.index ?? 0) + match[0].length + 12,
        ),
      );
      if (!speaking && !proficiency.test(rest)) continue;
      if (!found.some((item) => item.name === name))
        found.push({ name, index: offset + (match.index ?? 0) });
    }
    offset += sentence.length + 1;
  }
  return found
    .sort((a, b) => a.index - b.index)
    .map((item) => item.name)
    .slice(0, 20);
}

const titleFocus: [RoleFocus, RegExp][] = [
  ["fullstack", /full[\s-]?stack|фул+[\s-]?стек|фулстек/i],
  [
    "frontend",
    /front[\s-]?end|фронт|\breact\b(?! native)|\bvue\b|angular|\bui\b|web developer|javascript|next\.js|typescript developer|game developer|svelte/i,
  ],
  [
    "mobile",
    /\bmobile\b|\bios\b|android|react native|flutter|swift|kotlin multiplatform|мобильн/i,
  ],
  ["backend", /back[\s-]?end|бэк|бек[\s-]?энд|бекенд/i],
  [
    "ai",
    /\b(?:ai|ml|llm|genai|gen ai|machine learning|deep learning|nlp|computer vision|data scien\w*|applied scientist|research engineer|prompt)\b|искусственн[а-яё]* интеллект|машинн[а-яё]* обучени/i,
  ],
  [
    "other",
    /customer|solutions|support|sales|account|manager|analyst|\bqa\b|tester|test engineer|designer|recruit|marketing|product owner|scrum|writer/i,
  ],
  [
    "backend",
    /node\.?js|python|golang|\bgo\b|java\b|\bphp\b|ruby|\.net|c#|\brust\b|scala|elixir|platform|infrastructure|cloud|devops|\bsre\b|data engineer|integrations?|\bapis?\b/i,
  ],
];

const count = (body: string, pattern: RegExp) =>
  (body.match(pattern) ?? []).length;

/** Role focus from the title (Work Finder's order), else from what the text stresses. */
export function roleFocusOf(title: string, text: string): RoleFocus {
  for (const [focus, pattern] of titleFocus)
    if (pattern.test(title)) return focus;
  const body = text.toLowerCase();
  const front = count(
    body,
    /react|vue|angular|css|frontend|front-end|\bui\b|\bux\b|next\.js|redux|browser|web app/g,
  );
  const back = count(
    body,
    /backend|back-end|\bapis?\b|microservice|postgres|mysql|database|kafka|node\.js|nestjs|\bsql\b|docker|kubernetes|\baws\b|\bgcp\b|distributed|server|java\b|golang|python|\.net|c#|ruby|scala/g,
  );
  const ai = count(
    body,
    /\bllms?\b|\brag\b|langchain|openai|anthropic|embeddings|machine learning|\bml\b|prompt|fine-tun|pytorch|tensorflow|ai agents?|agentic/g,
  );
  const mobile = count(
    body,
    /\bios\b|android|swift|kotlin|react native|flutter|mobile app/g,
  );
  if (mobile >= 3 && mobile > front && mobile > back) return "mobile";
  if (ai >= 4 && ai >= front && ai >= back) return "ai";
  if (front >= 2 * Math.max(back, 1)) return "frontend";
  if (back >= 2 * Math.max(front, 1)) return "backend";
  return front >= 3 && back >= 3 ? "fullstack" : "other";
}

/**
 * Level 2 of a vacancy, by code: technologies from the lexicon (title
 * mentions weigh more), grade, minimum years, remote, spoken languages and
 * role focus.
 */
export function structureVacancy(
  text: string,
  title: string,
): VacancyStructure {
  const score = new Map<string, number>();
  const first = new Map<string, number>();
  const add = (
    hits: ReturnType<typeof findTechnologies>,
    weight: number,
    base: number,
  ) => {
    for (const hit of hits) {
      score.set(hit.canonical, (score.get(hit.canonical) ?? 0) + weight);
      if (!first.has(hit.canonical)) first.set(hit.canonical, base + hit.index);
    }
  };
  add(findTechnologies(title), 5, 0);
  add(findTechnologies(text), 1, title.length + 1);
  const technologies = [...score.keys()]
    .sort(
      (a, b) =>
        (score.get(b) ?? 0) - (score.get(a) ?? 0) ||
        (first.get(a) ?? 0) - (first.get(b) ?? 0),
    )
    .slice(0, 200);
  return {
    technologies,
    seniority: seniorityOf(title, text),
    yearsMin: yearsMinOf(text),
    remote: remoteOf(title, text),
    languages: languagesOf(text),
    roleFocus: roleFocusOf(title, text),
  };
}
