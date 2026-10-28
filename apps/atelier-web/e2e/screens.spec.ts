import type { Page } from "@playwright/test";
import {
  expect,
  expectAccessible,
  expectNoSideScroll,
  expectTouchTargets,
  resetMock,
  screenshot,
  settle,
  test,
  type ViewportName,
  viewports,
} from "./support";

/*
 * Every screen at a phone, a tablet and a desktop, in the light and the dark
 * tone: no axe violations, no sideways page scroll, 44 px targets on the
 * phone, and a screenshot of each for review.
 */

const pages = [
  { name: "board", path: "/", heading: "Board" },
  { name: "inbox", path: "/inbox", heading: "Inbox" },
  { name: "new", path: "/new", heading: "Add a vacancy" },
  { name: "pipeline", path: "/pipeline", heading: "Pipeline" },
  { name: "profile", path: "/profile", heading: "Profile" },
] as const;

/** On a phone the board shows one stage at a time: pick it first. */
async function showStage(page: Page, stage: RegExp) {
  const switcher = page.getByRole("navigation", { name: "Go to a stage" });
  if (await switcher.isVisible())
    await switcher.getByRole("button", { name: stage }).click();
}

async function check(page: Page, where: string, phone: boolean) {
  await settle(page);
  await expectAccessible(page, where);
  await expectNoSideScroll(page, where);
  if (phone) await expectTouchTargets(page, where);
}

for (const [size, viewport] of Object.entries(viewports) as [
  ViewportName,
  (typeof viewports)[ViewportName],
][]) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${size}, ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });
      const phone = size === "mobile";

      test.beforeEach(async ({ page }) => {
        await resetMock(page);
      });

      test("every page", async ({ page }) => {
        for (const screen of pages) {
          await page.goto(screen.path);
          await expect(
            page.getByRole("heading", { level: 1, name: screen.heading }),
          ).toBeVisible();
          if (scheme === "dark")
            await expect(page.locator("html")).toHaveAttribute(
              "data-tone",
              "dark",
            );
          await check(page, `${screen.name} ${size} ${scheme}`, phone);
          await screenshot(page, `${size}-${scheme}-${screen.name}`);
        }
      });

      test("an application: the panel and its own page", async ({ page }) => {
        await page.goto("/");
        await showStage(page, /^Ready/);
        const link = page.getByRole("link", {
          name: "Brightline Health",
          exact: true,
        });
        const href = await link.getAttribute("href");
        await link.click();
        const panel = page.getByRole("dialog", { name: "Brightline Health" });
        await expect(panel).toBeVisible();
        await expect(page).toHaveURL(/\/applications\//);
        await check(page, `panel ${size} ${scheme}`, phone);
        await screenshot(page, `${size}-${scheme}-panel-resume`, false);
        for (const tab of ["Fit", "Texts", "Pipeline"] as const) {
          await panel.getByRole("tab", { name: tab }).click();
          await check(page, `panel ${tab} ${size} ${scheme}`, phone);
          await screenshot(
            page,
            `${size}-${scheme}-panel-${tab.toLowerCase()}`,
            false,
          );
        }
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        await expect(page).toHaveURL(/\/$/);

        if (!href) throw new Error("no link to the application");
        await page.goto(href);
        await expect(
          page.getByRole("heading", { level: 1, name: "Brightline Health" }),
        ).toBeVisible();
        await check(page, `application page ${size} ${scheme}`, phone);
        await screenshot(page, `${size}-${scheme}-application`);
        await page.getByRole("tab", { name: "History" }).click();
        await check(page, `application history ${size} ${scheme}`, phone);
        await page.getByRole("tab", { name: "Contacts" }).click();
        await check(page, `application contacts ${size} ${scheme}`, phone);
      });

      test("an interview with contacts and history", async ({ page }) => {
        await page.goto("/");
        await showStage(page, /^Sent/);
        await page
          .getByRole("link", { name: "Corvid Security", exact: true })
          .click();
        const panel = page.getByRole("dialog", { name: "Corvid Security" });
        await expect(panel).toBeVisible();
        await panel.getByRole("tab", { name: "Contacts" }).click();
        await check(page, `contacts ${size} ${scheme}`, phone);
        await screenshot(page, `${size}-${scheme}-panel-contacts`, false);
        await panel.getByRole("tab", { name: "History" }).click();
        await check(page, `history ${size} ${scheme}`, phone);
        await screenshot(page, `${size}-${scheme}-panel-history`, false);
      });
    });
  }
}

test.describe("Russian", () => {
  test.use({ viewport: viewports.mobile });

  test("the board and the inbox in Russian", async ({ page, context }) => {
    await resetMock(page);
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Доска" }),
    ).toBeVisible();
    await check(page, "board ru", true);
    await screenshot(page, "mobile-light-board-ru");
    await page.goto("/inbox");
    await check(page, "inbox ru", true);
    await screenshot(page, "mobile-light-inbox-ru");
  });
});
