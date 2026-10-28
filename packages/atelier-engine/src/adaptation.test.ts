import { describe, expect, it } from "vitest";
import {
  cvTitle,
  leadWord,
  spreadLeadWords,
  tenureYears,
  withTenure,
} from "./adaptation.js";
import { defined, profile, req } from "./fixtures/profile.js";
import { buildSkills, skillLine, skillLineBudget } from "./skills.js";
import { skillKey, spellings } from "./technologies.js";

describe("vacancy adaptation", () => {
  it("states the base tenure unless a core requirement asks for more", () => {
    expect(tenureYears([req("R1", "React and TypeScript", ["FE"])], 6)).toBe(6);
    expect(
      tenureYears(
        [req("R1", "7+ years of experience as a developer", ["FE"])],
        6,
      ),
    ).toBe(7);
    expect(
      tenureYears(
        [
          req(
            "R1",
            "Strong frontend experience",
            ["FE"],
            "must",
            [],
            "💻 8+ years of experience",
          ),
        ],
        6,
      ),
    ).toBe(8);
    expect(
      tenureYears(
        [req("R1", "Опыт коммерческой разработки от 9 лет", ["FE"])],
        6,
      ),
    ).toBe(9);
    // A range counts by its lower bound; a preferred qualification and an implausible figure do not count.
    expect(
      tenureYears(
        [
          req("R1", "5-7 years of experience", ["FE"]),
          req("R2", "10+ years of experience", ["FE"], "preferred"),
          req("R3", "20 years of history", ["FE"]),
        ],
        6,
      ),
    ).toBe(6);
    expect(
      tenureYears(
        [
          req("R1", "3+ years with React", ["FE"]),
          req("R2", "7 years in software", ["FE"]),
        ],
        4,
      ),
    ).toBe(7);
  });

  it("rewrites every stated tenure and leaves names with digits alone", () => {
    expect(
      withTenure(
        "**Senior Engineer with 6+ years of commercial experience** building SaaS.",
        7,
      ),
    ).toBe(
      "**Senior Engineer with 7+ years of commercial experience** building SaaS.",
    );
    expect(
      withTenure(
        "Senior engineer with 6+ years building products; K8s and S3.",
        6,
      ),
    ).toBe("Senior engineer with 6+ years building products; K8s and S3.");
  });

  it("adds up to three technologies to the role while the title fits 64 characters", () => {
    expect(
      cvTitle("Senior Frontend Engineer", [
        "TypeScript",
        "React",
        "Next.js",
        "Redux",
      ]),
    ).toBe("Senior Frontend Engineer | TypeScript / React / Next.js");
    expect(
      cvTitle("Senior Full-Stack Software Engineer", [
        "TypeScript",
        "React",
        "Node.js",
      ]),
    ).toBe("Senior Full-Stack Software Engineer | TypeScript / React");
    expect(
      cvTitle("Senior Full-Stack Software Developer, AI Customer Support", [
        "TypeScript",
      ]),
    ).toBe("Senior Full-Stack Software Developer, AI Customer Support");
    expect(cvTitle("Backend Engineer", [])).toBe("Backend Engineer");
  });

  it("never lets neighbouring bullets open with the same word while another is left", () => {
    const spread = (texts: string[]) => spreadLeadWords(texts, leadWord);
    expect(
      spread(["Built A.", "**Built** B.", "Reworked C.", "Led D."]),
    ).toEqual(["Built A.", "Reworked C.", "**Built** B.", "Led D."]);
    expect(
      spread(["Reworked A.", "Reworked B.", "Built C.", "Built D."]),
    ).toEqual(["Reworked A.", "Built C.", "Reworked B.", "Built D."]);
    expect(spread(["Built A.", "Built B."])).toEqual(["Built A.", "Built B."]);
    expect(spread(["Led A.", "Built B.", "Shipped C."])).toEqual([
      "Led A.",
      "Built B.",
      "Shipped C.",
    ]);
  });
});

describe("technologies and skills", () => {
  it("gives every spelling of one technology one key", () => {
    expect(skillKey("K8s")).toBe(skillKey("Kubernetes"));
    expect(skillKey("Node.js")).toBe(skillKey("NodeJS"));
    expect(skillKey("PostgreSQL")).toBe(skillKey("Postgres"));
    expect(skillKey("React")).not.toBe(skillKey("React Native"));
    expect(spellings("K8s")).toEqual(["K8s", "Kubernetes"]);
    expect(spellings("Unknown Tool")).toEqual(["Unknown Tool"]);
  });

  it("keeps a skills line within the one-line budget by priority, then measured drops", () => {
    const values = [
      "JavaScript",
      "TypeScript",
      "React",
      "Next.js",
      "Angular",
      "Vue",
      "HTML5/CSS3",
      "Tailwind CSS",
      "Redux Toolkit",
      "TanStack Query",
      "Apollo Client",
      "React Native",
      "Expo",
      "Svelte",
    ];
    const kept = skillLine("Frontend", values);
    expect(`Frontend: ${kept.join(", ")}`.length).toBeLessThanOrEqual(
      skillLineBudget,
    );
    expect(kept).toEqual(values.slice(0, kept.length));
    expect(skillLine("Frontend", values, 2)).toEqual(
      values.slice(0, kept.length - 2),
    );
    expect(
      skillLine("Frontend", [
        "One very long technology name that alone exceeds the budget ".repeat(
          3,
        ),
      ]),
    ).toHaveLength(1);
  });

  const requirements = [
    req("R1", "Kubernetes in production", ["BE"], "must", ["K8s", "Go"]),
    req("R2", "Frontend with Vue", ["FE"], "responsibility", ["Vue", "React"]),
    req("R3", "Terraform is a plus", ["RE"], "preferred", [
      "Terraform",
      "Soft skills",
    ]),
  ];

  it("strict: reorders and respells what the profile has, adds nothing else", () => {
    const { rows, technologies, skipped } = buildSkills(
      profile,
      requirements,
      "strict",
    );
    const row = (label: string) =>
      defined(rows.find((item) => item.label === label)).items.map(
        (item) => item.value,
      );
    // The vacancy's spelling replaces the base one and goes first; base items all stay.
    expect(row("Cloud & DevOps")).toEqual([
      "K8s",
      "Docker",
      "AWS",
      "GitHub Actions",
    ]);
    expect(row("Frontend")[0]).toBe("React");
    expect(row("Frontend")).not.toContain("Vue");
    expect(technologies).toEqual(["K8s", "React"]);
    expect(skipped).toEqual(["Go", "Vue", "Terraform", "Soft skills"]);
    expect(rows.map((item) => item.label)).toEqual(
      profile.skills.map((item) => item.label),
    );
  });

  it("free: adds known vacancy technologies to the row of their kind, never unknown words", () => {
    const { rows, technologies, skipped } = buildSkills(
      profile,
      requirements,
      "free",
    );
    const row = (label: string) =>
      defined(rows.find((item) => item.label === label)).items.map(
        (item) => item.value,
      );
    expect(row("Languages")[0]).toBe("Go");
    // Equal importance keeps the base order: the respelled base item first.
    expect(row("Frontend").slice(0, 2)).toEqual(["React", "Vue"]);
    expect(row("Cloud & DevOps")).toEqual([
      "K8s",
      "Terraform",
      "Docker",
      "AWS",
      "GitHub Actions",
    ]);
    expect(technologies).toEqual(["K8s", "Go", "Vue", "React", "Terraform"]);
    expect(skipped).toEqual(["Soft skills"]);
    const backend = defined(rows.find((item) => item.label === "Backend"));
    expect(
      backend.items.every(
        (item) => item.priority === 50 || item.priority === 70,
      ),
    ).toBe(true);
  });
});
