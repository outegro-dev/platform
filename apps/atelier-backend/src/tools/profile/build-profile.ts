import { type Profile, profileSchema } from "@outegro/contracts/atelier";
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

/** The owner's CV order and bullet quotas (target/min), general and AI template. */
export const ownerCompanies = {
  order: ["toggle", "printify", "kommo", "fridaytech", "advicesolution"],
  quotas: {
    printify: { general: { target: 8, min: 6 }, ai: { target: 7, min: 5 } },
    kommo: { general: { target: 5, min: 4 }, ai: { target: 4, min: 3 } },
    fridaytech: { general: { target: 4, min: 3 }, ai: { target: 3, min: 2 } },
    toggle: { general: { target: 4, min: 3 }, ai: { target: 6, min: 4 } },
  } as Record<
    string,
    {
      general: { target: number; min: number };
      ai: { target: number; min: number };
    }
  >,
} as const;

/** Form answers, mode and layout of the owner's profile. */
export const ownerSettings = {
  form: {
    location: "Tbilisi, Georgia",
    timezone: "GMT+4",
    workFormat: "Remote",
    contract: "B2B contractor (Georgian individual entrepreneur)",
    relocation: false,
    needsSponsorship: false,
    salaryFrom: { amount: 4000, currency: "USD", period: "month" as const },
    noticeWeeks: 2,
    eeo: "decline" as const,
  },
  factsMode: "free" as const,
  font: "plex" as const,
  maxPages: 2 as const,
  baseYears: 6,
};

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
 * parsed content.tex and the voice file; validated with profileSchema.
 */
export function buildProfile(input: {
  bank: BankFile;
  content: ParsedContent;
  voice: Voice;
}): Profile {
  const { bank, content, voice } = input;
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
  const order = ownerCompanies.order as readonly string[];
  const companies = content.jobs.map((job, index) => {
    const id = companyIdOf(job.company);
    const position = order.indexOf(id);
    const quota = ownerCompanies.quotas[id];
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
    ...ownerSettings,
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
