import {
  applicationFlagSchema,
  applicationStages,
  archiveReasonSchema,
  atelierTaskTypes,
  channelKindSchema,
  coverageLabelSchema,
} from "@outegro/contracts/atelier";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import ru from "./ru.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/** Top-level ICU arguments of a message: {n}, {count, plural, …} → n, count. */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (char === "{") {
      if (depth === 0) {
        const name = /^\{\s*([A-Za-z0-9_]+)/.exec(message.slice(i))?.[1];
        if (name) names.add(name);
      }
      depth++;
    } else if (char === "}") {
      depth--;
    }
  }
  return [...names].sort();
}

const english = flatten(en as Tree);
const russian = flatten(ru as Tree);

describe("messages", () => {
  it("EN and RU have the same keys", () => {
    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
  });

  it("every translation uses the same arguments", () => {
    const mismatched = Object.keys(english).filter(
      (key) =>
        argumentsOf(english[key] ?? "").join() !==
        argumentsOf(russian[key] ?? "").join(),
    );
    expect(mismatched).toEqual([]);
  });

  it("no message is empty, and none uses a long dash", () => {
    const all = Object.entries({ ...english, ...russian });
    expect(all.filter(([, v]) => v.trim() === "").map(([k]) => k)).toEqual([]);
    expect(all.filter(([, v]) => /[—–]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("speaks Russian plurals with all their forms", () => {
    for (const [key, value] of Object.entries(russian))
      if (value.includes("plural,"))
        for (const form of ["one", "few", "many", "other"])
          expect(value, `${key}: ${form}`).toContain(`${form} {`);
  });

  it("names every stage, reason, flag, channel, coverage and step", () => {
    const keys = [
      ...applicationStages.map((s) => `stages.${s}`),
      ...applicationStages.map((s) => `stageHints.${s}`),
      ...archiveReasonSchema.options.map((r) => `reasons.${r}`),
      ...applicationFlagSchema.options.map((f) => `flags.${f}`),
      ...channelKindSchema.options.map((c) => `channels.${c}`),
      ...coverageLabelSchema.options.map((l) => `fit.labels.${l}`),
      ...atelierTaskTypes.map((s) => `steps.${s}`),
    ];
    for (const messages of [english, russian])
      expect(keys.filter((key) => !messages[key])).toEqual([]);
  });

  it("calls the product Atelier / Ателье", () => {
    expect(english["brand.product"]).toBe("Atelier");
    expect(russian["brand.product"]).toBe("Ателье");
  });

  it("counts the way each language does", () => {
    const t = createTranslator({ locale: "ru", messages: ru });
    expect(
      [1, 3, 5, 21].map((count) => t("inbox.matchesCount", { count })),
    ).toEqual(["1 вакансия", "3 вакансии", "5 вакансий", "21 вакансия"]);
    const e = createTranslator({ locale: "en", messages: en });
    expect(e("resume.opensValue", { count: 0 })).toBe("Not opened yet");
    expect(e("resume.opensValue", { count: 2 })).toBe("Opened 2 times");
  });
});
