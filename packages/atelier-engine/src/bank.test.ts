import type { BankCase, Profile } from "@outegro/contracts/atelier";
import { describe, expect, it } from "vitest";
import { validateBank } from "./bank.js";
import { caseById, cases, profile, withCases } from "./fixtures/profile.js";

const edit = (id: string, change: (item: BankCase) => BankCase): Profile =>
  withCases(
    cases.map((item) =>
      item.id === id ? change(structuredClone(item)) : item,
    ),
  );

describe("achievement bank integrity", () => {
  it("accepts the fixture bank", () => {
    expect(validateBank(profile)).toEqual([]);
  });

  it("rejects duplicate case and claim ids", () => {
    expect(
      validateBank(edit("N2", (item) => ({ ...item, id: "N1" }))),
    ).toContain("Duplicate case IDs: N1");
    const claims = validateBank(
      edit("N2", (item) => ({
        ...item,
        capabilities: [{ id: "N1:delivery", name: "x" }],
      })),
    );
    expect(claims).toContain("Duplicate claim/capability IDs: N1:delivery");
    expect(claims).toContain("N2: foreign claim/capability ID N1:delivery");
  });

  it("takes each company's prefix from the bank and rejects a case under the wrong one", () => {
    expect(
      validateBank(edit("N3", (item) => ({ ...item, companyId: "lumen" }))),
    ).toContain("N3: company mismatch (lumen cases start with L)");
    expect(
      validateBank(edit("N3", (item) => ({ ...item, companyId: "ghost" }))),
    ).toEqual(expect.arrayContaining(["N3: unknown company ghost"]));
    // A company whose cases all use another company's prefix is a conflict.
    const shared = withCases(
      cases.map((item) =>
        item.companyId === "cargo"
          ? { ...item, id: item.id.replace("C", "L9") }
          : item,
      ),
    );
    expect(
      validateBank(shared).some((error) =>
        error.includes("share the case ID prefix L"),
      ),
    ).toBe(true);
  });

  it("rejects inflated ratings", () => {
    expect(
      validateBank(
        edit("N1", (item) => ({
          ...item,
          categoryRatings: { ...item.categoryRatings, FE: 5 },
        })),
      ),
    ).toContain("N1: inflated ratings (at most two 5s and four ratings of 4+)");
  });

  it("rejects lost metrics, changed figures, incomplete text, raw LaTeX and non-progressive variants", () => {
    const variants = (id: string, change: Partial<BankCase["variants"]>) =>
      validateBank(
        edit(id, (item) => ({
          ...item,
          variants: { ...item.variants, ...change },
        })),
      );
    expect(
      variants("N1", { minimal: "Delivered a B2B ordering portal." }),
    ).toEqual(
      expect.arrayContaining([
        "N1: metric '3 months' lost in a variant",
        "N1: numerical claims changed between variants",
      ]),
    );
    expect(
      variants("N1", {
        compact: caseById("N1").variants.compact.replace(
          "3 months",
          "2 months",
        ),
      }),
    ).toEqual(
      expect.arrayContaining(["N1: numerical claims changed between variants"]),
    );
    expect(
      variants("N4", { minimal: "Made RabbitMQ processing idempotent" }),
    ).toContain("N4: incomplete or raw LaTeX variant");
    expect(
      variants("N4", { minimal: "Built \\textbf{RabbitMQ} processing." }),
    ).toContain("N4: incomplete or raw LaTeX variant");
    expect(
      variants("N4", {
        minimal: `${caseById("N4").variants.full} And more words here.`,
      }),
    ).toContain("N4: variants do not shorten progressively");
  });

  it("checks quotas against the companies' cases", () => {
    const quota = {
      ...profile,
      companies: profile.companies.map((company) =>
        company.id === "oldtown"
          ? {
              ...company,
              quota: {
                general: { target: 2, min: 3 },
                ai: { target: 0, min: 0 },
              },
            }
          : company,
      ),
    };
    expect(validateBank(quota)).toEqual([
      "oldtown: general quota minimum 3 exceeds its target 2",
      "oldtown: general quota 2 but no active cases",
    ]);
  });
});
