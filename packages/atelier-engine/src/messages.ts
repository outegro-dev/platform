import type {
  Profile,
  VacancyAnalysis,
  VacancyFields,
} from "@outegro/contracts/atelier";
import { tenureYears } from "./adaptation.js";
import { skillInventory, vacancyTechnologies } from "./skills.js";
import { withoutLongDash, wordCount } from "./text.js";

/*
 * Texts built from slots without a model: the Russian Telegram message to an
 * HR and the Russian email (template of 08_VOICE §4–5 of Work Finder). The
 * wording is the profile's own (`voice.telegramTemplateRu`); the built-in
 * template below is neutral and holds no facts about anyone.
 */

const builtInTemplateRu = [
  "Доброго времени суток!",
  "",
  "Увидел вакансию {role}, хотел бы узнать подробнее.",
  "",
  "Я {name}, в коммерческой разработке больше {years} лет, стек: {stack}.",
  "",
  "{question}",
  "",
  "Буду рад пообщаться :)",
  "",
  "Резюме прикрепил",
].join("\n");

const defaultQuestionRu =
  "Было бы интересно узнать подробнее про продукт: какая сейчас нагрузка, на каком он этапе и как устроена команда.";

/** Up to four technologies the vacancy asks for and the profile has, else the profile's stack line. */
function stackSlot(profile: Profile, analysis: VacancyAnalysis) {
  const inventory = skillInventory(profile);
  const named = vacancyTechnologies(analysis.requirements)
    .filter((item) => inventory.has(item.key))
    .slice(0, 4)
    .map((item) => item.value);
  return named.length ? named.join(", ") : profile.stack;
}

/**
 * The product question of the analysis when it is written in Russian; the
 * analysis asks it in English, so a Russian message otherwise uses a neutral
 * question about load, stage and team.
 */
function questionSlotRu(analysis: VacancyAnalysis) {
  const question = analysis.productQuestion?.trim();
  return question && /[А-Яа-яЁё]/.test(question) ? question : defaultQuestionRu;
}

/** Slot values of the Russian templates. */
function slotsRu(
  profile: Profile,
  analysis: VacancyAnalysis,
  fields: VacancyFields,
) {
  return {
    role: analysis.title || fields.title,
    title: fields.title,
    company: analysis.company || fields.company,
    years: String(tenureYears(analysis.requirements, profile.baseYears)),
    stack: stackSlot(profile, analysis),
    question: questionSlotRu(analysis),
    questionEn: analysis.productQuestion?.trim() ?? "",
    name: profile.person.firstName,
    fullName: profile.person.name,
  };
}

/** `{slot}` placeholders filled; unknown ones stay as they are. */
const fill = (template: string, slots: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => slots[key] ?? whole);

/** The six-line Telegram message to an HR, in Russian. */
export function telegramRu(
  profile: Profile,
  analysis: VacancyAnalysis,
  fields: VacancyFields,
): string {
  const template =
    profile.voice.telegramTemplateRu?.trim() || builtInTemplateRu;
  return withoutLongDash(fill(template, slotsRu(profile, analysis, fields)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The same message as a Russian email: subject "Роль: Имя", signed with the first name. */
export function emailRu(
  profile: Profile,
  analysis: VacancyAnalysis,
  fields: VacancyFields,
): { subject: string; body: string } {
  const slots = slotsRu(profile, analysis, fields);
  const message = telegramRu(profile, analysis, fields);
  const signature = profile.person.firstName;
  const signed = message.trimEnd().endsWith(signature)
    ? message
    : `${message}\n\n${signature}`;
  return {
    subject: withoutLongDash(`${slots.role}: ${profile.person.name}`),
    body: signed,
  };
}

/** Phrases that give a text away as generic or machine-written (07 and 08 of Work Finder). */
export const stopPhrases = [
  "i'm excited to apply",
  "i am excited to apply",
  "passionate about leveraging",
  "thrive in fast-paced",
  "fast-paced environment",
  "cutting-edge",
  "seamless",
  "delve",
  "in today's world",
  "in today's fast-paced",
  "great fit",
  "perfect fit",
  "synergy",
  "spearheaded",
  "willing to learn",
  "familiar with",
  "in my own projects",
  "i am confident that i would be",
  "рад откликнуться",
  "с большим энтузиазмом",
  "в современном мире",
  "идеально подхожу",
  "синергия",
  "передовые технологии",
  "бесшовн",
  "готов изучить",
  "готов учиться",
  "знаком с",
  "в своих проектах",
];

/** Length limits per channel: words, or code points for a LinkedIn invitation. */
const limits: Record<
  string,
  { minWords?: number; maxWords?: number; maxChars?: number }
> = {
  cover_letter: { minWords: 120, maxWords: 400 },
  email_en: { minWords: 50, maxWords: 170 },
  linkedin_inmail: { minWords: 50, maxWords: 170 },
  linkedin_connect: { maxChars: 300 },
  telegram_ru: { maxWords: 170 },
  email_ru: { maxWords: 190 },
  answer: { maxChars: 5000 },
};

/**
 * Checks after a text is written: long dashes become plain ones, and the
 * issues name stop phrases, channel length limits (a LinkedIn invitation is
 * at most 300 code points), an empty text and a smiley in a cover letter.
 */
export function textChecks(
  text: string,
  kind: string,
): { text: string; issues: string[] } {
  const fixed = withoutLongDash(text).replace(/—/g, "-");
  const issues: string[] = [];
  if (!fixed.trim()) issues.push("Empty text");
  const lower = fixed.toLowerCase().replace(/[’‘]/g, "'");
  for (const phrase of stopPhrases)
    if (lower.includes(phrase)) issues.push(`Stop phrase: "${phrase}"`);
  const limit = limits[kind];
  if (limit) {
    const words = wordCount(fixed);
    const chars = [...fixed].length;
    if (limit.maxChars !== undefined && chars > limit.maxChars)
      issues.push(
        `${kind}: ${chars} characters, the limit is ${limit.maxChars}`,
      );
    if (limit.maxWords !== undefined && words > limit.maxWords)
      issues.push(`${kind}: ${words} words, the limit is ${limit.maxWords}`);
    if (limit.minWords !== undefined && words < limit.minWords)
      issues.push(
        `${kind}: ${words} words, at least ${limit.minWords} expected`,
      );
  }
  if (kind === "cover_letter" && /:\)/.test(fixed))
    issues.push("cover_letter: no smiley in a cover letter");
  return { text: fixed, issues };
}
