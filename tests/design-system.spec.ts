import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

/*
 * The kit specimen (/design-system) prints every @outegro/ui component in
 * the zine theme, loud and calm, and the landing's own magazine furniture;
 * these checks run the kit's level switch, tabs, toggle groups, progress,
 * copy buttons, notices and state panels, the coupon and the tear-offs in
 * real engines. The page is in English whatever the reader's language.
 */

const BASE = "http://localhost:3100";

// The specimen opens without the gates anyway; the session cookie keeps
// every run the same.
test.use({
  storageState: {
    cookies: [
      {
        name: "og_gate",
        value: "1",
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  },
});

async function useLocale(context: BrowserContext, locale: "en" | "ru") {
  await context.addCookies([{ name: "og_locale", value: locale, url: BASE }]);
}

/** Hydrated: the contrast list has measured every pair in this browser. */
async function hydrated(page: Page) {
  await expect(page.locator("#inks").getByText("…")).toHaveCount(0);
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
 * ::after (offset and margin measured from the padding box) when it reaches
 * further.
 */
function touchTarget(element: Locator) {
  return element.evaluate((el) => {
    // Measured straight: the loud level glues controls on crooked (and
    // turns them on hover); the target turns with the control.
    const html = el as HTMLElement;
    const inline = html.style.cssText;
    html.style.rotate = "none";
    html.style.translate = "none";
    html.style.scale = "none";
    html.style.transition = "none";
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
    const border = (side: string) =>
      Number.parseFloat(style.getPropertyValue(`border-${side}-width`));
    // an offset and a negative margin both push the ::after outwards
    const reach = (side: "top" | "right" | "bottom" | "left") =>
      after.display === "none" || after.position !== "absolute"
        ? 0
        : Math.max(
            0,
            -Number.parseFloat(after[side]) -
              Number.parseFloat(after.getPropertyValue(`margin-${side}`)) -
              border(side),
          );
    const top = box.top - reach("top");
    const bottom = box.bottom + reach("bottom");
    const left = box.left - reach("left");
    const right = box.right + reach("right");
    // The browser agrees: a point just inside the extension hits the control.
    const x = box.left + box.width / 2;
    const hits = (y: number) => el.contains(document.elementFromPoint(x, y));
    const target = {
      drawn: { width: box.width, height: box.height },
      width: right - left,
      height: bottom - top,
      hitsAbove: hits(top + 0.5),
      hitsBelow: hits(bottom - 0.5),
    };
    html.style.cssText = inline;
    return target;
  });
}

async function seriousViolations(page: Page) {
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return scan.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      targets: v.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
}

for (const locale of ["en", "ru"] as const) {
  test(`${locale} reader: the specimen stays in English, is noindex, passes axe at both levels and fits every phone`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design-system");
    await expect(page.locator("main")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Kit specimen",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await hydrated(page);
    expect(await seriousViolations(page), "loud").toEqual([]);
    await page
      .getByRole("radiogroup", { name: "Level" })
      .getByRole("radio", { name: "Calm" })
      .click();
    await expect(
      page.locator('#kit [data-theme="zine-calm"]').first(),
    ).toBeVisible();
    expect(await seriousViolations(page), "calm").toEqual([]);
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => cutOff(page), { message: `Cut off at ${width}` })
        .toEqual([]);
    }
  });
}

test("the contents lead to every spread", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design-system");
  const contents = page.getByRole("navigation", { name: "In this issue" });
  const links = contents.getByRole("link");
  await expect(links).toHaveCount(5);
  for (const link of await links.all()) {
    const href = (await link.getAttribute("href")) ?? "";
    await expect(page.locator(href)).toHaveCount(1);
  }
  await contents.getByRole("link", { name: /The kit, part by part/ }).click();
  await expect(page).toHaveURL(/#kit$/);
  await expect(page.locator("#kit-title")).toBeInViewport();
});

test("the level switch reprints the kit loud or calm", async ({ page }) => {
  await page.goto("/design-system");
  await hydrated(page);
  const level = page.getByRole("radiogroup", { name: "Level" });
  const kit = page.locator("#kit").locator("[data-theme]").first();
  await expect(kit).toHaveAttribute("data-theme", "zine");
  await level.getByRole("radio", { name: "Calm" }).click();
  await expect(level.getByRole("radio", { name: "Calm" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(kit).toHaveAttribute("data-theme", "zine-calm");
  await expect(page.locator("#kit code").first()).toHaveText(
    'data-theme="zine-calm"',
  );
  // From the keyboard, back to loud.
  await page.keyboard.press("ArrowLeft");
  await expect(level.getByRole("radio", { name: "Loud" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(kit).toHaveAttribute("data-theme", "zine");
});

/** The kit at the calm level, as the product apps print it. */
async function calmKit(page: Page) {
  await page.goto("/design-system");
  await hydrated(page);
  await page
    .getByRole("radiogroup", { name: "Level" })
    .getByRole("radio", { name: "Calm" })
    .click();
  await expect(
    page.locator("#kit").locator("[data-theme]").first(),
  ).toHaveAttribute("data-theme", "zine-calm");
}

// The theme's inks as computed colours.
const ink = "rgb(27, 25, 21)";
const paper = "rgb(239, 228, 198)";

test("calm buttons: lifted and pressed only with motion allowed; disabled is plain paper", async ({
  page,
}) => {
  await calmKit(page);
  const buttons = page.locator("#buttons");
  const button = buttons.getByRole("button", { name: "Book a call" }).nth(1);
  await button.scrollIntoViewIfNeeded();

  // Reduced motion: the shadow answers the pointer, the button keeps its place.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await button.hover();
  await expect(button).toHaveCSS("box-shadow", `${ink} 4px 4px 0px 0px`);
  await expect(button).toHaveCSS("translate", "none");
  await page.mouse.down();
  await expect(button).toHaveCSS("box-shadow", `${ink} 1px 1px 0px 0px`);
  await expect(button).toHaveCSS("translate", "none");
  await page.mouse.up();

  // Motion allowed: lifted under the pointer, pressed in on a click.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(0, 0);
  await button.hover();
  await expect(button).toHaveCSS("translate", "-1px -1px");
  await page.mouse.down();
  await expect(button).toHaveCSS("translate", "2px 2px");
  await page.mouse.up();

  // Disabled: a dashed edge on paper, legible words, no shadow, no fading.
  const disabled = buttons.getByRole("button", { name: "Disabled" });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS("border-top-style", "dashed");
  await expect(disabled).toHaveCSS("box-shadow", "none");
  await expect(disabled).toHaveCSS("opacity", "1");
  await expect(disabled).toHaveCSS("background-color", "rgb(227, 211, 168)");
  await expect(disabled).toHaveCSS("color", "rgb(75, 67, 52)");
});

test("calm focus ring and card shadow: on the kit's parts, redrawn from an app's layers", async ({
  page,
}) => {
  await calmKit(page);
  const ring = async (element: Locator, offset: string) => {
    await expect(element).toHaveCSS("outline-style", "solid");
    await expect(element).toHaveCSS("outline-width", "3px");
    await expect(element).toHaveCSS("outline-color", "rgb(35, 96, 181)");
    await expect(element).toHaveCSS("outline-offset", offset);
  };
  // The kit's field turns the browser ring off with a utility; calm draws it.
  const field = page.locator("#spec-email");
  await field.focus();
  await ring(field, "2px");

  // Anything else focusable takes the ring from the base layer, so a rule in
  // the app's components layer (no unlayered override) draws it inside.
  await page.locator("#fields").evaluate((section) => {
    const probe = document.createElement("input");
    probe.className = "probe-field";
    probe.setAttribute("aria-label", "Probe");
    section.append(probe);
  });
  const probe = page.locator(".probe-field");
  await probe.focus();
  await ring(probe, "2px");
  await page.addStyleTag({
    content:
      "@layer components { .probe-field:focus-visible { outline-offset: -3px } }",
  });
  await ring(probe, "-3px");

  // A pasted-in card: a 2 px frame and a hard shadow, in its tone's ink.
  const cards = page.locator('#surfaces [data-slot="surface"]');
  const card = cards.first();
  await expect(card).toHaveCSS("border-top-width", "2px");
  await expect(card).toHaveCSS("box-shadow", `${ink} 4px 4px 0px 0px`);
  await expect(cards.and(page.locator('[data-tone="dark"]'))).toHaveCSS(
    "box-shadow",
    "rgb(207, 53, 40) 4px 4px 0px 0px",
  );
  // The shadow is layered, the frame is not: an app's rule changes one.
  await page.addStyleTag({
    content: "@layer components { .probe-card { box-shadow: none } }",
  });
  await card.evaluate((el) => el.classList.add("probe-card"));
  await expect(card).toHaveCSS("box-shadow", "none");
  await expect(card).toHaveCSS("border-top-width", "2px");
});

test("native checkboxes and radios are inked: ink on paper, paper on ink", async ({
  page,
}) => {
  for (const level of ["Loud", "Calm"]) {
    await page.goto("/design-system");
    await hydrated(page);
    await page
      .getByRole("radiogroup", { name: "Level" })
      .getByRole("radio", { name: level })
      .click();
    const kit = page.locator("#kit").locator("[data-theme]").first();
    await expect(kit, level).toHaveCSS("accent-color", ink);
    await expect(
      page.locator('#surfaces [data-slot="surface"][data-tone="dark"]'),
      level,
    ).toHaveCSS("accent-color", paper);
  }
});

test("tabs: arrows select, the strip scrolls on a phone, manual mode waits for Enter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/design-system");
  await hydrated(page);
  const views = page.getByRole("tablist", { name: "Ways to read a chapter" });
  await views.getByRole("tab", { name: "Analogy" }).focus();
  await page.keyboard.press("ArrowRight");
  const code = views.getByRole("tab", { name: "Code" });
  await expect(code).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Code" })).toContainText(
    "setTimeout",
  );
  // A visible ring on the keyboard-focused tab (dashed in the zine theme).
  await expect(code).toHaveCSS("outline-style", /solid|dashed/);
  // End skips the disabled tab; the strip scrolls to it, the page does not.
  await page.keyboard.press("End");
  const interview = views.getByRole("tab", { name: "Interview" });
  await expect(interview).toHaveAttribute("aria-selected", "true");
  await expect(views.getByRole("tab", { name: "Deep dive" })).toBeDisabled();
  const overflows = await views.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  );
  if (overflows)
    await expect
      .poll(() => views.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
  const box = await interview.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  const sections = page.getByRole("tablist", { name: "Account sections" });
  await sections.getByRole("tab", { name: "Orders" }).focus();
  await page.keyboard.press("ArrowRight");
  const access = sections.getByRole("tab", { name: "Access" });
  await expect(access).toBeFocused();
  await expect(access).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(access).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Access" })).toContainText(
    "Battleship Pro",
  );
});

test("toggle groups: one choice stays chosen, the toolbar toggles, keyboard works", async ({
  page,
}) => {
  await page.goto("/design-system");
  await hydrated(page);
  const toggles = page.locator("#toggles");
  const modes = toggles.getByRole("radiogroup", { name: "One choice · chip" });
  const fresh = modes.getByRole("radio", { name: "New" });
  await fresh.click();
  await expect(fresh).toHaveAttribute("aria-checked", "true");
  await fresh.click(); // like a radio button, a second press keeps the choice
  await expect(fresh).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowRight");
  const again = modes.getByRole("radio", { name: "Again" });
  await expect(again).toBeFocused();
  await page.keyboard.press("Space");
  await expect(again).toHaveAttribute("aria-checked", "true");
  await expect(fresh).toHaveAttribute("aria-checked", "false");

  const topics = toggles.getByRole("toolbar", { name: "Several · small chip" });
  const memory = topics.getByRole("button", { name: "Memory" });
  await expect(memory).toHaveAttribute("aria-pressed", "false");
  await memory.click();
  await expect(memory).toHaveAttribute("aria-pressed", "true");
  await expect(topics.getByRole("button", { name: "Async" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(topics.getByRole("button", { name: "Archive" })).toBeDisabled();
});

test("compact buttons and toggles keep a 44 px touch target at their drawn size", async ({
  page,
}) => {
  await page.goto("/design-system");
  await hydrated(page);
  const controls = page.locator("#buttons, #toggles").locator(
    // Disabled and pending controls ignore the pointer on purpose.
    ':is([data-slot="button"], [data-slot="toggle-group-item"]):not(:disabled, [aria-disabled="true"], [data-pending])',
  );
  expect(await controls.count()).toBeGreaterThan(20);
  for (const control of await controls.all()) {
    await control.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    const target = await touchTarget(control);
    const name =
      (await control.getAttribute("aria-label")) ??
      (await control.textContent());
    expect(target.height, `height of ${name}`).toBeGreaterThanOrEqual(44);
    expect(target.width, `width of ${name}`).toBeGreaterThanOrEqual(44);
    expect(target.hitsAbove && target.hitsBelow, `hit test of ${name}`).toBe(
      true,
    );
  }
  // The small button is still drawn 40 px tall.
  const small = page
    .locator("#buttons")
    .getByRole("button", { name: "Small", exact: true });
  expect((await touchTarget(small)).drawn.height).toBe(40);
});

test("progress: clamped values, spoken text, a fill that only moves", async ({
  page,
}) => {
  await page.goto("/design-system");
  await hydrated(page);
  const finished = page.getByRole("progressbar", { name: "Course finished" });
  await expect(finished).toHaveAttribute("aria-valuenow", "100");
  await expect(finished).toHaveAttribute("aria-valuemax", "100");
  const exercises = page.getByRole("progressbar", { name: "Exercises" });
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
  await hydrated(page);
  const section = page.locator("#loading");
  const buttons = section.locator('[data-slot="copy-button"]');
  await expect(buttons).toHaveCount(4);
  const command = buttons.first();
  const status = section.locator('[data-slot="copy-button-status"]').first();
  await expect(command).toHaveAccessibleName("Copy");
  await command.scrollIntoViewIfNeeded();
  // Layout size: the loud level tilts a control on hover, which is no resize.
  const size = (button: Locator) =>
    button.evaluate((el) => [
      (el as HTMLElement).offsetWidth,
      (el as HTMLElement).offsetHeight,
    ]);
  const before = await size(command);

  await command.click();
  await expect(command).toHaveAccessibleName("Copied");
  await expect(status).toHaveText("Copied");
  expect(
    await page.evaluate(
      () => (window as unknown as { copied: string[] }).copied,
    ),
  ).toEqual(["pnpm --filter @outegro/ui test"]);
  expect(await size(command)).toEqual(before);
  await expect(command).toHaveAccessibleName("Copy", { timeout: 4000 });
  await expect(status).toHaveText("");

  // Icon-only: the label is its name; the result is announced the same way.
  const icon = buttons.nth(2);
  await expect(icon).toHaveAccessibleName("Copy link");
  await icon.click();
  await expect(icon).toHaveAccessibleName("Copied");
  expect(
    await page.evaluate(
      () => (window as unknown as { copied: string[] }).copied,
    ),
  ).toContain("https://outegro.dev/design-system");

  const refused = buttons.last();
  await refused.scrollIntoViewIfNeeded();
  const width = await size(refused);
  await refused.click();
  await expect(refused).toHaveAccessibleName("Couldn't copy");
  await expect(
    section.locator('[data-slot="copy-button-status"]').last(),
  ).toHaveText("Couldn't copy");
  expect(await size(refused)).toEqual(width);
});

test("notices and state panels: decorative icons, headings in the outline", async ({
  page,
}) => {
  await page.goto("/design-system");
  const notices = page.locator('#notices [data-slot="notice"]');
  await expect(notices).toHaveCount(5);
  const icons = page.locator('#notices [data-slot="notice-icon"]');
  await expect(icons).toHaveCount(5);
  for (const icon of await icons.all())
    await expect(icon).toHaveAttribute("aria-hidden", "true");
  await expect(
    page
      .locator('#notices [data-slot="notice"]')
      .getByRole("button", { name: "Try again" }),
  ).toBeVisible();
  await expect(
    page.locator("#notices").getByRole("heading", { level: 4 }),
  ).toHaveText(["No games yet", "You are offline", "The board failed to load"]);
});

test("the magazine furniture: the coupon cuts out, the tear-offs stay paper", async ({
  page,
}) => {
  await page.goto("/design-system");
  await hydrated(page);
  const furniture = page.locator("#furniture");
  const tearOffs = furniture.locator(".tear-offs");
  await expect(tearOffs).toHaveCount(3);
  for (const fringe of await tearOffs.all())
    await expect(fringe).toHaveAttribute("aria-hidden", "true");
  for (const tab of await furniture.locator(".tear-offs a").all())
    await expect(tab).toHaveAttribute("tabindex", "-1");
  await expect(furniture.locator(".receipt-lines > li")).toHaveCount(3);
  await expect(furniture.locator(".price-tags > li")).toHaveCount(3);

  const cut = furniture.getByRole("button", { name: "Cut it out" });
  await cut.scrollIntoViewIfNeeded();
  await cut.click();
  await expect(cut).toBeDisabled();
  await expect(furniture.getByRole("status")).toHaveText(
    "Cut! Now it is yours.",
  );
  await expect(furniture.locator(".coupon-wrap")).toHaveAttribute(
    "data-state",
    "cut",
  );
});

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 360, height: 800 }],
] as const) {
  test(`${name}: the specimen's controls never move anything`, async ({
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
    await hydrated(page);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");

    // Results in place: a copy, a chip, a segment, a progress step, a level.
    // Even shifts right after input (which CLS forgives) must not happen.
    const before = (await shifts()).length;
    await page.locator('#loading [data-slot="copy-button"]').first().click();
    await expect(
      page.locator('#loading [data-slot="copy-button"]').first(),
    ).toHaveAttribute("data-state", "copied");
    await page
      .locator("#toggles")
      .getByRole("radio", { name: "Again" })
      .click();
    await page.locator("#toggles").getByRole("radio", { name: "2×" }).click();
    await page.getByRole("radio", { name: "100%" }).click();
    await expect(
      page.getByRole("progressbar", { name: "Chapter read" }),
    ).toHaveAttribute("aria-valuenow", "100");
    await page.waitForTimeout(400);
    expect((await shifts()).slice(before)).toEqual([]);
  });
}
