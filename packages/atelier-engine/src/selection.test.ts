import { type CategoryId, categoryIds } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { caseById, cases, req, withCases } from "./fixtures/profile.js";
import { rolePolicy } from "./role-policy.js";
import { measureSet, type ScoredCase, scoreCases } from "./scoring.js";
import { selectCases } from "./selection.js";
import type { Match } from "./types.js";

const requirements = [req("R1", "Product work", ["FE", "BE"])];
const policy = rolePolicy(requirements, "Fullstack Engineer");
const general = { ...policy, template: "general" as const };
const ai = { ...policy, template: "ai" as const };
const small = withCases(
  cases.filter((item) => /^N[1-7]$|^L[1-4]$|^C[1-4]$|^S[1-4]$/.test(item.id)),
);
const ids = (list: { caseId: string }[]) =>
  list.map((item) => item.caseId).sort();
const ratingsOf = (fill: (id: CategoryId) => number) =>
  Object.fromEntries(categoryIds.map((id) => [id, fill(id)])) as Record<
    CategoryId,
    number
  >;

describe("scoring", () => {
  it("uses weighted ratings and grounded evidence; missing evidence is zero", () => {
    const item = caseById("N1");
    const supported: Match[] = [
      {
        requirementId: "R1",
        caseId: item.id,
        match: 1,
        evidenceRefs: [`${item.id}:delivery`],
      },
    ];
    const baseline = scoreCases(cases, requirements, [], policy.weights).find(
      (c) => c.caseId === item.id,
    ) as ScoredCase;
    const improved = scoreCases(
      cases,
      requirements,
      supported,
      policy.weights,
    ).find((c) => c.caseId === item.id) as ScoredCase;
    expect(baseline.evidenceFit).toBe(0);
    expect(improved.evidenceFit).toBe(100);
    expect(improved.score - baseline.score).toBeCloseTo(40, 10);
    expect(improved.categoryFit).toBeCloseTo(
      100 *
        categoryIds.reduce(
          (sum, id) =>
            sum + (policy.weights[id] * item.categoryRatings[id]) / 5,
          0,
        ),
      10,
    );
    expect(
      scoreCases(cases, requirements, [], policy.weights).every(
        (c) => c.score >= 0 && c.score <= 100,
      ),
    ).toBe(true);
  });

  it("bounds category strength independently of bank order", () => {
    const zeros = cases.map((item) => ({
      ...item,
      categoryRatings: ratingsOf(() => 0),
    }));
    expect(
      scoreCases(zeros, requirements, [], policy.weights).every(
        (item) => item.score === 0,
      ),
    ).toBe(true);
  });

  it("charges 1.5 per extra bullet of one project", () => {
    const ranked = scoreCases(
      small.bank.cases,
      requirements,
      [],
      policy.weights,
    ).slice(0, 2);
    const distinct = ranked.map((item, i) => ({
      ...item,
      projectId: `project${i}`,
      primaryTheme: `theme${i}`,
    }));
    const overlapping = distinct.map((item) => ({
      ...item,
      projectId: "same-project",
    }));
    expect(
      measureSet(distinct, requirements, policy.weights).utility -
        measureSet(overlapping, requirements, policy.weights).utility,
    ).toBeCloseTo(1.5, 10);
  });

  it("rejects invalid weights and an empty requirement list", () => {
    const zero = Object.fromEntries(categoryIds.map((id) => [id, 0])) as Record<
      CategoryId,
      number
    >;
    const nan = Object.fromEntries(
      categoryIds.map((id) => [id, Number.NaN]),
    ) as Record<CategoryId, number>;
    expect(() => scoreCases(cases, requirements, [], zero)).toThrow("weights");
    expect(() => scoreCases(cases, requirements, [], nan)).toThrow("weights");
    expect(() => scoreCases(cases, [], [], policy.weights)).toThrow(
      "without requirements",
    );
  });
});

describe("selection", () => {
  it("reaches the maximum over every feasible small-bank alternative", () => {
    const result = selectCases(small, requirements, [], general);
    const ranked = scoreCases(
      small.bank.cases,
      requirements,
      [],
      policy.weights,
    ).filter((item) => item.companyId !== "signal");
    const alternatives = ranked
      .filter((item) => item.companyId === "northwind")
      .map(
        (omitted) =>
          measureSet(
            ranked.filter((item) => item.caseId !== omitted.caseId),
            requirements,
            policy.weights,
          ).utility,
      );
    expect(result.status).toBe("ok");
    expect(result.examinedSets).toBe(7);
    expect(result.utility).toBeCloseTo(Math.max(...alternatives), 10);
    expect(
      result.quotas.map((quota) => [quota.companyId, quota.count]),
    ).toEqual([
      ["northwind", 6],
      ["lumen", 4],
      ["cargo", 4],
    ]);
  });

  it("is reproducible under input order changes", () => {
    const first = selectCases(small, requirements, [], general);
    const second = selectCases(
      withCases([...small.bank.cases].reverse()),
      requirements,
      [],
      general,
    );
    expect(ids(first.selected)).toEqual(ids(second.selected));
    expect(first.utility).toBeCloseTo(second.utility, 10);
  });

  it("follows the AI quotas: the AI-only company, no company with target 0", () => {
    const result = selectCases(small, requirements, [], ai);
    const count = (companyId: string) =>
      result.selected.filter((item) => item.companyId === companyId).length;
    expect([
      count("signal"),
      count("northwind"),
      count("lumen"),
      count("cargo"),
    ]).toEqual([4, 6, 4, 0]);
    expect(result.selected[0]?.companyId).toBe("signal");
  });

  it("never prints two cases of one achievement group", () => {
    const shared = withCases(
      small.bank.cases.map((item) =>
        item.id === "N2" ? { ...item, achievementGroupId: "N1" } : item,
      ),
    );
    const result = selectCases(shared, requirements, [], general);
    expect(result.selected).toHaveLength(14);
    expect(result.selected.map((item) => item.caseId)).not.toEqual(
      expect.arrayContaining(["N1", "N2"]),
    );
  });

  it("uses reduced counts when the bank is short and needs_edit below a minimum", () => {
    const reduced = withCases(
      small.bank.cases.filter((item) => !["N6", "N7", "C4"].includes(item.id)),
    );
    const result = selectCases(reduced, requirements, [], general);
    expect(result.status).toBe("ok");
    expect(result.quotas.map((quota) => quota.count)).toEqual([5, 4, 3]);
    expect(
      result.warnings.some((warning) => warning.includes("only 5 distinct")),
    ).toBe(true);
    const failed = selectCases(
      withCases(reduced.bank.cases.filter((item) => item.id !== "L4")),
      requirements,
      [],
      general,
    );
    expect(failed.status).toBe("needs_edit");
    expect(failed.selected).toHaveLength(0);
  });

  it("excludes inactive cases, keeps uncovered requirements and validates the search limit", () => {
    expect(
      scoreCases(
        small.bank.cases.map((item) => ({ ...item, active: false })),
        requirements,
        [],
        policy.weights,
      ),
    ).toHaveLength(0);
    const result = selectCases(small, requirements, [], general);
    expect(result.coverage).toEqual([
      { requirementId: "R1", best: 0, caseIds: [] },
    ]);
    expect(result.warnings.at(-1)).toBe("Selected set has no evidence for: R1");
    expect(() => selectCases(small, requirements, [], general, 0)).toThrow(
      "search limit",
    );
  });

  it("falls back to the best cases with improving swaps past the search limit", () => {
    const exact = selectCases(small, requirements, [], general);
    const bounded = selectCases(small, requirements, [], general, 1);
    expect(bounded.status).toBe("ok");
    expect(bounded.selected).toHaveLength(14);
    expect(bounded.warnings[0]).toContain("search space exceeds 1 sets");
    expect(bounded.utility).toBeLessThanOrEqual(exact.utility + 1e-9);
  });

  it("prefers whole-set coverage over the highest independent scores", () => {
    const scenario = withCases(
      small.bank.cases.map((item) => ({
        ...item,
        categoryRatings: ratingsOf((id) =>
          item.id === "N7"
            ? 0
            : id === "FE" || id === "BE"
              ? 5
              : id === "AR" || id === "OW"
                ? 4
                : 0,
        ),
      })),
    );
    const both = [
      req("R1", "Product work", ["FE", "BE"]),
      req("R2", "Distinct responsibility", ["FE", "BE"]),
    ];
    const matches: Match[] = scenario.bank.cases
      .filter((item) => item.companyId === "northwind")
      .map((item) => ({
        requirementId: item.id === "N7" ? "R2" : "R1",
        caseId: item.id,
        match: 1,
        evidenceRefs: [`${item.id}:delivery`],
      }));
    const ranked = scoreCases(
      scenario.bank.cases,
      both,
      matches,
      policy.weights,
    );
    const greedy = ranked
      .filter((item) => item.companyId === "northwind")
      .slice(0, 6)
      .concat(
        ranked.filter(
          (item) => item.companyId === "lumen" || item.companyId === "cargo",
        ),
      );
    expect(greedy.some((item) => item.caseId === "N7")).toBe(false);
    const result = selectCases(scenario, both, matches, general);
    expect(result.selected.some((item) => item.caseId === "N7")).toBe(true);
    expect(result.utility).toBeGreaterThan(
      measureSet(greedy, both, policy.weights).utility,
    );
  });

  it("matches an independent three-company omission oracle", () => {
    const expanded = withCases(
      cases.filter((item) => /^N[1-7]$|^L[1-5]$|^C[1-5]$/.test(item.id)),
    );
    const ranked = scoreCases(
      expanded.bank.cases,
      requirements,
      [],
      policy.weights,
    );
    let optimum = Number.NEGATIVE_INFINITY;
    for (const n of ranked.filter((item) => item.companyId === "northwind"))
      for (const l of ranked.filter((item) => item.companyId === "lumen"))
        for (const c of ranked.filter((item) => item.companyId === "cargo"))
          optimum = Math.max(
            optimum,
            measureSet(
              ranked.filter(
                (item) => ![n.caseId, l.caseId, c.caseId].includes(item.caseId),
              ),
              requirements,
              policy.weights,
            ).utility,
          );
    const result = selectCases(expanded, requirements, [], general);
    expect(result.examinedSets).toBe(175);
    expect(result.utility).toBeCloseTo(optimum, 10);
  });

  it("lets a mobile case compete only when a requirement names mobile work; switched-off cases never", () => {
    const ranked = (list: typeof requirements, matches: Match[] = []) =>
      scoreCases(cases, list, matches, policy.weights).map(
        (item) => item.caseId,
      );
    expect(ranked(requirements)).not.toContain("N8");
    expect(ranked(requirements)).not.toContain("N9");
    // A match recorded for a switched-off case changes nothing.
    expect(
      ranked(requirements, [
        {
          requirementId: "R1",
          caseId: "N9",
          match: 1,
          evidenceRefs: ["N9:core"],
        },
      ]),
    ).toEqual(ranked(requirements));
    expect(
      ranked([
        ...requirements,
        req("R2", "Ship features to our React Native app", ["FE"], "must", [
          "React Native",
        ]),
      ]),
    ).toContain("N8");
    // Mobile-first web layouts are not mobile apps.
    expect(
      ranked([req("R1", "Build mobile-first responsive web pages", ["FE"])]),
    ).not.toContain("N8");
  });

  it("drops matches it cannot verify before scoring", () => {
    const result = selectCases(
      small,
      requirements,
      [
        {
          requirementId: "R1",
          caseId: "N1",
          match: 1,
          evidenceRefs: ["N1:core"],
        },
        {
          requirementId: "R1",
          caseId: "N1",
          match: 0.5,
          evidenceRefs: ["N1:core"],
        },
        {
          requirementId: "R1",
          caseId: "N2",
          match: 1,
          evidenceRefs: ["N1:core"],
        },
        {
          requirementId: "R9",
          caseId: "N3",
          match: 1,
          evidenceRefs: ["N3:core"],
        },
      ],
      general,
    );
    expect(result.matches).toEqual([
      {
        requirementId: "R1",
        caseId: "N1",
        match: 1,
        evidenceRefs: ["N1:core"],
      },
    ]);
    expect(result.coverage[0]).toEqual({
      requirementId: "R1",
      best: 1,
      caseIds: ["N1"],
    });
  });
});
