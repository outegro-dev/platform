import { platformRoles } from "@outegro/contracts";
import { matchAbortReasonSchema } from "@outegro/contracts/battleship";
import {
  accessRuleSchema,
  adminGrantSchema,
  bookStatusSchema,
  eduAuditActionSchema,
  readerAccessSchema,
} from "@outegro/contracts/edu";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { issueKinds } from "@/lib/adapters/payments";
import { accessModes, assistStates, featurePresets } from "@/lib/education";
import { formatNumber } from "@/lib/format";
import { grantPhases } from "@/lib/grants";
import { labelKey } from "@/lib/labels";
import { toneOf } from "@/lib/tones";
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

  it("label every reason a match is aborted", () => {
    for (const reason of matchAbortReasonSchema.options)
      for (const messages of [en, ru])
        expect(
          at(messages as Tree, `labels.abortReason.${reason}`),
          reason,
        ).toBeTruthy();
  });

  it("label every book status and reader access", () => {
    for (const messages of [en, ru]) {
      for (const status of bookStatusSchema.options)
        expect(
          at(messages as Tree, `labels.bookStatus.${status}`),
          status,
        ).toBeTruthy();
      for (const access of readerAccessSchema.options)
        expect(
          at(messages as Tree, `labels.readerAccess.${access}`),
          access,
        ).toBeTruthy();
    }
  });

  it("name every Education audit action", () => {
    for (const action of eduAuditActionSchema.options)
      for (const messages of [en, ru])
        expect(
          at(messages as Tree, `labels.action.${labelKey(action)}`),
          action,
        ).toBeTruthy();
  });

  it("label every source and state of an Education grant", () => {
    const { sourceType, state } = adminGrantSchema.shape;
    for (const messages of [en, ru]) {
      for (const source of sourceType.options)
        expect(
          at(messages as Tree, `labels.grantSource.${source}`),
          source,
        ).toBeTruthy();
      for (const value of state.options)
        expect(
          at(messages as Tree, `labels.grantState.${value}`),
          value,
        ).toBeTruthy();
    }
  });

  it("name every phase of a grant; only a grant in force reads as fine", () => {
    for (const phase of grantPhases) {
      for (const messages of [en, ru])
        expect(
          at(messages as Tree, `labels.grantPhase.${phase}`),
          phase,
        ).toBeTruthy();
      expect(toneOf("grantPhase", phase) === "ok", phase).toBe(
        phase === "active",
      );
    }
  });

  it("offer and name every access mode of the contract, and every grant preset", () => {
    // The access dialog lists the console's modes: exactly the contract's.
    expect([...accessModes].sort()).toEqual(
      accessRuleSchema.options.map((option) => option.shape.mode.value).sort(),
    );
    for (const messages of [en, ru]) {
      for (const mode of accessModes)
        for (const place of [
          "education.book.modes",
          "education.book.modeHints",
        ])
          expect(
            at(messages as Tree, `${place}.${mode}`),
            `${place}.${mode}`,
          ).toBeTruthy();
      for (const preset of featurePresets)
        for (const place of ["education.rule.presets", "education.rule.who"])
          expect(
            at(messages as Tree, `${place}.${preset}`),
            `${place}.${preset}`,
          ).toBeTruthy();
    }
  });

  it("name every state of the AI assistant, each with its hint; a pause warns", () => {
    for (const messages of [en, ru])
      for (const state of assistStates)
        for (const key of [state, `${state}Hint`])
          expect(
            at(messages as Tree, `education.assist.${key}`),
            key,
          ).toBeTruthy();
    expect(assistStates.map((state) => toneOf("assist", state))).toEqual([
      "ok",
      "warn",
      "neutral",
    ]);
  });

  it("write the spending cap with grouped numbers and the right plural", () => {
    // As the panel does: today's calls through the shared formatter (a plain
    // number argument would not be grouped), the cap through the plural.
    const line = (locale: "en" | "ru", used: number, limit: number) =>
      createTranslator({
        locale,
        messages: locale === "ru" ? ru : en,
        namespace: "education.assist",
      })("globalUsed", { used: formatNumber(used, locale), limit });
    expect(line("en", 37, 500)).toBe("37 of 500 calls today");
    expect(line("en", 1234, 5000)).toBe("1,234 of 5,000 calls today");
    expect(line("en", 0, 1)).toBe("0 of 1 call today");
    expect(line("ru", 37, 500)).toBe("37 из 500 запросов сегодня");
    // Grouped as Intl writes Russian numbers (a no-break space).
    expect(line("ru", 1234, 5000)).toMatch(
      /^1\s234 из 5\s000 запросов сегодня$/,
    );
    expect(line("ru", 0, 1)).toBe("0 из 1 запроса сегодня");
    expect(line("ru", 3, 21)).toBe("3 из 21 запроса сегодня");
    expect(line("ru", 1, 3)).toBe("1 из 3 запросов сегодня");
  });

  it("translate every text of the AI assistant panel", () => {
    const copied = keys(en.education.assist as Tree).filter(
      (key) =>
        at(en.education.assist as Tree, key) ===
        at(ru.education.assist as Tree, key),
    );
    expect(copied).toEqual([]);
  });

  it("call the product Education in English and «Обучение» in Russian", () => {
    // Wherever the console names the service itself.
    const names = [
      "shell.nav.education",
      "users.tabs.education",
      "audit.sources.education",
      "dashboard.education.service",
      "users.education.service",
      ...keys(en.education as Tree)
        .filter((key) => key.endsWith(".service"))
        .map((key) => `education.${key}`),
    ];
    for (const key of names) {
      expect(at(en as Tree, key), key).toBe("Education");
      expect(at(ru as Tree, key), key).toBe("Обучение");
    }
    // In Russian sentences it is quoted and declined, never "учебники".
    for (const key of [
      "shell.roles.edu_editor",
      "users.education.grants",
      "education.audit.title",
    ]) {
      expect(at(en as Tree, key), key).toContain("Education");
      expect(at(ru as Tree, key), key).toMatch(/«Обучени[а-яё]*»/);
    }
  });

  it("name every platform role wherever roles are shown", () => {
    for (const role of Object.keys(platformRoles))
      for (const messages of [en, ru])
        for (const place of [
          "shell.roles",
          "labels.role",
          "dashboard.identity.role",
        ])
          expect(
            at(messages as Tree, `${place}.${role}`),
            `${place}.${role}`,
          ).toBeTruthy();
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
