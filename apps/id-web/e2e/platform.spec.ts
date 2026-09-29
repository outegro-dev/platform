import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signIn, uniqueEmail } from "./support";

/*
 * The account among the other outegro apps: the header's account menu and
 * the overview's "Your apps" and "Purchases & subscriptions". Sibling apps
 * are configured in playwright.config.ts and only linked to.
 */

const ID = "http://localhost:3002";
const PAY = "https://pay.fake.test";
const BATTLESHIP = "https://battleship.fake.test";
const ADMIN = "https://admin.fake.test";
const back = encodeURIComponent(`${ID}/account`);

const menuButton = (page: Page) =>
  page.getByRole("button", { name: /(and apps|и приложения)$/i });

/** No serious or critical axe violations (WCAG 2.1 A/AA). */
async function expectAccessible(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    `axe on ${where}`,
  ).toEqual([]);
}

// A client address of its own per test, as in account.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`,
  });
});

test("the account menu names the account and links its pages, payments and apps", async ({
  page,
}) => {
  await page.goto("/login");
  const email = await signIn(page);
  await expect(page).toHaveURL("/account");
  const button = menuButton(page);
  await expect(button).toHaveAccessibleName(`${email}, account and apps`);
  await button.click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText(email);
  const item = (name: string) =>
    menu.getByRole("menuitem", { name, exact: true });
  // This app's own pages stay relative; payments offers the way back here.
  await expect(item("Profile")).toHaveAttribute("href", "/account");
  await expect(item("Security")).toHaveAttribute("href", "/account/security");
  await expect(item("Notifications")).toHaveAttribute(
    "href",
    "/account/notifications",
  );
  await expect(item("Purchases & subscriptions")).toHaveAttribute(
    "href",
    `${PAY}/orders?return=${back}`,
  );
  await expect(item("Battleship, battleship.fake.test")).toHaveAttribute(
    "href",
    `${BATTLESHIP}/`,
  );
  await expect(item("Account, localhost:3002, you are here")).toHaveAttribute(
    "href",
    "/account",
  );
  await expect(item("Payments, pay.fake.test")).toHaveAttribute(
    "href",
    `${PAY}/orders?return=${back}`,
  );
  await expect(
    menu.getByRole("menuitem", { name: /^Admin console/ }),
  ).toHaveCount(0);
  await expectAccessible(page, "account menu");

  // Keyboard: arrows move, Escape closes and gives focus back.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("Profile")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("Security")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/account/security");
});

test("the overview leads to the apps and to purchases on payments", async ({
  page,
}) => {
  await page.goto("/login");
  await signIn(page);
  await expect(page).toHaveURL("/account");
  const apps = page.getByTestId("your-apps");
  await expect(apps.getByRole("heading", { name: "Your apps" })).toBeVisible();
  await expect(apps.getByRole("link", { name: /Battleship/ })).toHaveAttribute(
    "href",
    `${BATTLESHIP}/`,
  );
  await expect(apps.getByRole("link", { name: /Admin console/ })).toHaveCount(
    0,
  );
  const purchases = page.getByTestId("purchases");
  await expect(purchases).toContainText("pay.fake.test");
  await expect(
    purchases.getByRole("link", { name: "Your purchases" }),
  ).toHaveAttribute("href", `${PAY}/orders?return=${back}`);
  await expect(
    purchases.getByRole("link", { name: "Manage subscriptions" }),
  ).toHaveAttribute("href", `${PAY}/subscriptions?return=${back}`);
  await expectAccessible(page, "overview with apps");
});

test("a platform role adds the admin console to the menu and the apps", async ({
  page,
}) => {
  await page.goto("/login");
  const email = await signIn(page);
  await expect(page).toHaveURL("/account");
  await expect(page.getByTestId("your-apps")).toBeVisible();
  // The operator bootstrap command (ID-07) grants the owner role.
  execFileSync(
    process.execPath,
    ["dist/cli/grant-owner.js", "--email", email, "--reason", "e2e admin link"],
    { cwd: path.join(__dirname, "../../auth-backend"), stdio: "pipe" },
  );
  await page.reload();
  await expect(
    page.getByTestId("your-apps").getByRole("link", { name: /Admin console/ }),
  ).toHaveAttribute("href", `${ADMIN}/`);
  await menuButton(page).click();
  await expect(
    page.getByRole("menuitem", { name: "Admin console, admin.fake.test" }),
  ).toHaveAttribute("href", `${ADMIN}/`);
});

test("in Russian, and signing out from the menu", async ({ page, context }) => {
  await page.goto("/login");
  await signIn(page, uniqueEmail());
  await expect(page).toHaveURL("/account");
  await context.addCookies([{ name: "og_locale", value: "ru", url: ID }]);
  await page.reload();
  await expect(
    page.getByTestId("your-apps").getByRole("heading", {
      name: "Ваши приложения",
    }),
  ).toBeVisible();
  await menuButton(page).click();
  const menu = page.getByRole("menu");
  for (const name of ["Профиль", "Безопасность", "Уведомления"])
    await expect(
      menu.getByRole("menuitem", { name, exact: true }),
    ).toBeVisible();
  await expect(menu).toContainText("Один вход во все приложения outegro");
  await menu.getByRole("menuitem", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (await context.cookies(ID)).some((cookie) => cookie.name === "og_at"),
  ).toBe(false);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the header keeps the menu and it fits the screen", async ({ page }) => {
    await page.goto("/login");
    await signIn(page);
    await expect(page).toHaveURL("/account");
    await menuButton(page).click();
    const box = await page.getByRole("menu").boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});
