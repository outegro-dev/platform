import { describe, expect, it } from "vitest";
import { analysisOf, cases, fieldsOf, req } from "./fixtures/profile.js";
import { groundRequirements, quoteInText } from "./grounding.js";
import { analyzePrompt } from "./prompts/analyze.js";
import { matchPrompt } from "./prompts/match.js";
import { rolePolicy } from "./role-policy.js";

const text =
  "Required: React interfaces. Next.js is preferred. Use Codex and Claude to code.";

describe("role policy", () => {
  it("classifies frontend, backend, fullstack and AI roles and normalises all twelve weights", () => {
    for (const [title, categories, expected] of [
      ["Frontend Engineer", ["FE"], "frontend"],
      ["Backend Engineer", ["BE"], "backend"],
      ["Full Stack Engineer", ["FE", "BE"], "fullstack"],
      ["Software Engineer", ["AI"], "ai"],
    ] as const) {
      const policy = rolePolicy(
        [
          req(
            "R1",
            expected === "ai" ? "Build document-grounded RAG" : "Product work",
            [...categories],
          ),
        ],
        title,
      );
      expect(policy.role).toBe(expected);
      const weights = Object.values(policy.weights);
      expect(weights).toHaveLength(12);
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(weights.every((weight) => weight >= 0 && weight <= 1)).toBe(true);
    }
  });

  it("does not take AI tooling or optional AI experience for an AI product role", () => {
    expect(
      rolePolicy(
        [req("R1", "Use Codex and Claude", ["QA"])],
        "Frontend Engineer",
      ).template,
    ).toBe("general");
    expect(
      rolePolicy(
        [req("R1", "RAG experience", ["AI"], "preferred")],
        "Backend Engineer",
      ).template,
    ).toBe("general");
    expect(
      rolePolicy(
        [req("R1", "Integrate LLM inference APIs", ["AI", "BE"])],
        "Backend Engineer",
      ).template,
    ).toBe("ai");
  });

  it("weighs a required category above a preferred one; demand decides an untitled role", () => {
    const policy = rolePolicy(
      [
        req("R1", "Frontend", ["FE"]),
        req("R2", "Backend", ["BE"], "preferred"),
      ],
      "Fullstack Engineer",
    );
    expect(policy.weights.FE).toBeGreaterThan(policy.weights.BE);
    expect(
      rolePolicy(
        [
          req("R1", "UI", ["FE"]),
          req("R2", "UI 2", ["FE"]),
          req("R3", "API", ["BE"]),
        ],
        "Engineer",
      ).role,
    ).toBe("frontend");
  });
});

describe("requirement grounding", () => {
  it("drops a repeated requirement, an absent quote and repeated categories", () => {
    const grounded = groundRequirements(
      analysisOf([
        req("R1", "React interfaces.", ["FE", "FE"]),
        req("R2", "React interfaces.", ["FE"]),
        req("R3", "Kubernetes", ["BE"]),
      ]),
      text,
    );
    expect(
      grounded.analysis.requirements.map((item) => [item.id, item.categoryIds]),
    ).toEqual([["R1", ["FE"]]]);
    expect(grounded.dropped).toEqual([
      { id: "R2", reason: "duplicate requirement" },
      { id: "R3", reason: "quote not found in the vacancy" },
    ]);
  });

  it("fails only without any grounded requirement", () => {
    expect(() =>
      groundRequirements(analysisOf([req("R1", "Kubernetes", ["BE"])]), text),
    ).toThrow("no grounded requirements (R1: quote not found in the vacancy)");
  });

  it("finds quotes across typography, whitespace, case and elision, but not paraphrase", () => {
    const vacancy =
      "Requirements:\n• 5+ years building “scalable” web apps — React/Next.js\n• Strong   TypeScript skills; experience with AWS.";
    expect(
      quoteInText(
        '5+ years building "scalable" web apps - React/Next.js',
        vacancy,
      ),
    ).toBe(true);
    expect(quoteInText("strong typescript skills", vacancy)).toBe(true);
    expect(
      quoteInText("Strong TypeScript skills; experience with AWS", vacancy),
    ).toBe(true);
    expect(quoteInText("5+ years building … web apps", vacancy)).toBe(true);
    expect(quoteInText("web apps … 5+ years", vacancy)).toBe(false);
    expect(quoteInText("5+ years of TypeScript experience", vacancy)).toBe(
      false,
    );
    expect(quoteInText("…", vacancy)).toBe(false);
  });
});

describe("analyze prompt", () => {
  const fields = fieldsOf(
    `Acme Robotics hires a Senior Frontend Engineer. ${text}`,
  );

  it("separates the vacancy data and asks for cvRole, aiCore and a product question without matches", () => {
    const prompt = analyzePrompt(fields);
    expect(prompt.purpose).toBe("vacancy.analyze");
    expect(prompt.system).toContain("untrusted vacancy text");
    expect(prompt.system).toContain("productQuestion");
    expect(prompt.system).not.toContain("BANK_DATA");
    expect(prompt.input).toContain("VACANCY_DATA=");
    expect(prompt.input).toContain("React interfaces");
  });

  it("cleans the answer: ids, repeated categories, empty tags and fallback company/title", () => {
    const parsed = analyzePrompt(fields).parse({
      company: null,
      title: " ",
      cvRole: { senior: true, focus: "Frontend", noun: "Engineer" },
      aiCore: false,
      productQuestion: "  How many orders a day does the platform handle?  ",
      requirements: [
        {
          id: "R2",
          text: "React interfaces",
          importance: "must",
          categoryIds: ["FE", "FE", "UX", "QA", "PF"],
          technologyTags: ["React", " ", "React"],
          evidenceQuote: "React interfaces",
        },
        {
          id: "bad",
          text: "Next.js",
          importance: "preferred",
          categoryIds: ["FE"],
          technologyTags: ["Next.js"],
          evidenceQuote: "Next.js is preferred",
        },
        {
          id: "R3",
          text: "No category",
          importance: "must",
          categoryIds: [],
          technologyTags: [],
          evidenceQuote: "x",
        },
      ],
    });
    expect(parsed.company).toBe("Acme Robotics");
    expect(parsed.title).toBe("Senior Frontend Engineer");
    expect(parsed.productQuestion).toBe(
      "How many orders a day does the platform handle?",
    );
    expect(parsed.requirements.map((item) => item.id)).toEqual(["R2", "R3"]);
    expect(parsed.requirements[0]?.categoryIds).toEqual(["FE", "UX", "QA"]);
    expect(parsed.requirements[0]?.technologyTags).toEqual(["React"]);
    expect(() =>
      analyzePrompt(fields).parse({ ...parsed, requirements: [] }),
    ).toThrow();
  });
});

describe("match prompt", () => {
  const requirements = [
    req("R1", "React interfaces.", ["FE"], "must", ["React"]),
  ];

  it("sends the compact index of active cases only", () => {
    const prompt = matchPrompt(requirements, cases);
    expect(prompt.input).toContain('"id":"N1"');
    expect(prompt.input).not.toContain('"id":"N9"');
    expect(prompt.input).not.toContain("variants");
    expect(prompt.system).toContain("Stack overlap alone does not prove");
    expect(prompt.system).toContain("Do not rank cases");
  });

  it("drops unknown cases, foreign evidence, repeated pairs and positive matches without evidence", () => {
    const known = "N5:delivery";
    const { matches } = matchPrompt(requirements, cases).parse({
      matches: [
        { requirementId: "R1", caseId: "N99", match: 1, evidenceRefs: [known] },
        {
          requirementId: "R1",
          caseId: "N5",
          match: 1,
          evidenceRefs: [known, "N1:core"],
        },
        {
          requirementId: "R1",
          caseId: "N5",
          match: 0.5,
          evidenceRefs: [known],
        },
        { requirementId: "R9", caseId: "N5", match: 1, evidenceRefs: [known] },
        {
          requirementId: "R1",
          caseId: "N1",
          match: 1,
          evidenceRefs: ["N5:core"],
        },
        {
          requirementId: "R1",
          caseId: "N9",
          match: 1,
          evidenceRefs: ["N9:core"],
        },
        { requirementId: "R1", caseId: "L4", match: 0, evidenceRefs: [] },
      ],
    });
    expect(matches).toEqual([
      { requirementId: "R1", caseId: "N5", match: 1, evidenceRefs: [known] },
      { requirementId: "R1", caseId: "L4", match: 0, evidenceRefs: [] },
    ]);
    expect(() =>
      matchPrompt(requirements, cases).parse({
        matches: [
          { requirementId: "R1", caseId: "N5", match: 0.7, evidenceRefs: [] },
        ],
      }),
    ).toThrow();
  });
});
