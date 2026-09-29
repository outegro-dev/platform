import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  test as base,
  devices,
  expect,
  type Page,
} from "@playwright/test";

export type Persona = "owner" | "support" | "billing" | "auditor" | "nobody";

/** A phone: 390 px wide, touch, retina screenshots. */
export const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

/**
 * The console forwards the browser's User-Agent to every service; the fake
 * platform reads failure switches from it ("fake-fail=notifications" answers
 * 503, "fake-down=payments" drops the connection).
 */
export const withFailure = (switches: string) =>
  `${devices["Desktop Chrome"].userAgent} ${switches}`;

const names: Record<Persona, string> = {
  owner: "Nick Lukashik",
  support: "Sam Carter",
  billing: "Bea Novak",
  auditor: "Ada Rossi",
  nobody: "Noah Fields",
};

export const SCREENSHOTS = path.join(__dirname, "screenshots");
mkdirSync(SCREENSHOTS, { recursive: true });

/**
 * Every test: the operator's time zone cookie is preset (no re-render on
 * first load), and console errors and page errors fail the test. (No init
 * script: it would also run in the sandboxed email preview and log there.)
 */
export const test = base.extend<{
  consoleErrors: string[];
  /** Console errors a scenario expects (a 404 page logs its own status). */
  allowedConsoleErrors: RegExp[];
}>({
  allowedConsoleErrors: [[], { option: true }],
  consoleErrors: [
    async ({ page, context, baseURL, allowedConsoleErrors }, use) => {
      await context.addCookies([
        {
          name: "og_tz",
          value: "Europe/Moscow",
          url: baseURL ?? "http://localhost:3196",
        },
      ]);
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        // Playwright's own per-frame scripts are refused by the sandboxed email
        // preview (a plain page with a script-free sandboxed iframe logs the
        // same line); the console itself never runs scripts there.
        if (
          message
            .text()
            .startsWith("Blocked script execution in 'about:srcdoc'")
        )
          return;
        if (
          allowedConsoleErrors.some((pattern) => pattern.test(message.text()))
        )
          return;
        errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** Sign in through the fake identity frontend and land on `path`. */
export async function signIn(
  page: Page,
  persona: Persona = "owner",
  target = "/",
) {
  await page.goto(target);
  await page.waitForURL(/localhost:4196\/authorize/);
  await page.getByRole("link", { name: new RegExp(names[persona]) }).click();
  await page.waitForURL((url) => url.origin === "http://localhost:3196");
  await settle(page);
}

/** Wait until every streamed panel replaced its skeleton. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

export async function visit(page: Page, target: string) {
  await page.goto(target);
  await settle(page);
}

/** A tab of the user card (the sidebar has links with the same names). */
export async function openUserTab(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "User sections" })
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();
  await settle(page);
}

/** Open the first row of the (first) table on the page. */
export async function openFirstRow(page: Page) {
  await page.locator("table .row-link").first().click();
  await page.waitForLoadState("networkidle");
  await settle(page);
}

export async function useRussian(context: BrowserContext) {
  await context.addCookies([
    { name: "og_locale", value: "ru", url: "http://localhost:3196" },
  ]);
}

/**
 * Waits for finite animations and transitions (a dialog's fade and zoom,
 * the navigation sheet, a toast, a focus ring) to end, so contrast is
 * measured on the final colours. Endless ones (skeleton shimmer, spinners,
 * pulses) never end and are not waited for.
 */
export async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );
}

/** No serious or critical accessibility violations on the current screen. */
export async function expectAccessible(page: Page) {
  // Mid-fade, a dialog reads as low contrast (the flaky suspend dialog).
  await settleAnimations(page);
  // The email preview is a sandboxed document without scripts: axe cannot
  // run inside it (and its markup is the email's, not the console's).
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".preview-frame")
    .analyze();
  const blocking = results.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    )
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    }));
  expect(blocking, "axe serious/critical violations").toEqual([]);
}

/**
 * Cumulative layout shift of the current document so far, from the buffered
 * layout-shift entries (shifts right after input do not count).
 */
export async function expectStable(page: Page, max = 0.02) {
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[]) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(total);
        }, 150);
      }),
  );
  expect(cls, "cumulative layout shift").toBeLessThanOrEqual(max);
}

/** The page never scrolls sideways (wide tables scroll inside their frame). */
export async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal page overflow in px").toBeLessThanOrEqual(0);
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}
