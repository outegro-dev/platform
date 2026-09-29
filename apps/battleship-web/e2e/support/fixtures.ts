import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { type FakeGame, GameHarness } from "./fake-game.ts";
import type { Persona } from "./personas.ts";

// Same defaults and overrides as playwright.config.ts.
export const PLATFORM = `http://localhost:${process.env.E2E_PLATFORM_PORT ?? 4195}`;
export const APP = `http://localhost:${process.env.E2E_APP_PORT ?? 3195}`;
export const CHECKOUT = "https://checkout.fake.test";
/** PAY_URL and ADMIN_URL of the app under test: linked, never opened. */
export const PAY = "https://pay.fake.test";
export const ADMIN = "https://admin.fake.test";

type Fixtures = {
  game: GameHarness;
  consoleErrors: string[];
  /** Console errors a test causes on purpose (e.g. a 503 from the ticket endpoint). */
  allowConsoleErrors: (pattern: RegExp) => void;
};

/**
 * Every test: the game WebSocket goes to a scripted fake (contract-checked
 * both ways), console errors fail the test, and layout shifts are recorded
 * from the first paint (window.__cls).
 */
export const test = base.extend<Fixtures>({
  game: [
    async ({ page }, use) => {
      const harness = new GameHarness();
      await page.routeWebSocket(/\/ws\?ticket=/, (ws) => harness.connect(ws));
      await use(harness);
      harness.dispose();
      expect(
        harness.violations(),
        "client messages must follow the contract",
      ).toEqual([]);
    },
    { auto: true },
  ],
  allowConsoleErrors: async ({ consoleErrors }, use) => {
    await use((pattern) => {
      (consoleErrors as string[] & { allowed?: RegExp[] }).allowed ??= [];
      (consoleErrors as string[] & { allowed?: RegExp[] }).allowed?.push(
        pattern,
      );
    });
  },
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] & { allowed?: RegExp[] } = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (failure) => errors.push(failure.message));
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[]) {
            if (!entry.hadRecentInput) w.__cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await use(errors);
      const unexpected = errors.filter(
        (text) => !(errors.allowed ?? []).some((pattern) => pattern.test(text)),
      );
      expect(unexpected, "the page logged errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Signs in through the fake id.outegro.dev as a persona and lands on `returnTo`. */
export async function signIn(
  page: Page,
  persona: Persona = "free",
  returnTo = "/",
) {
  await page
    .context()
    .addCookies([
      { name: "e2e_persona", value: persona, domain: "localhost", path: "/" },
    ]);
  await page.goto(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  const path = returnTo.split("?")[0];
  await page.waitForURL((url) => url.pathname === path);
}

/** Signs in and waits until the game socket has a session. */
export async function signInAndConnect(
  page: Page,
  game: GameHarness,
  persona: Persona = "free",
  returnTo = "/",
): Promise<FakeGame> {
  await signIn(page, persona, returnTo);
  const current = await game.current();
  await expect(page.getByTestId("player-chip")).toHaveAttribute(
    "title",
    /Connected|Подключено/,
  );
  return current;
}

/** No serious or critical accessibility violations (WCAG 2.2 AA rules). */
export async function expectAccessible(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    serious.map(
      (violation) =>
        `${where}: ${violation.id} × ${violation.nodes.length} — ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    ),
  ).toEqual([]);
}

/** Cumulative layout shift since the page loaded (inputs excluded, as in CLS). */
export async function layoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __cls: number }).__cls ?? 0,
  );
}

/** Starts a bot game from the lobby and returns once placement shows. */
export async function startBotGame(page: Page, level = "Easy") {
  await page.getByRole("radio", { name: new RegExp(level) }).click();
  await page.getByTestId("start-bot").click();
  await expect(page.getByTestId("placement")).toBeVisible();
}

/** Random fleet, ready, and wait for the battle to start. */
export async function deployRandomFleet(page: Page) {
  await page.getByTestId("random-fleet").click();
  await page.getByTestId("ready").click();
  await expect(page.getByTestId("battle")).toBeVisible();
}

/** Clicks a cell of the enemy board and waits for the shot to land. */
export async function fireAt(page: Page, x: number, y: number) {
  const cell = page
    .getByTestId("target-board")
    .locator(`button[data-x="${x}"][data-y="${y}"]`);
  await expect(cell).not.toHaveAttribute("aria-disabled", "true");
  await cell.click();
  // The shot landed, or it was the last one and the result replaced the board.
  const landed = cell.and(
    page.locator(
      ':not([aria-label$=", unknown"]):not([aria-label$=", неизвестно"])',
    ),
  );
  await expect(page.getByTestId("result").or(landed).first()).toBeVisible();
}
