import { describe, expect, it } from "vitest";
import { atsCoverage } from "./ats.js";
import { cases, fieldsOf, profile, req } from "./fixtures/profile.js";
import { prefilterCases } from "./prefilter.js";
import { quickScore } from "./quick-score.js";

describe("quickScore", () => {
  const structure = {
    technologies: ["React", "TypeScript", "K8s", "Elixir"],
    seniority: "senior" as const,
    yearsMin: 5,
    remote: true,
    languages: ["English"],
    roleFocus: "fullstack" as const,
  };

  it("rewards technologies the profile has, the role focus, seniority and remote work", () => {
    const result = quickScore(
      profile,
      structure,
      fieldsOf("A fullstack role."),
    );
    expect(result.covered).toEqual(["React", "TypeScript", "K8s"]);
    expect(result.missing).toEqual(["Elixir"]);
    expect(result.score).toBe(85);
    expect(result.reasons[0]).toBe("3 of 4 technologies are in the profile");
  });

  it("drops for more years than the profile has, an office job and a missing language", () => {
    const result = quickScore(
      profile,
      {
        ...structure,
        yearsMin: 10,
        remote: false,
        languages: ["German"],
        roleFocus: "mobile",
      },
      fieldsOf("An office role.", { remote: false }),
    );
    // 45 for technologies + 14 for a mobile role (the bank has a React Native case) - 15 for German.
    expect(result.score).toBe(44);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "Asks for 10+ years, the profile has 5",
        "Not remote",
        "Requires German",
      ]),
    );
  });
});

describe("prefilterCases", () => {
  it("keeps active eligible cases that share a technology or rate 4+ in a core category", () => {
    const kept = prefilterCases(cases, [
      req("R1", "Payments", ["SE"], "must", ["Stripe"]),
      req("R2", "LLM", ["AI"], "preferred"),
    ]);
    // Stripe is N3's; SE 5 is L5's; the preferred AI requirement brings nothing.
    expect(kept.map((item) => item.id)).toEqual(["N3", "L5"]);
  });

  it("sends every eligible case when nothing passes", () => {
    const kept = prefilterCases(cases, [
      req("R1", "Communication", ["CO"], "preferred"),
    ]);
    expect(kept.map((item) => item.id)).not.toContain("N9");
    expect(kept.map((item) => item.id)).not.toContain("N8");
    expect(kept).toHaveLength(cases.length - 2);
  });
});

describe("atsCoverage", () => {
  const requirements = [
    req("R1", "Kubernetes", ["RE"], "must", ["Kubernetes", "React"]),
    req("R2", "Go services", ["BE"], "must", ["Golang"]),
    req("R3", "Terraform", ["RE"], "preferred", ["Terraform"]),
  ];

  it("counts any spelling of a must technology as a whole word", () => {
    expect(atsCoverage("Skills: K8s, ReactJS and Go.", requirements)).toEqual({
      coverage: 1,
      missingTerms: [],
    });
    expect(atsCoverage("Skills: Reactive streams, K8s.", requirements)).toEqual(
      { coverage: 1 / 3, missingTerms: ["React", "Golang"] },
    );
    expect(atsCoverage("anything", [req("R1", "Teamwork", ["CO"])])).toEqual({
      coverage: 1,
      missingTerms: [],
    });
  });
});
