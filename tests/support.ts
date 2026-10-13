import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import en from "../apps/landing-web/src/messages/en.json";
import ru from "../apps/landing-web/src/messages/ru.json";

/*
 * What the landing's suites share: the site's own messages, a page opened
 * as a returning reader in a chosen language, and the checks every page
 * gets (console, axe, overflow).
 */

export const messages = { en, ru } as const;
export type Locale = keyof typeof messages;
export const locales = ["en", "ru"] as const;

/** The cookies of a returning reader: past the gates, in this language. */
export function readerCookies(
  baseURL: string | undefined,
  lang: Locale | null,
  { gate = false } = {},
) {
  if (!baseURL) throw new Error("No baseURL: see playwright.config.ts");
  return [
    ...(gate ? [] : [{ name: "og_gate", value: "1", url: baseURL }]),
    ...(lang ? [{ name: "og_locale", value: lang, url: baseURL }] : []),
  ];
}

/**
 * Every test opens the site past the gates (they play on every page load
 * until skipped) and in the language of `lang`; null leaves the language
 * to the site, `gate` lets the gates play.
 */
export const test = base.extend<{ lang: Locale | null; gate: boolean }>({
  lang: ["en", { option: true }],
  gate: [false, { option: true }],
  context: async ({ context, baseURL, lang, gate }, use) => {
    await context.addCookies(readerCookies(baseURL, lang, { gate }));
    await use(context);
  },
});

export { expect };

/** Hydrated: the reveal observer (on / and /stack) marks the root. */
export async function hydrated(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-reveal-ready");
}

/**
 * Collects what the page complains about from here on: console errors,
 * uncaught exceptions and every CSP violation (reported by the browser as
 * an event, whether or not it also logs it).
 */
export async function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, "cspViolations", { value: seen });
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
  });
  return {
    errors,
    csp: () =>
      page.evaluate(
        () => (window as unknown as { cspViolations: string[] }).cspViolations,
      ),
  };
}

/** Two frames: whatever reacts to a scroll or a resize has laid out. */
export async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

/**
 * Reads the whole page down to the footer, a screen at a time, each step
 * given two frames for the scroll stages to place themselves.
 */
export async function scrollThrough(page: Page) {
  const until = Date.now() + 45_000;
  for (;;) {
    const end = await page.evaluate(() => {
      window.scrollBy({ top: innerHeight * 0.6, behavior: "instant" });
      return scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    });
    if (end) return;
    if (Date.now() > until) throw new Error("The scroll never reached the end");
    await settle(page);
  }
}

/**
 * Reads the page down and goes back to the top: every entrance has played
 * and every lazy part has come in, so a scan sees the whole page (until
 * then what lies below the fold waits faded out, and axe skips it).
 */
export async function readAndReturn(page: Page) {
  await scrollThrough(page);
  // the cat's paw pushes the coupon home on timers of its own
  await expect(
    page.locator('[data-paw]:not([data-paw="idle"], [data-paw="done"])'),
  ).toHaveCount(0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await settle(page);
}

/** Instantly, so the element sits still in the middle of the viewport. */
export async function centre(locator: Locator) {
  await locator.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
}

/** How far the page reaches past the right edge of the viewport, in px. */
export function overflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

/**
 * Waits out every entrance and transition under way (loops never end and
 * are left alone), so what is measured is what the reader ends up seeing.
 * Each gets until its scheduled end at most: a scroll-driven one only ends
 * with the scroll.
 */
export async function still(page: Page) {
  await settle(page);
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (a) =>
            a.playState === "running" &&
            a.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((a) => {
          const timing = a.effect?.getComputedTiming();
          const left =
            (Number(timing?.endTime) - Number(timing?.localTime ?? 0)) /
            Math.abs(a.playbackRate || 1);
          return Promise.race([
            a.finished.catch(() => undefined),
            new Promise((done) =>
              setTimeout(done, Number.isFinite(left) ? left + 100 : 0),
            ),
          ]);
        }),
    );
  });
}

/**
 * Serious and critical axe findings against WCAG 2.2 AA, once still: on
 * the whole page, or only in what `within` selects.
 */
export async function seriousViolations(page: Page, within?: string) {
  await still(page);
  const axe = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "wcag22aa",
  ]);
  const scan = await (within ? axe.include(within) : axe).analyze();
  return scan.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      targets: v.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
}

/**
 * Contrast failures axe finds once the paper's grain is lifted. The grain
 * is a picture under every word, and axe measures no text on a picture:
 * left on, it leaves most of the issue and all of /privacy unmeasured.
 * Under it lies the paper's own colour, a shade lighter than the grained
 * one, and the tinted strips (light words on red) only get darker with
 * it. `unmeasured` lists the words still on a background picture: a new
 * texture to lift here.
 */
export async function contrastOnPaper(page: Page) {
  await still(page);
  await page.addStyleTag({
    content:
      "*, ::before, ::after { --grain: none !important; --dots: none !important; --vintage-grain: none !important; }",
  });
  const scan = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    // the desktop's shortcuts are named in white on its wallpaper photo,
    // shadowed as on XP; axe misses the photo and measures the paper
    .exclude(".desktop-icons")
    .analyze();
  const nodes = (results: typeof scan.violations) =>
    results.flatMap((result) => result.nodes);
  return {
    failing: nodes(scan.violations).map(
      (node) =>
        `${node.target.join(" ")}: ${node.any[0]?.data?.contrastRatio}:1`,
    ),
    unmeasured: nodes(scan.incomplete)
      .filter((node) =>
        node.any.some((check) => check.data?.messageKey === "bgImage"),
      )
      .map((node) => node.target.join(" ")),
  };
}

/**
 * A RegExp that matches the text as it is, but for its spaces: an
 * accessible name reads a no-break space (as in "No. 1") as a plain one.
 */
export const literally = (text: string) =>
  new RegExp(
    text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
  );

export async function hrefs(locator: Locator) {
  return locator.evaluateAll((els) => els.map((a) => a.getAttribute("href")));
}

export async function expectNewTab(link: Locator) {
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
}
