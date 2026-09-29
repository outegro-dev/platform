import { describe, expect, it } from "vitest";
import { issueKinds } from "@/lib/adapters/payments";
import en from "./en.json";
import ru from "./ru.json";

type Tree = { [key: string]: string | Tree };

const keys = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : keys(value, `${prefix}${key}.`),
  );

const at = (tree: Tree, key: string) =>
  key
    .split(".")
    .reduce<string | Tree | undefined>(
      (node, part) =>
        node && typeof node === "object" ? node[part] : undefined,
      tree,
    );

/** {name} placeholders outside plural/select branches. */
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)(?:,|\})/g)].map((match) => match[1]).sort();

describe("messages", () => {
  it("have the same keys in English and Russian", () => {
    expect(keys(ru as Tree).sort()).toEqual(keys(en as Tree).sort());
  });

  it("use the same placeholders in both languages", () => {
    const mismatched = keys(en as Tree).filter((key) => {
      const a = [...new Set(placeholders(at(en as Tree, key) as string))];
      const b = [...new Set(placeholders(at(ru as Tree, key) as string))];
      return JSON.stringify(a) !== JSON.stringify(b);
    });
    expect(mismatched).toEqual([]);
  });

  it("have no empty strings", () => {
    const empty = [...keys(en as Tree), ...keys(ru as Tree)].filter(
      (key) => (at(en as Tree, key) ?? at(ru as Tree, key)) === "",
    );
    expect(empty).toEqual([]);
  });

  it("name every payment issue kind in both languages", () => {
    for (const messages of [en, ru]) {
      expect(Object.keys(messages.labels.issueKind).sort()).toEqual(
        [...issueKinds].sort(),
      );
    }
    for (const kind of issueKinds)
      expect(ru.labels.issueKind[kind], kind).not.toBe(
        en.labels.issueKind[kind],
      );
  });
});
