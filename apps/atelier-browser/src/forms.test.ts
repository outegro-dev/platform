import {
  type BrowserApplyRequest,
  type BrowserApplyResponse,
  browserApplyResponseSchema,
} from "@outegro/contracts/atelier";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTEXT_OPTIONS } from "./browser/browser-pool.js";
import { runApply } from "./engine/apply.js";
import {
  type FixtureServer,
  startFixtureServer,
} from "./test/fixture-server.js";
import { applyRequest, CV_NAME } from "./test/request.js";

/**
 * The engine against local HTML imitations of each ATS form, served on
 * 127.0.0.1. Every other host is aborted: tests never reach a real site.
 */
let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

type Run = { res: BrowserApplyResponse; reports: Record<string, unknown> };

async function run(
  req: BrowserApplyRequest,
  trustUrl = true,
  submitWaitMs?: number,
): Promise<Run> {
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const reports: Record<string, unknown> = {};
  await context.exposeFunction(
    "atelierFixtureReport",
    (key: string, value: unknown) => {
      reports[key] = value;
    },
  );
  await context.route("**/*", (route) => {
    const url = route.request().url();
    return url.startsWith("http://127.0.0.1:") || url.startsWith("about:")
      ? route.continue()
      : route.abort();
  });
  try {
    const res = await runApply(context, req, {
      deadline: Date.now() + 110_000,
      trustUrl,
      submitWaitMs,
    });
    browserApplyResponseSchema.parse(res);
    return { res, reports };
  } finally {
    await context.close();
  }
}

const value = (res: BrowserApplyResponse, label: string) =>
  res.filled.find((entry) => entry.label === label)?.value;
const missing = (res: BrowserApplyResponse, label: string) =>
  res.unanswered.find((entry) => entry.label === label);
const isJpeg = (base64: string | null) =>
  base64 !== null &&
  Buffer.from(base64, "base64").subarray(0, 3).toString("hex") === "ffd8ff";

const COVER =
  "I build backend services in TypeScript and would like to do it at Acme.";

describe("Ashby fixture", () => {
  const applyUrl = () => server.url("/ashby/acme/0b1c2d3e/application");

  it("prepares: profile fields, CV, location suggestion, EEO declined, questions listed", async () => {
    const { res } = await run(
      applyRequest({ ats: "ashby", applyUrl: applyUrl() }),
    );
    expect(res.status).toBe("prepared");
    expect(res.reason).toBeNull();
    expect(value(res, "Name")).toBe("Alex Example");
    expect(value(res, "Email")).toBe("alex@example.com");
    expect(value(res, "Resume")).toBe(CV_NAME);
    expect(value(res, "LinkedIn Profile")).toBe(
      "https://www.linkedin.com/in/alex-example",
    );
    expect(value(res, "Which country do you intend to work from?")).toBe(
      "Tbilisi, Georgia",
    );
    expect(value(res, "What is your gender identity?")).toBe(
      "I prefer not to answer",
    );
    expect(
      value(
        res,
        "Which ethnicity(ies) do you identify with? Please select all that apply.",
      ),
    ).toBe("I prefer not to answer");
    // The autofill uploader is left alone: the CV goes in once.
    expect(res.filled.filter((entry) => entry.value === CV_NAME)).toHaveLength(
      1,
    );

    expect(
      missing(
        res,
        "Will you now or in the future require sponsorship for employment visa status to work in this location?",
      ),
    ).toEqual(
      expect.objectContaining({
        type: "buttons",
        required: true,
        options: ["Yes", "No"],
      }),
    );
    expect(
      missing(
        res,
        "What's the most recent thing you've built or shipped? Walk us through what it was and why you did it.",
      ),
    ).toEqual(expect.objectContaining({ type: "textarea", required: true }));
    expect(missing(res, "How did you hear about this role?")).toEqual(
      expect.objectContaining({
        type: "radio",
        required: false,
        options: ["LinkedIn", "A friend", "Job board"],
      }),
    );
    expect(
      missing(
        res,
        "Do you currently live in the EMEA timezone? If not, please explain why you're applying to this role",
      ),
    ).toEqual(expect.objectContaining({ type: "text", required: false }));
    // The conditional question stays hidden until TypeScript is answered.
    expect(
      missing(res, "How many years of TypeScript experience do you have?"),
    ).toBeUndefined();
    expect(isJpeg(res.screenshotBase64)).toBe(true);
  });

  it("submits with the answers, including a question revealed by an answer", async () => {
    const { res, reports } = await run(
      applyRequest({
        ats: "ashby",
        applyUrl: applyUrl(),
        mode: "submit",
        answers: [
          {
            question:
              "Will you require visa sponsorship to work in this location?",
            answer: "No",
          },
          {
            question: "Have you worked with TypeScript in production?",
            answer: "Yes",
          },
          {
            question: "How many years of TypeScript experience do you have?",
            answer: "6 years",
          },
          {
            question:
              "What's the most recent thing you've built or shipped? Walk us through what it was and why you did it.",
            answer: "A job-application service with a browser form filler.",
          },
          {
            question: "How did you hear about this role?",
            answer: "Job board",
          },
        ],
      }),
    );
    expect(res.status).toBe("submitted");
    expect(res.confirmation).toContain("successfully submitted");
    expect(reports.submitted).toEqual(
      expect.objectContaining({
        name: "Alex Example",
        resume: CV_NAME,
        location: "Tbilisi, Georgia",
        sponsorship: "No",
        gender: "gender-3",
        ethnicity: ["eth-3"],
        tsYears: "6 years",
      }),
    );
    expect(isJpeg(res.screenshotBase64)).toBe(true);
  });
});

describe("Lever fixture", () => {
  const applyUrl = () => server.url("/lever/acme/7a6b5c4d/apply");

  it("prepares: overwrites the parsed name, picks the location suggestion, declines EEO, pastes the cover letter", async () => {
    const { res } = await run(
      applyRequest({ ats: "lever", applyUrl: applyUrl(), coverLetter: COVER }),
    );
    expect(res.status).toBe("prepared");
    expect(value(res, "Resume/CV")).toBe(CV_NAME);
    expect(value(res, "Full name")).toBe("Alex Example");
    expect(value(res, "Email")).toBe("alex@example.com");
    expect(value(res, "Phone")).toBe("+44 7700 900123");
    expect(value(res, "Current location")).toBe("Tbilisi, Georgia");
    expect(value(res, "Current company")).toBe("Example Corp");
    expect(value(res, "GitHub URL")).toBe("https://github.com/alex-example");
    expect(value(res, "Portfolio URL")).toBe("https://alex.example.com");
    expect(value(res, "Gender")).toBe("Decline to self-identify");
    expect(value(res, "Race")).toBe("Decline to self-identify");
    expect(value(res, "Veteran status")).toBe("Decline to self-identify");
    expect(value(res, "Additional information")).toBe(COVER);
    expect(
      res.filled.some((entry) => /future job opportunities/.test(entry.label)),
    ).toBe(false);

    expect(
      missing(
        res,
        "Are you legally authorized to work in the country for which you are applying?",
      ),
    ).toEqual(
      expect.objectContaining({
        type: "radio",
        required: true,
        options: ["Yes", "No"],
      }),
    );
    expect(missing(res, "Language Skill(s) (Check all that apply)")).toEqual(
      expect.objectContaining({ type: "checkbox", required: true }),
    );
    expect(
      missing(
        res,
        "How many years of relevant, post college work experience do you have?",
      )?.options,
    ).toContain("10+");
    expect(missing(res, "Why do you want to work at Acme?")?.required).toBe(
      true,
    );
  });

  it("submits a real multipart form and lands on the thanks page", async () => {
    const before = server.posts.length;
    const { res } = await run(
      applyRequest({
        ats: "lever",
        applyUrl: applyUrl(),
        mode: "submit",
        answers: [
          {
            question:
              "Are you legally authorized to work in the country for which you are applying?",
            answer: "Yes",
          },
          { question: "Language skills", answer: "English, Russian" },
          {
            question: "How many years of relevant work experience do you have?",
            answer: "12",
          },
          {
            question: "Why do you want to work at Acme?",
            answer: "Because of the product.",
          },
          {
            question: "Do you hold an active security clearance?",
            answer: "No",
          },
        ],
      }),
    );
    expect(res.status).toBe("submitted");
    expect(res.confirmation).toContain("Application submitted");
    expect(server.posts.length).toBe(before + 1);
    const body = server.posts.at(-1)?.body ?? "";
    expect(body).toContain(`filename="${CV_NAME}"`);
    expect(body).toMatch(/name="name"\r\n\r\nAlex Example\r\n/);
    expect(body).toMatch(/name="cards\[c1\]\[field2\]"\r\n\r\n10\+\r\n/);
    expect(body).toMatch(
      /name="cards\[c1\]\[field1\]"\r\n\r\nEnglish \(ENG\)\r\n/,
    );
    expect(body).toMatch(
      /name="cards\[c1\]\[field1\]"\r\n\r\nRussian \(RUS\)\r\n/,
    );
    expect(body).toMatch(
      /name="eeo\[gender\]"\r\n\r\nDecline to self-identify\r\n/,
    );
    expect(body).not.toMatch(/name="consent\[marketing\]"\r\n\r\n1\r\n/);
  });

  it("does not submit while a required question is unanswered", async () => {
    const before = server.posts.length;
    const { res } = await run(
      applyRequest({ ats: "lever", applyUrl: applyUrl(), mode: "submit" }),
    );
    expect(res.status).toBe("needs_human");
    expect(res.reason).toBe("required_unanswered");
    expect(
      res.unanswered.filter((field) => field.required).length,
    ).toBeGreaterThan(0);
    expect(server.posts.length).toBe(before);
  });
});

describe("Greenhouse fixture", () => {
  it("follows an embedded ?gh_jid page to the hosted form and prepares it", async () => {
    const { res } = await run(
      applyRequest({
        ats: "greenhouse",
        applyUrl: server.url("/company/careers?gh_jid=4001"),
      }),
    );
    expect(res.status).toBe("prepared");
    expect(value(res, "First Name")).toBe("Alex");
    expect(value(res, "Last Name")).toBe("Example");
    expect(value(res, "Email")).toBe("alex@example.com");
    expect(value(res, "Country")).toBe("Georgia +995");
    expect(value(res, "Phone")).toBe("+44 7700 900123");
    expect(value(res, "Location (City)")).toBe("Tbilisi, Tbilisi, Georgia");
    expect(value(res, "Resume/CV")).toBe(CV_NAME);
    expect(value(res, "LinkedIn Profile")).toBe(
      "https://www.linkedin.com/in/alex-example",
    );
    expect(
      value(
        res,
        "I consent to the processing of my personal data as described in the Acme Candidate Privacy Policy.",
      ),
    ).toBe("checked");
    expect(value(res, "Gender")).toBe("Decline To Self Identify");
    expect(value(res, "Veteran Status")).toBe("I don't wish to answer");
    expect(value(res, "Disability Status")).toBe("I do not want to answer");
    expect(
      res.filled.some((entry) => /talent community/.test(entry.label)),
    ).toBe(false);

    expect(missing(res, "Why do you want to work at Acme?")).toEqual(
      expect.objectContaining({ type: "textarea", required: true }),
    );
    expect(
      missing(
        res,
        "Are you legally authorized to work in Germany for our Company?",
      ),
    ).toEqual(
      expect.objectContaining({
        type: "combobox",
        required: true,
        options: ["Yes", "No"],
      }),
    );
    expect(missing(res, "Cover Letter")).toEqual(
      expect.objectContaining({ type: "file", required: false }),
    );
  });

  it("submits with answers and a cover letter uploaded as .txt", async () => {
    const { res, reports } = await run(
      applyRequest({
        ats: "greenhouse",
        applyUrl: server.url("/greenhouse/acme/jobs/4001"),
        mode: "submit",
        coverLetter: COVER,
        answers: [
          {
            question: "Why do you want to work at Acme?",
            answer: "Because of the product.",
          },
          {
            question:
              "Are you legally authorized to work in Germany for our company?",
            answer: "Yes",
          },
          {
            question: "Will you now or in the future require visa sponsorship?",
            answer: "No",
          },
        ],
      }),
    );
    expect(res.status).toBe("submitted");
    expect(res.confirmation).toMatch(/Thank you for applying/);
    expect(reports.submitted).toEqual(
      expect.objectContaining({
        uploads: { resume: CV_NAME, cover_letter: "Cover_Letter.txt" },
        gdpr: true,
        talentPool: false,
        selects: expect.objectContaining({
          country: "Georgia +995",
          "candidate-location": "Tbilisi, Tbilisi, Georgia",
          question_4: "Yes",
          question_5: "No",
          "4001": "Decline To Self Identify",
        }),
      }),
    );
  });
});

describe("Workable fixture", () => {
  const applyUrl = () => server.url("/workable/acme/j/ABC123/apply/");

  it("declines cookies, fills ARIA widgets and lists the open questions", async () => {
    const { res, reports } = await run(
      applyRequest({ ats: "workable", applyUrl: applyUrl() }),
    );
    expect(reports.cookie).toBe("declined");
    expect(res.status).toBe("prepared");
    expect(value(res, "First name")).toBe("Alex");
    expect(value(res, "Last name")).toBe("Example");
    expect(value(res, "Email")).toBe("alex@example.com");
    expect(value(res, "Phone")).toBe("+44 7700 900123");
    expect(value(res, "Resume")).toBe(CV_NAME);
    expect(
      value(
        res,
        "I have read, understand and accept the content of the Privacy Notice and consent to the processing of my data as part of this application.",
      ),
    ).toBe("checked");
    expect(
      missing(
        res,
        "Can you confirm that everything in this application is true and your own?",
      ),
    ).toEqual(
      expect.objectContaining({
        type: "radio",
        required: true,
        options: ["YES", "NO"],
      }),
    );
    expect(missing(res, "Notice period / availability")).toEqual(
      expect.objectContaining({
        type: "combobox",
        required: false,
        options: ["Available immediately", "2 weeks", "1 month", "2 months"],
      }),
    );
    expect(missing(res, "Cover letter")).toEqual(
      expect.objectContaining({ required: false }),
    );
    expect(missing(res, "Expected salary")).toEqual(
      expect.objectContaining({ required: false }),
    );
  });

  it("submits", async () => {
    const { res, reports } = await run(
      applyRequest({
        ats: "workable",
        applyUrl: applyUrl(),
        mode: "submit",
        coverLetter: COVER,
        answers: [
          {
            question:
              "Can you confirm that everything in this application is true and your own?",
            answer: "Yes",
          },
          {
            question:
              "Why Acme, and where would you make the biggest difference in this role?",
            answer: "In the backend.",
          },
          { question: "Notice period", answer: "2 weeks" },
        ],
      }),
    );
    expect(res.status).toBe("submitted");
    expect(res.confirmation).toContain("Thank you for applying");
    expect(reports.submitted).toEqual({
      resume: CV_NAME,
      cover: COVER,
      notice: "2 weeks",
      confirmed: "true",
      gdpr: true,
    });
  });
});

describe("stops for a human", () => {
  it("a visible CAPTCHA challenge: needs_human/captcha, nothing filled", async () => {
    const { res } = await run(
      applyRequest({ ats: "lever", applyUrl: server.url("/captcha") }),
    );
    expect(res.status).toBe("needs_human");
    expect(res.reason).toBe("captcha");
    expect(res.filled).toEqual([]);
    expect(isJpeg(res.screenshotBase64)).toBe(true);
  });

  it("a challenge that appears on submit: needs_human/captcha, never solved", async () => {
    const { res, reports } = await run(
      applyRequest({
        ats: "lever",
        applyUrl: server.url("/late-captcha"),
        mode: "submit",
      }),
    );
    expect(res.status).toBe("needs_human");
    expect(res.reason).toBe("captcha");
    expect(reports.submitCount).toBe(1);
  });

  it("a login wall: needs_human/login_required", async () => {
    const { res } = await run(
      applyRequest({ ats: "workable", applyUrl: server.url("/login") }),
    );
    expect(res.status).toBe("needs_human");
    expect(res.reason).toBe("login_required");
    expect(res.filled).toEqual([]);
  });

  it("validation messages after submit: needs_human/validation_error with the text", async () => {
    const { res, reports } = await run(
      applyRequest({
        ats: "lever",
        applyUrl: server.url("/validation"),
        mode: "submit",
      }),
    );
    expect(res.status).toBe("needs_human");
    expect(res.reason).toMatch(/^validation_error: .*valid phone number/);
    expect(reports.submitCount).toBe(1);
  });

  it("a submit without a thank-you or an error: no_confirmation with the request seen, the page after submit shot", async () => {
    const { res, reports } = await run(
      applyRequest({
        ats: "lever",
        applyUrl: server.url("/silent"),
        mode: "submit",
      }),
      true,
      2000,
    );
    expect(res.status).toBe("needs_human");
    expect(res.reason).toBe(
      "no_confirmation: still on the form; POST /silent/applications 200",
    );
    expect(reports.submitCount).toBe(1);
    expect(isJpeg(res.screenshotBase64)).toBe(true);
  });
});

describe("refuses", () => {
  it("a URL of another site for the ATS", async () => {
    const { res } = await run(
      applyRequest({
        ats: "lever",
        applyUrl: "https://careers.example.com/jobs/1",
      }),
      false,
    );
    expect(res).toEqual(
      expect.objectContaining({ status: "failed", reason: "unsupported_url" }),
    );
  });

  it("a posting that is gone", async () => {
    const { res } = await run(
      applyRequest({ ats: "ashby", applyUrl: server.url("/ashby/acme/gone") }),
    );
    expect(res).toEqual(
      expect.objectContaining({ status: "failed", reason: "posting_closed" }),
    );
  });
});
