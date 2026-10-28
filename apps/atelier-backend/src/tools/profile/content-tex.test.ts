import { describe, expect, it } from "vitest";
import { buildProfile, companyIdOf } from "./build-profile.js";
import {
  parseContentTex,
  plain,
  splitItems,
  stripComments,
} from "./content-tex.js";
import { parseVoice } from "./voice.js";

/** A made-up master CV in the macros of the "Minimal violet" template. */
const sample = String.raw`
% ============================================================================
% Alex Example | master CV content (made up for tests)
% ============================================================================
\hypersetup{pdftitle={Alex Example - CV}, pdfkeywords={TypeScript, React}}

\cvheader
  {Alex Example}
  {Example City, Exampleland}
  {+000 555 0100}{+0005550100}
  {Senior Full-Stack Engineer}
  {TypeScript · React · Node.js}
\cvlinks{%
  \cvlink{mailto:alex@example.com}{alex@example.com}\linksep
  \cvlink{https://linkedin.com/in/alex-example}{linkedin.com/in/alex-example}\linksep
  \cvlink{https://github.com/alex-example}{github.com/alex-example}\linksep
  \cvlink{https://alex.example.dev}{alex.example.dev}\linksep
  \cvlink{https://t.me/alex_example}{t.me/alex\_example}}

\cvsection{Summary}
\cvsummary{%
Engineer with \hl{6+ years of commercial experience} building SaaS with TypeScript, React~and Node.js. 100\% remote.%
}{%
Works with AI coding agents (Claude Code, Codex), keeping \hl{architecture} hands-on.%
}

\cvsection{Skills}
\begin{cvskills}
\cvskill{Languages}{TypeScript, JavaScript, SQL}
\cvskill{Testing}{Vitest, Playwright (E2E, visual), unit and integration tests}
\end{cvskills}

\cvsection{Professional Experience}

% FirstCo | product work
\cvjob{Full-Stack Engineer}{FirstCo}{Mar 2023 -- Present}{Remote}{A made-up product company with 1 million+ users}
\begin{cvbullets}
  \item Built a \hl{billing service} with idempotent webhooks.
  \item Cut page load from 2.2~s to 1.0~s.
\end{cvbullets}

\cvjob{Software Engineer}{Second Solution}{Jan 2020 -- Feb 2023}{Remote}{Web pages \& internal tools}
\begin{cvbullets}
  \item Developed \hl{landing pages} with lead forms.
  \item Extended an internal forum.
\end{cvbullets}

\cvsection{Education}
\cvedu{BSc in Computer Science}{Example University}{Sep 2016 -- May 2020}

\cvsection{Languages}
\cvlang{English}{C1, Full Professional Proficiency}
\cvlang{Exampleish}{Native}
`;

const bankCase = (id: string, company: string) => ({
  id,
  company,
  active: true,
  title: `Case ${id}`,
  projectId: `p-${id}`,
  achievementGroupId: id,
  primaryTheme: "delivery",
  secondaryThemes: [],
  technologies: ["TypeScript"],
  capabilities: [{ id: `${id}:api`, name: "api" }],
  categoryRatings: {
    FE: 1,
    BE: 4,
    AR: 3,
    RE: 2,
    PF: 0,
    QA: 1,
    SE: 0,
    OW: 3,
    EE: 2,
    CO: 0,
    UX: 0,
    AI: 0,
  },
  keyClaims: [{ id: `${id}:core`, text: "Built a service." }],
  metricClaims: [],
  whenVacancyMentions: null,
  variants: {
    full: "Built a billing service with idempotent webhooks for every client.",
    compact: "Built a billing service with idempotent webhooks.",
    minimal: "Built a billing service.",
  },
});

const voiceSample = `# Voice

## 1. Facts
Nothing here.

## 3. Стиль: главные правила

1. **No long dashes.** They give the text away.
2. Write like a person: \`short\` sentences.

## 4. Telegram-сообщение HR (шаблон)

Структура:

\`\`\`
Доброго времени суток!

Увидел вакансию на <роль>.
\`\`\`

## 6. About me, cover letter

Эталон about me (EN):

\`\`\`
Hi, I'm Alex! I write code.
\`\`\`
`;

describe("content.tex", () => {
  it("drops comments but keeps escaped percent signs", () => {
    expect(stripComments("a % note\nb 100\\% c%\n  d")).toBe("a b 100\\% cd");
  });

  it("turns LaTeX into text, with highlights only where asked", () => {
    expect(plain("A \\hl{bold} 1.7~s -- 2\\%")).toBe("A bold 1.7 s – 2%");
    expect(plain("A \\hl{bold} part", true)).toBe("A **bold** part");
    expect(splitItems("Vitest, Playwright (E2E, visual), unit tests")).toEqual([
      "Vitest",
      "Playwright (E2E, visual)",
      "unit tests",
    ]);
  });

  it("reads every macro of the master CV", () => {
    const parsed = parseContentTex(sample);
    expect(parsed.header).toEqual({
      name: "Alex Example",
      location: "Example City, Exampleland",
      phoneDisplay: "+000 555 0100",
      phoneDigits: "+0005550100",
      headline: "Senior Full-Stack Engineer",
      stack: "TypeScript · React · Node.js",
    });
    expect(parsed.links).toHaveLength(5);
    expect(parsed.links[4]).toEqual({
      url: "https://t.me/alex_example",
      text: "t.me/alex_example",
    });
    expect(parsed.summary.profile).toBe(
      "Engineer with **6+ years of commercial experience** building SaaS with TypeScript, React and Node.js. 100% remote.",
    );
    expect(parsed.summary.aiTools).toContain("**architecture**");
    expect(parsed.skills[1]).toEqual({
      label: "Testing",
      items: [
        "Vitest",
        "Playwright (E2E, visual)",
        "unit and integration tests",
      ],
    });
    expect(
      parsed.jobs.map((job) => [job.company, job.dates, job.bullets.length]),
    ).toEqual([
      ["FirstCo", "Mar 2023 – Present", 2],
      ["Second Solution", "Jan 2020 – Feb 2023", 2],
    ]);
    expect(parsed.jobs[0]?.bullets[0]).toBe(
      "Built a **billing service** with idempotent webhooks.",
    );
    expect(parsed.jobs[1]?.description).toBe("Web pages & internal tools");
    expect(parsed.education).toEqual([
      {
        degree: "BSc in Computer Science",
        school: "Example University",
        dates: "Sep 2016 – May 2020",
      },
    ]);
    expect(parsed.languages).toHaveLength(2);
  });

  it("reads the voice rules, the Telegram template and the about-me sample", () => {
    const voice = parseVoice(voiceSample);
    expect(voice.rules).toEqual([
      "No long dashes. They give the text away.",
      "Write like a person: short sentences.",
    ]);
    expect(voice.telegramTemplateRu).toBe(
      "Доброго времени суток!\n\nУвидел вакансию на <роль>.",
    );
    expect(voice.aboutMe).toBe("Hi, I'm Alex! I write code.");
  });

  it("builds a valid Profile: bank ids kept, companies keyed, fixed bullets for companies without quotas", () => {
    const profile = buildProfile({
      bank: { bankVersion: 3, cases: [bankCase("F1", "FirstCo")] },
      content: parseContentTex(sample),
      voice: parseVoice(voiceSample),
      settings: {
        companies: {
          order: ["firstco"],
          quotas: {
            firstco: {
              general: { target: 6, min: 4 },
              ai: { target: 5, min: 3 },
            },
          },
        },
        form: {
          location: "Lisbon, Portugal",
          timezone: "GMT+0",
          workFormat: "Remote",
          contract: "B2B contractor",
          relocation: false,
          needsSponsorship: false,
          salaryFrom: { amount: 3500, currency: "EUR", period: "month" },
          noticeWeeks: 4,
          eeo: "decline",
        },
        factsMode: "free",
        font: "plex",
        maxPages: 2,
        baseYears: 6,
      },
    });
    expect(profile.person).toMatchObject({
      firstName: "Alex",
      lastName: "Example",
      email: "alex@example.com",
      linkedin: "https://linkedin.com/in/alex-example",
      github: "https://github.com/alex-example",
      website: "https://alex.example.dev",
    });
    expect(profile.bank.cases[0]).toMatchObject({
      id: "F1",
      companyId: "firstco",
    });
    expect(profile.bank.cases[0]).not.toHaveProperty("whenVacancyMentions");
    const second = profile.companies.find(
      (company) => company.id === "secondsolution",
    );
    expect(second?.quota.general).toEqual({ target: 0, min: 0 });
    expect(second?.fixedBullets).toHaveLength(2);
    expect(profile.companies.find((c) => c.id === "firstco")).toMatchObject({
      order: 0,
      quota: { general: { target: 6, min: 4 } },
      fixedBullets: [],
    });
    expect(profile.form.salaryFrom).toEqual({
      amount: 3500,
      currency: "EUR",
      period: "month",
    });
    expect(profile).toMatchObject({
      factsMode: "free",
      font: "plex",
      maxPages: 2,
      baseYears: 6,
    });
    expect(companyIdOf("FridayTech")).toBe("fridaytech");
  });
});
