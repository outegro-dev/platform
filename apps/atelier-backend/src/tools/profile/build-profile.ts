import { type Profile, profileSchema } from "@outegro/contracts/atelier";
import { z } from "zod";
import type { ParsedContent } from "./content-tex.js";
import type { Voice } from "./voice.js";

/** Company ids from the names in the bank and the CV ("FridayTech" → fridaytech). */
export const companyIdOf = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40) || "company";

const quotaSchema = z.object({
  target: z.number().int().min(0).max(20),
  min: z.number().int().min(0).max(20),
});

/**
 * What the CV files do not say: the company order and bullet quotas
 * (general and AI template), form answers, mode and layout. Personal, so it
 * lives next to the bank (`atelier-settings.json` in the Work Finder
 * folder), never in this repo.
 */
export const profileSettingsSchema = z.object({
  companies: z.object({
    order: z.array(z.string().min(1)).max(20),
    quotas: z.record(
      z.string(),
      z.object({ general: quotaSchema, ai: quotaSchema }),
    ),
  }),
  form: profileSchema.shape.form,
  factsMode: profileSchema.shape.factsMode,
  font: profileSchema.shape.font,
  maxPages: profileSchema.shape.maxPages,
  baseYears: profileSchema.shape.baseYears,
});
export type ProfileSettings = z.infer<typeof profileSettingsSchema>;

type BankFile = {
  bankVersion: number;
  cases: (Record<string, unknown> & {
    company: string;
    whenVacancyMentions?: unknown;
  })[];
};

const clip = (value: string, max: number) =>
  value.length <= max ? value : value.slice(0, max).trimEnd();

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? name,
    lastName: parts.slice(1).join(" ") || (parts[0] ?? name),
  };
}

/**
 * A Profile from the bank (cases keep their ids, company → companyId), the
 * parsed content.tex, the voice file and the owner's settings; validated
 * with profileSchema.
 */
export function buildProfile(input: {
  bank: BankFile;
  content: ParsedContent;
  voice: Voice;
  settings: ProfileSettings;
}): Profile {
  const { bank, content, voice, settings } = input;
  const { companies: layout, ...options } = settings;
  const links = content.links;
  const email = links
    .find((link) => link.url.startsWith("mailto:"))
    ?.url.replace(/^mailto:/, "");
  const byHost = (pattern: RegExp) =>
    links.find((link) => pattern.test(link.url))?.url ?? null;
  const website =
    links.find(
      (link) =>
        !/^mailto:|linkedin\.com|github\.com|t\.me\/|telegram\.me/i.test(
          link.url,
        ),
    )?.url ?? null;
  const order = layout.order;
  const companies = content.jobs.map((job, index) => {
    const id = companyIdOf(job.company);
    const position = order.indexOf(id);
    const quota = layout.quotas[id];
    return {
      id,
      name: clip(job.company, 120),
      title: clip(job.title, 120),
      dates: clip(job.dates, 60),
      location: clip(job.location, 60),
      description: clip(job.description, 200),
      order: position >= 0 ? position : order.length + index,
      quota: quota ?? {
        general: { target: 0, min: 0 },
        ai: { target: 0, min: 0 },
      },
      // Companies without cases print their own bullets as they are.
      fixedBullets: quota
        ? []
        : job.bullets.slice(0, 10).map((bullet) => clip(bullet, 700)),
      aiOnly: false,
    };
  });
  const profile = {
    person: {
      name: content.header.name,
      ...splitName(content.header.name),
      location: content.header.location,
      phoneDisplay: content.header.phoneDisplay,
      phoneDigits: content.header.phoneDigits,
      email,
      links: links.slice(0, 8),
      linkedin: byHost(/linkedin\.com/i),
      github: byHost(/github\.com/i),
      website,
    },
    headline: clip(content.header.headline, 120),
    stack: clip(content.header.stack, 160),
    summary: {
      profile: {
        full: content.summary.profile,
        compact: content.summary.profile,
      },
      aiTools: {
        full: content.summary.aiTools,
        compact: content.summary.aiTools,
      },
    },
    skills: content.skills.map((row) => ({
      label: clip(row.label, 60),
      items: row.items.map((item) => clip(item, 80)),
    })),
    companies,
    education: content.education,
    languages: content.languages,
    ...options,
    voice,
    bank: {
      bankVersion: bank.bankVersion,
      cases: bank.cases.map(({ company, whenVacancyMentions, ...rest }) => ({
        ...rest,
        companyId: companyIdOf(company),
        ...(Array.isArray(whenVacancyMentions) && whenVacancyMentions.length
          ? { whenVacancyMentions }
          : {}),
      })),
    },
  };
  return profileSchema.parse(profile);
}
