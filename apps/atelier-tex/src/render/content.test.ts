import { cvDocumentSchema } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { alexExample, qaTwoPager } from "../test/fixtures.js";
import { buildContent, measuredBlocks } from "./content.js";

describe("buildContent", () => {
  it("fixtures are valid CvDocuments", () => {
    expect(() => cvDocumentSchema.parse(alexExample)).not.toThrow();
    expect(() => cvDocumentSchema.parse(qaTwoPager)).not.toThrow();
  });

  it("generates content.tex for the Minimal violet macros", () => {
    expect(buildContent(alexExample).tex).toMatchSnapshot();
  });

  it("leaves the second summary argument empty for one paragraph", () => {
    const { tex } = buildContent({
      ...alexExample,
      summary: ["Only one **paragraph**."],
    });
    expect(tex).toContain("\\cvsummary{%\nOnly one \\hl{paragraph}.%\n}{%\n}");
  });

  it("prints no list for a job without bullets", () => {
    const { tex } = buildContent(alexExample);
    const contoso = tex.slice(tex.indexOf("{Contoso}"));
    expect(contoso.slice(0, contoso.indexOf("\\cvsection"))).not.toContain(
      "cvbullets",
    );
    expect(tex.match(/\\begin\{cvbullets\}/g)).toHaveLength(1);
  });

  it("keeps a bullet that starts with [ from becoming an \\item label", () => {
    expect(buildContent(alexExample).tex).toContain("\\item {}[Lead] Owned");
  });

  it("leaves out links, education and languages when there are none", () => {
    const { tex } = buildContent({
      ...alexExample,
      links: [],
      education: [],
      languages: [{ name: " ", level: "C1" }],
    });
    expect(tex).not.toContain("\\cvlinks");
    expect(tex).not.toContain("\\cvsection{Education}");
    expect(tex).not.toContain("\\cvsection{Languages}");
  });

  it("falls back to name and headline for an empty PDF title", () => {
    const { tex } = buildContent({
      ...alexExample,
      pdf: { title: "", subject: "", keywords: [] },
    });
    expect(tex).toContain(
      "pdftitle={Alex Example - Senior Full-Stack Engineer - CV}",
    );
  });

  it("lists the measured blocks with their visible text", () => {
    expect(measuredBlocks(alexExample)).toEqual([
      {
        id: "summary:0",
        text: "Engineer with 8+ years building B2B & SaaS products: 100% typed APIs, $0 incidents budget and #1 on-call rota.",
      },
      {
        id: "summary:1",
        text: "Ships with C# and C++ when needed; writes {curly} config, a_b snake_case, ~tilde~ and ^caret^ without fear of \\backslash.",
      },
      { id: "skill:0", text: "Languages: TypeScript, JavaScript, SQL, C#" },
      { id: "skill:1", text: "Frontend: React, Next.js, Tailwind CSS" },
      { id: "skill:2", text: "Backend: Node.js, NestJS, REST & GraphQL" },
      { id: "skill:3", text: "Data: PostgreSQL, Redis, RabbitMQ" },
      {
        id: "bullet:nw1",
        text: "Cut checkout latency by 40% with a cache in front of the pricing service.",
      },
      {
        id: "bullet:nw2",
        text: "[Lead] Owned the migration of 120 cron jobs to a queue with retries and idempotency keys.",
      },
      {
        id: "bullet:nw3",
        text: "Built the café ordering demo for Zürich and São Paulo pilots.",
      },
    ]);
  });
});
