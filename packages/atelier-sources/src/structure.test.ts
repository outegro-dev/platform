import { vacancyStructureSchema } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { findTechnologies, normalizeTech, techLexicon } from "./lexicon.js";
import {
  languagesOf,
  remoteOf,
  roleFocusOf,
  seniorityOf,
  structureVacancy,
  yearsMinOf,
} from "./structure.js";

describe("technology lexicon", () => {
  it("has about 300+ technologies with unique canonical names", () => {
    expect(techLexicon.length).toBeGreaterThanOrEqual(300);
    const names = techLexicon.map((entry) => entry.canonical);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of techLexicon)
      expect(entry.canonical.length).toBeLessThanOrEqual(80);
  });

  it("normalizes spellings", () => {
    const cases: [string, string][] = [
      ["K8s", "Kubernetes"],
      ["React.js", "React"],
      ["reactjs", "React"],
      ["Postgres", "PostgreSQL"],
      ["Nest.js", "NestJS"],
      ["NestJS", "NestJS"],
      ["Node", "Node.js"],
      ["nodejs", "Node.js"],
      ["Golang", "Go"],
      ["TS", "TypeScript"],
      ["Next JS", "Next.js"],
      ["C#", ".NET"],
      ["tailwindcss", "Tailwind CSS"],
      ["GitLab CI", "GitLab CI/CD"],
    ];
    for (const [term, canonical] of cases)
      expect(normalizeTech(term)).toBe(canonical);
    expect(normalizeTech("Excel wizardry")).toBeNull();
  });

  it("finds mentions, longest spelling first, case-sensitive short names", () => {
    const hits = findTechnologies(
      "React Native and ReactJS apps, Node on AWS, PostgreSQL/Redis, Go services. Go to market fast. JS/TS. NoSQL, ASP.NET, rest of the team.",
    ).map((hit) => hit.canonical);
    expect(hits).toEqual([
      "React Native",
      "React",
      "Node.js",
      "AWS",
      "PostgreSQL",
      "Redis",
      "Go",
      "JavaScript",
      "TypeScript",
      "NoSQL",
      "ASP.NET Core",
    ]);
  });
});

describe("level 2 fields", () => {
  it("seniority from the title, EN and RU, then from the text", () => {
    expect(seniorityOf("Senior Frontend Engineer", "")).toBe("senior");
    expect(seniorityOf("Staff Software Engineer", "")).toBe("lead");
    expect(seniorityOf("Middle+/Senior Node.js разработчик", "")).toBe(
      "senior",
    );
    expect(seniorityOf("Software Engineer II", "")).toBe("middle");
    expect(seniorityOf("Младший аналитик", "")).toBe("junior");
    expect(seniorityOf("Ведущий разработчик", "")).toBe("lead");
    expect(seniorityOf("Тимлид backend", "")).toBe("lead");
    expect(seniorityOf("Специалист по лидогенерации", "")).toBe("unknown");
    expect(
      seniorityOf("Backend Developer", "Уровень: #middle\nЛокация: #remote"),
    ).toBe("middle");
    expect(seniorityOf("Frontend Engineer", "Build things.")).toBe("unknown");
  });

  it("yearsMin: lower bounds, the overall requirement, not the company's age", () => {
    expect(yearsMinOf("3-5 years of experience with React")).toBe(3);
    expect(
      yearsMinOf("5+ years of professional experience; 2+ years with Go"),
    ).toBe(5);
    expect(yearsMinOf("Опыт коммерческой разработки от 3 лет")).toBe(3);
    expect(yearsMinOf("Опыт работы с Node.js не менее 2-х лет")).toBe(2);
    expect(yearsMinOf("Коммерческий опыт 4 года")).toBe(4);
    expect(yearsMinOf("At least three years of hands-on experience")).toBe(3);
    expect(
      yearsMinOf("For over 11 years, we've been developing payment products."),
    ).toBeNull();
    expect(yearsMinOf("Founded 10 years ago, we build software.")).toBeNull();
    expect(yearsMinOf("Join a 100 years old engineering company")).toBeNull();
    expect(yearsMinOf("No experience needed")).toBeNull();
  });

  it("remote", () => {
    expect(remoteOf("Frontend Engineer (Remote)", "")).toBe(true);
    expect(remoteOf("Backend", "Работа удалённо из любой точки")).toBe(true);
    expect(
      remoteOf("Backend", "This role is hybrid: 3 days a week in the office."),
    ).toBe(false);
    expect(remoteOf("Backend", "This is not a remote position.")).toBe(false);
    expect(remoteOf("Backend", "Офис в Тбилиси")).toBe(false);
    expect(remoteOf("Backend", "Great team.")).toBeNull();
  });

  it("spoken languages asked for", () => {
    expect(
      languagesOf(
        "Fluent English and German (C1) are required.\nNice: Polish the UI.",
      ),
    ).toEqual(["English", "German"]);
    expect(languagesOf("Английский язык на уровне B2")).toEqual(["English"]);
    expect(languagesOf("Russian-speaking team")).toEqual(["Russian"]);
    expect(languagesOf("We sell to English and Spanish companies.")).toEqual(
      [],
    );
  });

  it("role focus: title first, then what the text stresses", () => {
    expect(roleFocusOf("Senior Fullstack Engineer", "")).toBe("fullstack");
    expect(roleFocusOf("Frontend Engineer (AI)", "")).toBe("frontend");
    expect(roleFocusOf("AI Engineer", "")).toBe("ai");
    expect(roleFocusOf("Backend Engineer, LLM Platform", "")).toBe("backend");
    expect(roleFocusOf("iOS Developer", "")).toBe("mobile");
    expect(roleFocusOf("Golang Developer", "")).toBe("backend");
    expect(roleFocusOf("Customer Success Manager", "")).toBe("other");
    expect(
      roleFocusOf(
        "Software Engineer II",
        "React, Redux, CSS, the browser and a web app UI.",
      ),
    ).toBe("frontend");
    expect(
      roleFocusOf(
        "Software Engineer",
        "Kafka, PostgreSQL, Docker, Kubernetes and microservice APIs",
      ),
    ).toBe("backend");
    expect(
      roleFocusOf(
        "Software Engineer",
        "React and CSS on the frontend, Node.js and PostgreSQL APIs, Docker, React UI, CSS, server work",
      ),
    ).toBe("fullstack");
  });

  it("structureVacancy fits the contract", () => {
    const structure = structureVacancy(
      "We are looking for a Senior Node.js engineer.\nRequirements:\n- 5+ years of experience with NestJS, Postgres and K8s\n- Fluent English\nRemote-first team.",
      "Senior Backend Engineer (Node.js)",
    );
    expect(vacancyStructureSchema.parse(structure)).toEqual({
      technologies: ["Node.js", "NestJS", "PostgreSQL", "Kubernetes"],
      seniority: "senior",
      yearsMin: 5,
      remote: true,
      languages: ["English"],
      roleFocus: "backend",
    });
  });
});
