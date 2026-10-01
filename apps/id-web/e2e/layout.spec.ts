import { randomInt } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./support";

/*
 * With classic scrollbars (Windows), a page that fits the screen and one
 * that does not have different widths. Headless Chromium hides scrollbars,
 * so this file shows them; the window is wider than the page container, so
 * a scrollbar that comes and goes would move the centred layout.
 */
test.use({
  viewport: { width: 1720, height: 1000 },
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`,
  });
});

const place = (page: Page) =>
  page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    nav: document.querySelector(".account-nav")?.getBoundingClientRect().x,
  }));

test("the menu stays put between a short page and a long one", async ({
  page,
}) => {
  await page.goto("/login?continue=%2Faccount%2Fsessions");
  await signIn(page);
  await expect(page).toHaveURL("/account/sessions");
  const short = await place(page);

  await page.getByRole("link", { name: "Profile" }).first().click();
  await expect(page.getByTestId("your-apps")).toBeVisible();
  // The profile with its four panels is taller than this window.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeGreaterThan(1000);
  expect(await place(page)).toEqual(short);
});
