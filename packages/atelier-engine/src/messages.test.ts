import { describe, expect, it } from "vitest";
import { assembleCv } from "./assemble.js";
import { analysisOf, fieldsOf, profile, req } from "./fixtures/profile.js";
import { answerForm } from "./form.js";
import { emailRu, telegramRu, textChecks } from "./messages.js";
import { textsPrompt } from "./prompts/texts.js";
import { rolePolicy } from "./role-policy.js";
import { selectCases } from "./selection.js";

const requirements = [
  req("R1", "Strong React interfaces", ["FE"], "must", ["React", "TypeScript"]),
  req("R2", "Node.js services", ["BE"], "responsibility", [
    "Node.js",
    "Elixir",
  ]),
];
const analysis = analysisOf(requirements);
const fields = fieldsOf(
  "Acme Robotics builds warehouse robots and hires a Senior Frontend Engineer.",
);

describe("Russian templates", () => {
  it("fills the neutral built-in template from the profile and the vacancy", () => {
    const text = telegramRu(profile, analysis, fields);
    expect(text.split("\n\n")).toEqual([
      "Доброго времени суток!",
      "Увидел вакансию Senior Frontend Engineer, хотел бы узнать подробнее.",
      "Я Jordan, в коммерческой разработке больше 5 лет, стек: React, TypeScript, Node.js.",
      "Было бы интересно узнать подробнее про продукт: какая сейчас нагрузка, на каком он этапе и как устроена команда.",
      "Буду рад пообщаться :)",
      "Резюме прикрепил",
    ]);
  });

  it("uses the profile's own wording and a Russian product question when there is one", () => {
    const own = {
      ...profile,
      voice: {
        ...profile.voice,
        telegramTemplateRu:
          "Привет! Вакансия {role} — {stack}, {years}+ лет. {question} {unknown}",
      },
    };
    const text = telegramRu(
      own,
      { ...analysis, productQuestion: "Какая нагрузка на систему?" },
      fields,
    );
    expect(text).toBe(
      "Привет! Вакансия Senior Frontend Engineer - React, TypeScript, Node.js, 5+ лет. Какая нагрузка на систему? {unknown}",
    );
  });

  it("signs the email and puts the role and the name in the subject", () => {
    const email = emailRu(profile, analysis, fields);
    expect(email.subject).toBe("Senior Frontend Engineer: Jordan Vale");
    expect(email.body.endsWith("Резюме прикрепил\n\nJordan")).toBe(true);
  });
});

describe("textChecks", () => {
  it("replaces long dashes and names stop phrases", () => {
    const result = textChecks(
      "I'm excited to apply — this is a great fit.",
      "email_en",
    );
    expect(result.text).toBe("I'm excited to apply - this is a great fit.");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'Stop phrase: "i\'m excited to apply"',
        'Stop phrase: "great fit"',
        "email_en: 10 words, at least 50 expected",
      ]),
    );
  });

  it("counts a LinkedIn invitation in code points", () => {
    expect(textChecks("🙂".repeat(300), "linkedin_connect").issues).toEqual([]);
    expect(
      textChecks(`${"🙂".repeat(300)}x`, "linkedin_connect").issues,
    ).toEqual(["linkedin_connect: 301 characters, the limit is 300"]);
  });

  it("keeps smileys out of a cover letter and flags empty texts", () => {
    expect(
      textChecks(`${"word ".repeat(150)}:)`, "cover_letter").issues,
    ).toEqual(["cover_letter: no smiley in a cover letter"]);
    expect(textChecks("  ", "answer").issues).toEqual(["Empty text"]);
  });
});

describe("textsPrompt", () => {
  const selection = selectCases(
    profile,
    requirements,
    [],
    rolePolicy(requirements, analysis.title),
  );
  const cv = assembleCv(profile, analysis, selection, {
    about: profile.summary,
    bullets: [],
    newBullets: [],
    changeNotes: [],
  });
  const input = {
    profile,
    analysis,
    fields,
    cv,
    kinds: ["cover_letter", "linkedin_connect"] as const,
    questions: ["Why Acme?", " About you "],
  };

  it("asks for the requested kinds and questions in the profile's voice", () => {
    const prompt = textsPrompt({ ...input, kinds: [...input.kinds] });
    expect(prompt.system).toContain("cover_letter: subject null");
    expect(prompt.system).not.toContain("email_en:");
    expect(prompt.input).toContain('QUESTIONS=["Why Acme?","About you"]');
    expect(prompt.input).toContain(
      'VOICE_RULES=["Write simply, in short sentences."',
    );
  });

  it("keeps questions verbatim and in order, one material per kind", () => {
    const prompt = textsPrompt({ ...input, kinds: [...input.kinds] });
    const parsed = prompt.parse({
      materials: [
        {
          kind: "linkedin_connect",
          locale: "en",
          subject: "Ignored",
          body: "Hi — let's connect.",
        },
        {
          kind: "cover_letter",
          locale: "en",
          subject: null,
          body: "Dear team,",
        },
        { kind: "email_en", locale: "en", subject: "Not requested", body: "x" },
      ],
      answers: [
        { question: "About you", answer: "I build products end to end." },
        { question: "Why this company?", answer: "Robots." },
      ],
    });
    expect(parsed.materials).toEqual([
      { kind: "cover_letter", locale: "en", subject: null, body: "Dear team," },
      {
        kind: "linkedin_connect",
        locale: "en",
        subject: null,
        body: "Hi - let's connect.",
      },
    ]);
    expect(parsed.answers).toEqual([
      { question: "Why Acme?", answer: "Robots." },
      { question: "About you", answer: "I build products end to end." },
    ]);
    expect(() => prompt.parse({ materials: [], answers: [] })).toThrow(
      "no cover_letter",
    );
  });
});

describe("answerForm", () => {
  const ask = (
    question: string,
    options: string[] | null = null,
    vacancy = fields,
  ) => answerForm(question, options, profile, vacancy);

  it("states salary from the vacancy's range, a single bound or the profile's floor", () => {
    expect(ask("What are your salary expectations?").answer).toBe(
      "From 4,000 EUR gross per month, flexible depending on the package",
    );
    const range = fieldsOf("x", {
      salary: { min: 60000, max: 80000, currency: "USD", period: "year" },
    });
    expect(ask("Desired compensation", null, range).answer).toBe(
      "70,000 USD gross per year, flexible depending on the package",
    );
    expect(
      ask("Expected monthly salary (number only)", null, range).answer,
    ).toBe("5800");
    const bound = fieldsOf("x", {
      salary: { min: null, max: 5000, currency: "EUR", period: "month" },
    });
    expect(ask("Salary expectations", null, bound).answer).toBe(
      "From 5,000 EUR gross per month, flexible depending on the package",
    );
    expect(
      ask("Expected annual salary", ["Under 40k", "40k - 60k", "60k+"]).answer,
    ).toBe("40k - 60k");
  });

  it("answers notice, start date, location, timezone, years and links from the profile", () => {
    expect(ask("What is your notice period?")).toMatchObject({
      answer: "2 weeks notice period",
      key: "notice",
    });
    expect(ask("When can you start?").answer).toBe(
      "In 2 weeks, after my notice period",
    );
    expect(
      ask("Notice period", ["Immediately", "2 weeks", "1 month"]).answer,
    ).toBe("2 weeks");
    expect(ask("Current location").answer).toBe("Lisbon, Portugal");
    expect(ask("City").answer).toBe("Lisbon");
    expect(ask("Country of residence").answer).toBe("Portugal");
    expect(ask("Your timezone").answer).toBe("GMT+0");
    expect(ask("How many years of experience do you have?").answer).toBe("5");
    expect(ask("Years of experience", ["0-2", "3-5", "6+"]).answer).toBe("3-5");
    expect(ask("LinkedIn profile").answer).toBe(profile.person.linkedin);
    expect(ask("GitHub").answer).toBe(profile.person.github);
    expect(ask("Portfolio or website").answer).toBe(profile.person.website);
  });

  it("answers authorization and sponsorship for remote work, relocation and work format", () => {
    expect(
      ask("Will you now or in the future require visa sponsorship?", [
        "Yes",
        "No",
      ]).answer,
    ).toBe("No");
    expect(
      ask("Are you legally authorized to work in the United States?", [
        "Yes",
        "No",
      ]).answer,
    ).toBe("No");
    expect(ask("Are you authorized to work in the country?").answer).toBe(
      "Yes. I work remotely from Portugal as a B2B contractor, so no visa sponsorship is needed.",
    );
    const office = fieldsOf("x", { remote: false });
    expect(
      ask(
        "Are you legally authorized to work in the United States?",
        ["Yes", "No"],
        office,
      ),
    ).toEqual({
      answer: "No",
      confidence: 0.9,
      key: "work_authorization",
    });
    expect(ask("Are you willing to relocate?", ["Yes", "No"]).answer).toBe(
      "No",
    );
    expect(
      ask("Preferred work arrangement", ["On-site", "Hybrid", "Remote"]).answer,
    ).toBe("Remote");
  });

  it("declines demographic questions, skips pronouns and names the current job", () => {
    expect(
      ask("Gender", ["Male", "Female", "Decline to self-identify"]).answer,
    ).toBe("Decline to self-identify");
    expect(
      ask("Veteran status", [
        "I am a veteran",
        "I am not a veteran",
        "I don't wish to answer",
      ]).answer,
    ).toBe("I don't wish to answer");
    expect(
      ask("Race / ethnicity", ["Asian", "White", "Prefer not to say"]),
    ).toMatchObject({ answer: "Prefer not to say", key: "eeo_race" });
    expect(ask("Your pronouns")).toEqual({
      answer: null,
      confidence: 1,
      key: "pronouns",
    });
    expect(ask("Current company").answer).toBe("Signal Labs");
    expect(ask("Current job title").answer).toBe("AI Engineer");
    expect(
      ask("How did you hear about us?", [
        "LinkedIn",
        "Company website",
        "Referral",
      ]).answer,
    ).toBe("Company website");
    expect(ask("What is your favourite colour?")).toEqual({
      answer: null,
      confidence: 0,
      key: "unknown",
    });
  });
});
