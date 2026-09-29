import {
  finishReasonSchema,
  matchAbortReasonSchema,
} from "@outegro/contracts/battleship";
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

/** Top-level ICU arguments of a message: {cell}, {count, plural, …} → cell, count. */
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

describe("messages", () => {
  const english = flatten(en as Tree);
  const russian = flatten(ru as Tree);

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

  it("no message is empty", () => {
    expect(
      Object.entries({ ...english, ...russian })
        .filter(([, value]) => value.trim() === "")
        .map(([key]) => key),
    ).toEqual([]);
  });

  it("explains every reason a match is cancelled", () => {
    for (const reason of [...matchAbortReasonSchema.options, "unknown"])
      for (const messages of [english, russian])
        expect(messages[`result.aborted.${reason}`], reason).toBeTruthy();
  });

  it("explains every way a match is won or lost", () => {
    // A fleet not deployed in time is told apart from missed turns.
    for (const reason of [...finishReasonSchema.options, "deploy_timeout"])
      for (const outcome of ["win", "loss"])
        for (const messages of [english, russian])
          expect(
            messages[`result.reasons.${outcome}.${reason}`],
            `${outcome}.${reason}`,
          ).toBeTruthy();
  });
});
