import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

/*
 * The material library (/design-system) shows every @outegro/ui component;
 * these checks run the kit's tabs, toggle groups, progress, notices, state
 * panels and copy button in real engines.
 */

const BASE = "http://localhost:3100";

async function useLocale(context: BrowserContext, locale: "en" | "ru") {
  await context.addCookies([{ name: "og_locale", value: locale, url: BASE }]);
}

/**
 * Elements that end past the right edge of the viewport outside any
 * scrolling or clipping box: content the page would cut off (html clips
 * overflow-x, so scrollWidth alone cannot see it).
 */
function cutOff(page: Page) {
  return page.evaluate(() => {
    const clipped = (el: Element) => {
      for (
        let p = el.parentElement;
        p && p !== document.body;
        p = p.parentElement
      )
        if (getComputedStyle(p).overflowX !== "visible") return true;
      return false;
    };
    return [...document.querySelectorAll("main *")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.right > window.innerWidth + 0.5;
      })
      .filter((el) => !clipped(el))
      .map(
        (el) => `${el.tagName.toLowerCase()} ${el.textContent?.slice(0, 30)}`,
      );
  });
}

/**
 * The box that takes pointer input: the border box, grown by an invisible
 * ::after (measured from the padding box) when it reaches further.
 */
function touchTarget(element: Locator) {
  return element.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
    const border = (side: string) =>
      Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
    const reach = (side: "top" | "right" | "bottom" | "left") =>
      after.display === "none" || after.position !== "absolute"
        ? 0
        : Math.max(0, -Number.parseFloat(after[side]) - border(side));
    const top = box.top - reach("top");
    const bottom = box.bottom + reach("bottom");
    const left = box.left - reach("left");
    const right = box.right + reach("right");
    // The browser agrees: a point just inside the extension hits the control.
    const x = box.left + box.width / 2;
    const hits = (y: number) => el.contains(document.elementFromPoint(x, y));
    return {
      drawn: { width: box.width, height: box.height },
      width: right - left,
      height: bottom - top,
      hitsAbove: hits(top + 0.5),
      hitsBelow: hits(bottom - 0.5),
    };
  });
}

for (const locale of ["en", "ru"] as const) {
  test(`${locale}: the material library passes axe and fits every phone`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design-system");
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => cutOff(page), { message: `Cut off at ${width}` })
        .toEqual([]);
    }
  });
}

test("tabs: arrows select, the strip scrolls on a phone, manual mode waits for Enter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/design-system");
  const views = page.getByRole("tablist", {
    name: "Ways to see the event loop",
  });
  await views.getByRole("tab", { name: "Analogy" }).focus();
  await page.keyboard.press("ArrowRight");
  const code = views.getByRole("tab", { name: "Code" });
  await expect(code).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Code" })).toContainText(
    "setTimeout",
  );
  // A visible ring on the keyboard-focused tab, drawn inside the strip.
  await expect(code).toHaveCSS("outline-style", "solid");
  // End skips the disabled tab; the strip scrolls to it, the page does not.
  await page.keyboard.press("End");
  const interview = views.getByRole("tab", { name: "In an interview" });
  await expect(interview).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => views.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  const box = await interview.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  expect((box?.height ?? 0) >= 44).toBe(true);

  const sections = page.getByRole("tablist", { name: "Payments sections" });
  await sections.getByRole("tab", { name: "Orders" }).focus();
  await page.keyboard.press("ArrowRight");
  const grants = sections.getByRole("tab", { name: "Access grants" });
  await expect(grants).toBeFocused();
  await expect(grants).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(grants).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "Access grants" }),
  ).toBeVisible();
});

test("toggle groups: one choice stays chosen, the toolbar toggles, keyboard works", async ({
  page,
}) => {
  await page.goto("/design-system");
  const toggles = page.locator("#toggles");
  const modes = toggles.getByRole("radiogroup", { name: "Cards to review" });
  const fresh = modes.getByRole("radio", { name: "New" });
  await fresh.click();
  await expect(fresh).toHaveAttribute("aria-checked", "true");
  await fresh.click(); // like a radio button, a second press keeps the choice
  await expect(fresh).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowRight");
  const later = modes.getByRole("radio", { name: "Again later" });
  await expect(later).toBeFocused();
  await page.keyboard.press("Space");
  await expect(later).toHaveAttribute("aria-checked", "true");
  await expect(fresh).toHaveAttribute("aria-checked", "false");

  const topics = toggles.getByRole("toolbar", { name: "Topics" });
  const memory = topics.getByRole("button", { name: "Memory" });
  await expect(memory).toHaveAttribute("aria-pressed", "false");
  await memory.click();
  await expect(memory).toHaveAttribute("aria-pressed", "true");
  await expect(topics.getByRole("button", { name: "Async" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(topics.getByRole("button", { name: "Archived" })).toBeDisabled();
});

test("compact buttons and toggles keep a 44 px touch target at their drawn size", async ({
  page,
}) => {
  await page.goto("/design-system");
  const controls = page.locator("#targets, #toggles").locator(
    // Disabled and pending controls ignore the pointer on purpose.
    ':is([data-slot="button"], [data-slot="toggle-group-item"]):not(:disabled, [aria-disabled="true"])',
  );
  expect(await controls.count()).toBeGreaterThan(10);
  for (const control of await controls.all()) {
    await control.scrollIntoViewIfNeeded();
    const target = await touchTarget(control);
    const name = await control.textContent();
    expect(target.height, `height of ${name}`).toBeGreaterThanOrEqual(44);
    expect(target.width, `width of ${name}`).toBeGreaterThanOrEqual(44);
    expect(target.hitsAbove && target.hitsBelow, `hit test of ${name}`).toBe(
      true,
    );
  }
  // The small button is still drawn 40 px tall.
  const small = page
    .locator("#targets")
    .getByRole("button", { name: "Small action" });
  expect((await touchTarget(small.first())).drawn.height).toBe(40);
});

test("progress: clamped values, spoken text, a fill that only moves", async ({
  page,
}) => {
  await page.goto("/design-system");
  const upload = page.getByRole("progressbar", { name: /130 out of 100/ });
  await expect(upload).toHaveAttribute("aria-valuenow", "100");
  await expect(upload).toHaveAttribute("aria-valuemax", "100");
  const exercises = page.getByRole("progressbar", { name: "Exercises solved" });
  await expect(exercises).toHaveAttribute("aria-valuetext", "3 of 10");

  const chapter = page.getByRole("progressbar", { name: "Chapter read" });
  const fill = chapter.locator('[data-slot="progress-indicator"]');
  await expect(chapter).toHaveAttribute("aria-valuenow", "40");
  // Layout width (transforms aside): the fill is moved, never resized.
  const layoutWidth = () =>
    fill.evaluate((el) => (el as HTMLElement).offsetWidth);
  const width = await layoutWidth();
  await page
    .getByRole("radiogroup", { name: "Chapter read" })
    .getByRole("radio", { name: "75%" })
    .click();
  await expect(chapter).toHaveAttribute("aria-valuenow", "75");
  await expect(chapter).toHaveAttribute("aria-valuetext", "75%");
  await expect(fill).toHaveAttribute("style", /translateX\(-25%\)/);
  await expect(fill).toHaveCSS("transition-property", /^transform/);
  expect(await layoutWidth()).toBe(width);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(fill).toHaveCSS("transition-property", "none");
});

test("copy button: copied then back, a refused clipboard says so, the width holds", async ({
  page,
}) => {
  // The clipboard as the page sees it, recording what was written (real
  // clipboard permissions differ per engine).
  await page.addInitScript(() => {
    const written: string[] = [];
    Object.defineProperty(window, "copied", { value: written });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
  });
  await page.goto("/design-system");
  const section = page.locator("#copy");
  const buttons = section.locator('[data-slot="copy-button"]');
  const command = buttons.first();
  const status = section.locator('[data-slot="copy-button-status"]').first();
  await expect(command).toHaveAccessibleName("Copy");
  await command.scrollIntoViewIfNeeded();
  const before = await command.boundingBox();

  await command.click();
  await expect(command).toHaveAccessibleName("Copied");
  await expect(status).toHaveText("Copied");
  expect(
    await page.evaluate(
      () => (window as unknown as { copied: string[] }).copied,
    ),
  ).toEqual(["pnpm --filter @outegro/ui test"]);
  expect(await command.boundingBox()).toEqual(before);
  await expect(command).toHaveAccessibleName("Copy", { timeout: 4000 });
  await expect(status).toHaveText("");

  // Icon-only: the label is its name; the result is announced the same way.
  const icon = buttons.nth(2);
  await expect(icon).toHaveAccessibleName("Copy link");
  await icon.click();
  await expect(icon).toHaveAccessibleName("Copied");

  const refused = buttons.last();
  await refused.scrollIntoViewIfNeeded();
  const width = (await refused.boundingBox())?.width;
  await refused.click();
  await expect(refused).toHaveAccessibleName("Couldn't copy");
  await expect(
    section.locator('[data-slot="copy-button-status"]').last(),
  ).toHaveText("Couldn't copy");
  expect((await refused.boundingBox())?.width).toBe(width);
});

test("notices and state panels: decorative icons, headings in the outline", async ({
  page,
}) => {
  await page.goto("/design-system");
  const notices = page.locator('#notices [data-slot="notice"]');
  await expect(notices).toHaveCount(5);
  await expect(page.locator('#notices [data-slot="notice-icon"]')).toHaveCount(
    5,
  );
  for (const icon of await page
    .locator('#notices [data-slot="notice-icon"]')
    .all())
    await expect(icon).toHaveAttribute("aria-hidden", "true");
  await expect(
    page.locator("#notices").getByRole("button", { name: "Try again" }),
  ).toBeVisible();
  const states = page.locator("#states");
  await expect(states.getByRole("heading", { level: 3 })).toHaveText([
    "No cards yet",
    "No connection",
    "The library is unavailable",
  ]);
});

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 360, height: 800 }],
] as const) {
  test(`${name}: the library loads without layout shift and its controls never move anything`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Layout-shift entries are a Chromium API.",
    );
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const shifts: { value: number; input: boolean }[] = [];
      Object.defineProperty(window, "shifts", { value: shifts });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[])
          shifts.push({ value: entry.value, input: entry.hadRecentInput });
      }).observe({ type: "layout-shift", buffered: true });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => {} },
      });
    });
    const shifts = () =>
      page.evaluate(
        () =>
          (window as unknown as { shifts: { value: number; input: boolean }[] })
            .shifts,
      );
    await page.goto("/design-system");
    await page.waitForLoadState("networkidle");
    const load = (await shifts())
      .filter((shift) => !shift.input)
      .reduce((sum, shift) => sum + shift.value, 0);
    expect(load).toBeLessThan(0.02);

    // Results in place: a copy, a chip, a segment, a progress step. Even
    // shifts right after input (which CLS forgives) must not happen.
    const before = (await shifts()).length;
    await page.locator('#copy [data-slot="copy-button"]').first().click();
    await expect(
      page.locator('#copy [data-slot="copy-button"]').first(),
    ).toHaveAttribute("data-state", "copied");
    await page
      .locator("#toggles")
      .getByRole("radio", { name: "Again later" })
      .click();
    await page.locator("#toggles").getByRole("radio", { name: "2×" }).click();
    await page.getByRole("radio", { name: "100%" }).click();
    await page.waitForTimeout(400);
    expect((await shifts()).slice(before)).toEqual([]);
  });
}
