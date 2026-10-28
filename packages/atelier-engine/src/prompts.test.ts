import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assembleCv } from "./assemble.js";
import {
  analysisOf,
  cases,
  fieldsOf,
  profile,
  req,
} from "./fixtures/profile.js";
import { analyzePrompt } from "./prompts/analyze.js";
import { composePrompt } from "./prompts/compose.js";
import { matchPrompt } from "./prompts/match.js";
import { repairPrompt, reviewPrompt } from "./prompts/review.js";
import { answerSchema } from "./prompts/schema.js";
import { textsPrompt } from "./prompts/texts.js";
import { rolePolicy } from "./role-policy.js";
import { selectCases } from "./selection.js";
import type { Prompt } from "./types.js";

const requirements = [
  req("R1", "Strong React interfaces", ["FE"], "must", ["React"]),
];
const analysis = analysisOf(requirements);
const selection = selectCases(
  profile,
  requirements,
  [],
  rolePolicy(requirements, analysis.title),
);
const draft = assembleCv(profile, analysis, selection, {
  about: profile.summary,
  bullets: [],
  newBullets: [],
  changeNotes: [],
});
const fields = fieldsOf(
  "Acme Robotics hires a Senior Frontend Engineer to build React interfaces.",
);

const prompts: [string, Prompt<unknown>][] = [
  ["analyze", analyzePrompt(fields)],
  ["match", matchPrompt(requirements, cases)],
  ["compose", composePrompt({ profile, analysis, selection })],
  ["review", reviewPrompt({ profile, analysis, draft })],
  [
    "repair",
    repairPrompt({
      profile,
      analysis,
      draft,
      findings: [
        {
          code: "about_duplicate",
          location: "about.profile.full",
          affectedIds: [],
          explanation: "x",
        },
      ],
    }),
  ],
  [
    "texts",
    textsPrompt({
      profile,
      analysis,
      fields,
      cv: draft,
      kinds: ["email_en"],
      questions: [],
    }),
  ],
];

/** Every object of a schema, with its path. */
function objects(
  node: unknown,
  path = "$",
): [string, Record<string, unknown>][] {
  if (Array.isArray(node))
    return node.flatMap((item, index) => objects(item, `${path}[${index}]`));
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const own: [string, Record<string, unknown>][] =
    record.type === "object" ? [[path, record]] : [];
  return [
    ...own,
    ...Object.entries(record).flatMap(([key, value]) =>
      objects(value, `${path}.${key}`),
    ),
  ];
}

describe("prompt schemas", () => {
  it.each(prompts)(
    "%s: strict output schema, every property required, no extras",
    (_, prompt) => {
      expect(prompt.schema.$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(prompt.schema.type).toBe("object");
      const found = objects(prompt.schema);
      expect(found.length).toBeGreaterThan(0);
      for (const [path, node] of found) {
        const properties = Object.keys(
          (node.properties as Record<string, unknown>) ?? {},
        );
        expect({ path, required: node.required }).toEqual({
          path,
          required: properties,
        });
        expect({
          path,
          additionalProperties: node.additionalProperties,
        }).toEqual({ path, additionalProperties: false });
      }
      expect(JSON.stringify(prompt.schema)).not.toMatch(
        /"(minLength|maxLength|pattern|format)"/,
      );
      expect(prompt.system.length).toBeLessThan(50_000);
      expect(prompt.input).not.toContain("jordan.vale@example.com");
    },
  );

  it.each(prompts)(
    "%s: only plain objects, arrays, enums and scalars",
    (_, prompt) => {
      expect(JSON.stringify(prompt.schema)).not.toMatch(
        /"(allOf|oneOf|\$ref|\$defs|patternProperties|propertyNames)"/,
      );
    },
  );

  it("refuses records, intersections and untyped values in an answer schema", () => {
    expect(() =>
      answerSchema(z.object({ ratings: z.record(z.string(), z.number()) })),
    ).toThrow("record");
    expect(() => answerSchema(z.object({ value: z.any() }))).toThrow("untyped");
    expect(() =>
      answerSchema(
        z.object({ value: z.intersection(z.string(), z.enum(["a"])) }),
      ),
    ).toThrow("allOf");
    // A map goes as an array of {key, value} objects instead.
    expect(() =>
      answerSchema(
        z.object({
          ratings: z.array(z.object({ key: z.string(), value: z.number() })),
        }),
      ),
    ).not.toThrow();
  });

  it("states nullable values as a type list, not as optional properties", () => {
    const schema = analyzePrompt(fields).schema as {
      properties: Record<string, { type?: unknown; anyOf?: unknown }>;
    };
    expect(schema.properties.company?.type).toEqual(["string", "null"]);
    expect(JSON.stringify(schema.properties.cvRole)).toContain('"type":"null"');
  });
});
