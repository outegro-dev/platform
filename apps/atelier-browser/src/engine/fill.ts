import type {
  BrowserApplyRequest,
  BrowserApplyResponse,
} from "@outegro/contracts/atelier";
import type { Locator, Page } from "playwright";
import type { AtsAdapter } from "../adapters/index.js";
import { type DecideContext, type Decision, decide } from "./decide.js";
import {
  collectFields,
  isChosen,
  type ListOption,
  listOptions,
  type RawField,
} from "./page-scripts.js";
import { cleanLabel, normalize } from "./text.js";

export type Filled = BrowserApplyResponse["filled"][number];
export type Unanswered = BrowserApplyResponse["unanswered"][number];

export type FormFiles = {
  cvPath: string;
  cvName: string;
  coverPath: string | null;
  coverName: string | null;
};

const at = (page: Page, ref: string): Locator =>
  page.locator(`[data-atelier-ref="${ref}"]`).first();

export function collect(
  page: Page,
  adapter: AtsAdapter,
  fileNames: string[] = [],
): Promise<RawField[]> {
  return page.evaluate(collectFields, {
    roots: adapter.formSelectors,
    ignore: adapter.ignoreSelectors,
    fileNames,
  });
}

/**
 * A field's identity across re-renders: kind, label and `name`. Not the
 * ref or the element id, which React forms regenerate (Workable does).
 */
const keyOf = (field: RawField) =>
  `${field.kind}|${normalize(field.label)}|${field.hints.match(/^name:(\S*)/)?.[1] ?? ""}|${field.placeholder}`;

type Outcome = { ok: true; value: string } | { ok: false; retry: boolean };
const failed = (retry = false): Outcome => ({ ok: false, retry });

async function present(locator: Locator) {
  return (await locator.count()) > 0;
}

async function setText(
  page: Page,
  field: RawField,
  value: string,
): Promise<Outcome> {
  const input = at(page, field.ref);
  if (!(await present(input))) return failed(true);
  await input.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await input.fill(value, { timeout: 5000 });
  await input.blur().catch(() => {});
  const now = await input.inputValue().catch(() => "");
  return now.trim() ? { ok: true, value } : failed();
}

async function setLocation(
  page: Page,
  adapter: AtsAdapter,
  field: RawField,
  value: string,
  city: string,
): Promise<Outcome> {
  if (!adapter.locationSuggestions) return setText(page, field, value);
  const input = at(page, field.ref);
  if (!(await present(input))) return failed(true);
  await input.fill("", { timeout: 5000 });
  await input.pressSequentially(city, { delay: 60, timeout: 10_000 });
  const suggestion = page
    .locator(adapter.locationSuggestions)
    .filter({
      hasText: new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    })
    .first();
  try {
    await suggestion.waitFor({ state: "visible", timeout: 8000 });
    const text = (await suggestion.innerText()).trim();
    await suggestion.click({ timeout: 5000 });
    return { ok: true, value: text || value };
  } catch {
    // No suggestion: keep the typed location as it is.
    return setText(page, field, value);
  }
}

async function upload(
  page: Page,
  adapter: AtsAdapter,
  field: RawField,
  path: string,
  name: string,
): Promise<Outcome> {
  const input = at(page, field.ref);
  if (!(await present(input))) return failed(true);
  await input.setInputFiles(path, { timeout: 10_000 });
  if (adapter.uploadDone)
    await page
      .locator(adapter.uploadDone)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  return { ok: true, value: name };
}

async function chooseOptions(
  page: Page,
  field: RawField,
  indices: number[],
): Promise<Outcome> {
  const options = field.options ?? [];
  const chosen = indices
    .map((index) => options[index])
    .filter((option) => option !== undefined);
  if (!chosen.length) return failed();
  const value = chosen.map((option) => option.label).join(", ");
  if (field.kind === "select") {
    const select = at(page, field.ref);
    if (!(await present(select))) return failed(true);
    await select.selectOption(
      chosen.map((option) => ({ index: option.index })),
      { timeout: 5000, force: true },
    );
    return { ok: true, value };
  }
  for (const option of chosen) {
    if (option.selected) continue;
    const target = at(page, option.click);
    if (!(await present(target))) return failed(true);
    await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await target
      .click({ timeout: 5000 })
      .catch(() => target.click({ timeout: 3000, force: true }))
      .catch(() => {});
    if (!(await page.evaluate(isChosen, option.ref))) {
      // A hidden native input behind a custom widget: click it directly.
      await at(page, option.ref)
        .evaluate((el) => (el as HTMLElement).click())
        .catch(() => {});
      if (!(await page.evaluate(isChosen, option.ref))) return failed();
    }
  }
  return { ok: true, value };
}

async function setCheckbox(
  page: Page,
  field: RawField,
  on: boolean,
): Promise<Outcome> {
  const value = on ? "checked" : "unchecked";
  if ((await page.evaluate(isChosen, field.ref)) === on)
    return { ok: true, value };
  const target = at(page, field.click);
  if (!(await present(target))) return failed(true);
  await target
    .click({ timeout: 5000 })
    .catch(() => target.click({ timeout: 3000, force: true }))
    .catch(() => {});
  if ((await page.evaluate(isChosen, field.ref)) !== on) {
    await at(page, field.ref)
      .evaluate((el) => (el as HTMLElement).click())
      .catch(() => {});
    if ((await page.evaluate(isChosen, field.ref)) !== on) return failed();
  }
  return { ok: true, value };
}

/** Options of the open list, once they stop changing (async suggestions). */
async function waitOptions(
  page: Page,
  field: RawField,
  timeoutMs: number,
): Promise<ListOption[]> {
  const end = Date.now() + timeoutMs;
  let last: ListOption[] = [];
  let stable = 0;
  while (Date.now() < end) {
    const now = await page
      .evaluate(listOptions, { listbox: field.listbox, extra: null })
      .catch(() => []);
    if (now.length && now.length === last.length) {
      stable++;
      if (stable >= 2) return now;
    } else stable = 0;
    last = now;
    await page.waitForTimeout(250);
  }
  return last;
}

async function pickCombo(
  page: Page,
  adapter: AtsAdapter,
  field: RawField,
  search: string,
  pick: (labels: readonly string[]) => number | null,
): Promise<Outcome> {
  const input = at(page, field.ref);
  if (!(await present(input))) return failed(true);
  await input.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await input.click({ timeout: 5000 }).catch(() => input.focus());
  let options = await waitOptions(page, field, 1500);
  let index = options.length
    ? pick(options.map((option) => option.label))
    : null;
  if (index === null && search && !field.readonly) {
    await input.fill("").catch(() => {});
    await input.pressSequentially(search.slice(0, 80), {
      delay: 40,
      timeout: 15_000,
    });
    options = await waitOptions(page, field, 8000);
    index = options.length ? pick(options.map((option) => option.label)) : null;
  }
  const option = index === null ? undefined : options[index];
  if (!option) {
    await page.keyboard.press("Escape").catch(() => {});
    if (!field.readonly) await input.fill("").catch(() => {});
    return failed();
  }
  await at(page, option.ref).click({ timeout: 5000 });
  await page.waitForTimeout(300);
  const after = (await collect(page, adapter)).find((f) => f.ref === field.ref);
  return after && !after.answered
    ? failed()
    : { ok: true, value: option.label };
}

async function apply(
  page: Page,
  adapter: AtsAdapter,
  field: RawField,
  decision: Decision,
): Promise<Outcome> {
  switch (decision.kind) {
    case "text":
      return setText(page, field, decision.value);
    case "location":
      return setLocation(page, adapter, field, decision.value, decision.city);
    case "file":
      return upload(page, adapter, field, decision.path, decision.name);
    case "options":
      return chooseOptions(page, field, decision.indices);
    case "combo":
      return pickCombo(page, adapter, field, decision.search, decision.pick);
    case "check":
      return setCheckbox(page, field, decision.on);
    default:
      return failed();
  }
}

export type FillResult = { filled: Filled[]; unanswered: Unanswered[] };

/**
 * Fills the form in passes: files first (an uploaded CV may be parsed into
 * the fields and re-render them), then everything else; a pass that shows
 * new fields (conditional questions) leads to another one.
 */
export async function fillForm(
  page: Page,
  adapter: AtsAdapter,
  req: BrowserApplyRequest,
  files: FormFiles,
  deadline: number,
): Promise<FillResult> {
  const fileNames = [files.cvName, files.coverName].filter(
    (name): name is string => name !== null,
  );
  const filled = new Map<string, Filled>();
  const done = new Set<string>();
  const left = new Set<string>();
  const record = (field: RawField, value: string) => {
    // An upload re-labels its field ("Resume" → "Resume Replace file"): one entry.
    if (
      field.kind === "file" &&
      [...filled.values()].some((entry) => entry.value === value)
    )
      return;
    filled.set(keyOf(field), {
      label: cleanLabel(field.label) || field.placeholder || field.kind,
      value: value.slice(0, 5000),
    });
  };

  for (let pass = 0; pass < 5 && Date.now() < deadline; pass++) {
    const fields = await collect(page, adapter, fileNames);
    const ctx: DecideContext = { req, ...files, fields };
    const ordered = [
      ...fields.filter((field) => field.kind === "file"),
      ...fields.filter((field) => field.kind !== "file"),
    ];
    let acted = false;
    let uploaded = false;
    for (const field of ordered) {
      if (Date.now() > deadline) break;
      if (uploaded && field.kind !== "file") break;
      const key = keyOf(field);
      if (done.has(key)) continue;
      done.add(key);
      const decision = decide(field, ctx);
      if (!decision) continue;
      if (decision.kind === "leave") {
        left.add(key);
        continue;
      }
      if (decision.kind === "keep") {
        if (field.answered) record(field, field.value);
        continue;
      }
      const outcome = await apply(page, adapter, field, decision).catch(
        (): Outcome => failed(),
      );
      if (outcome.ok) {
        record(field, outcome.value);
        acted = true;
        if (field.kind === "file") uploaded = true;
      } else if (outcome.retry) {
        done.delete(key);
      }
    }
    if (!acted) break;
  }

  const unanswered = await unansweredOf(
    page,
    adapter,
    fileNames,
    left,
    deadline,
  );
  const seen = new Set<string>();
  const unique = [...filled.values()].filter((entry) => {
    const key = `${entry.label}\n${entry.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { filled: unique, unanswered };
}

async function unansweredOf(
  page: Page,
  adapter: AtsAdapter,
  fileNames: string[],
  left: Set<string>,
  deadline: number,
): Promise<Unanswered[]> {
  const fields = await collect(page, adapter, fileNames);
  const result: Unanswered[] = [];
  let opened = 0;
  for (const field of fields) {
    if (field.answered) continue;
    if (left.has(keyOf(field)) && !field.required) continue;
    let options = field.options?.map((option) => option.label) ?? null;
    if (
      field.kind === "combobox" &&
      opened < 15 &&
      deadline - Date.now() > 15_000
    ) {
      opened++;
      options = await comboOptions(page, field).catch(() => null);
    }
    result.push({
      label: (cleanLabel(field.label) || field.placeholder || field.kind).slice(
        0,
        1000,
      ),
      type: field.kind,
      required: field.required,
      options: options?.length
        ? options.slice(0, 200).map((option) => option.slice(0, 300))
        : null,
    });
  }
  return result;
}

/** Opens a select-like combobox, reads its options and closes it again. */
async function comboOptions(
  page: Page,
  field: RawField,
): Promise<string[] | null> {
  const input = at(page, field.ref);
  if (!(await present(input))) return null;
  await input.click({ timeout: 3000 });
  const options = await waitOptions(page, field, 1200);
  await page.keyboard.press("Escape").catch(() => {});
  await input.blur().catch(() => {});
  return options.length ? options.map((option) => option.label) : null;
}
