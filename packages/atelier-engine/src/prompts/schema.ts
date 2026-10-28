import { z } from "zod";

/** Keywords strict structured output (Codex `--output-schema`) does not accept. */
const unsupported = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "$schema",
]);

function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== "object") return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (unsupported.has(key)) continue;
    // Zod states the safe-integer range on every int; it says nothing.
    if (
      (key === "minimum" || key === "maximum") &&
      typeof value === "number" &&
      Math.abs(value) >= Number.MAX_SAFE_INTEGER
    )
      continue;
    result[key] = strict(value);
  }
  if (
    result.type === "object" &&
    result.properties &&
    typeof result.properties === "object"
  ) {
    result.required = Object.keys(result.properties);
    result.additionalProperties = false;
  }
  return result;
}

/**
 * What llm-gateway's strict output accepts: plain objects, arrays, enums,
 * strings, numbers and booleans, nullable through `anyOf [T, null]` or a type
 * list. No records (a schema as additionalProperties), no intersections
 * (allOf), no untyped values (z.any / z.unknown); a map goes in the answer
 * as an array of {key, value} objects and is converted in `parse`.
 */
function assertPlain(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      assertPlain(item, `${path}[${index}]`);
    });
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const banned of [
    "allOf",
    "oneOf",
    "not",
    "patternProperties",
    "$ref",
    "$defs",
  ])
    if (banned in record)
      throw new Error(`Answer schema uses ${banned} at ${path}`);
  if ("additionalProperties" in record && record.additionalProperties !== false)
    throw new Error(`Answer schema has a record at ${path}`);
  if (record.type === "object" && !record.properties)
    throw new Error(
      `Answer schema has an object without properties at ${path}`,
    );
  if (
    !("type" in record) &&
    !("anyOf" in record) &&
    !("enum" in record) &&
    !("const" in record)
  )
    throw new Error(`Answer schema has an untyped value at ${path}`);
  for (const [key, value] of Object.entries(record)) {
    if (key === "properties" && value && typeof value === "object") {
      for (const [name, property] of Object.entries(value))
        assertPlain(property, `${path}.${name}`);
      continue;
    }
    if (key === "items" || key === "anyOf")
      assertPlain(value, `${path}.${key}`);
  }
}

/**
 * JSON Schema of a model answer, strict: every property required (optional
 * values are nullable instead), no additional properties, no string length or
 * pattern keywords, only plain types (assertPlain). The answer is validated
 * again by Zod in `parse`.
 */
export function answerSchema(schema: z.ZodType): Record<string, unknown> {
  const plain = strict(z.toJSONSchema(schema)) as Record<string, unknown>;
  assertPlain(plain, "$");
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...plain };
}

/** Untrusted data for the model: a labelled JSON block. */
export const dataBlock = (label: string, value: unknown) =>
  `${label}=${JSON.stringify(value)}`;

/** Trimmed strings without empty ones. */
export const texts = (values: string[]) =>
  values.map((value) => value.trim()).filter(Boolean);
