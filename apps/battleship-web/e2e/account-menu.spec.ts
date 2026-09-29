import type { Page } from "@playwright/test";
import {
  ADMIN,
  APP,
  expect,
  expectAccessible,
  PAY,
  PLATFORM,
  signInAndConnect,
  test,
} from "./support/fixtures.ts";

/** The account menu button, named "<who>, account and apps". */
const menuButton = (page: Page) =>
  page.getByRole("button", {
    name: /(account and apps|аккаунт и приложения)$/,
  });

const back = encodeURIComponent(APP);

test.describe("account menu", () => {
  test("signed-out visitors get a clear Sign in instead", async ({ page }) => {
    await page.goto("/shop");
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Sign in", exact: true }),
    ).toHaveAttribute("href", "/auth/sign-in?returnTo=%2F");
    await expect(menuButton(page)).toHaveCount(0);
  });

  test("shows who is signed in and links the account, payments and apps", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free");
    const button = menuButton(page);
    await expect(button).toHaveAccessibleName(
      "Nick Lukashik, account and apps",
    );
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toContainText("NL");
    await button.click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("Nick Lukashik");
    await expect(menu).toContainText("free@outegro.test");
    await expect(menu).toContainText("One sign-in for every outegro app");

    const item = (name: string | RegExp) =>
      menu.getByRole("menuitem", { name });
    await expect(item("Profile")).toHaveAttribute(
      "href",
      `${PLATFORM}/account`,
    );
    await expect(item("Security")).toHaveAttribute(
      "href",
      `${PLATFORM}/account/security`,
    );
    await expect(item("Notifications")).toHaveAttribute(
      "href",
      `${PLATFORM}/account/notifications`,
    );
    await expect(item("Purchases & subscriptions")).toHaveAttribute(
      "href",
      `${PAY}/orders?return=${back}`,
    );
    // Apps: the game is marked as the current one, no admin console.
    await expect(
      item(`Battleship, ${new URL(APP).host}, you are here`),
    ).toHaveAttribute("href", "/");
    await expect(item(`Account, ${new URL(PLATFORM).host}`)).toHaveAttribute(
      "href",
      `${PLATFORM}/account`,
    );
    await expect(item(/^Payments, pay\.fake\.test$/)).toHaveAttribute(
      "href",
      `${PAY}/orders?return=${back}`,
    );
    await expect(item(/^Admin console/)).toHaveCount(0);
    await expect(item(/^Portfolio/)).toHaveAttribute(
      "href",
      `${PLATFORM}/site/`,
    );
    await expectAccessible(page, "account menu");
  });

  test("works from the keyboard and gives focus back", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free");
    const button = menuButton(page);
    await button.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitem", { name: "Profile" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      menu.getByRole("menuitem", { name: "Security" }),
    ).toBeFocused();
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitem", { name: "Sign out" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("a platform role adds the admin console", async ({ page, game }) => {
    await signInAndConnect(page, game, "operator");
    await menuButton(page).click();
    await expect(
      page.getByRole("menuitem", {
        name: /^Admin console, admin\.fake\.test$/,
      }),
    ).toHaveAttribute("href", `${ADMIN}/`);
  });

  test("speaks Russian and names an account without a name by its email", async ({
    page,
    game,
    context,
  }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await signInAndConnect(page, game, "premium");
    const button = menuButton(page);
    await expect(button).toHaveAccessibleName(
      "premium@outegro.test, аккаунт и приложения",
    );
    await button.click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("Один вход во все приложения outegro");
    for (const name of ["Профиль", "Безопасность", "Уведомления"])
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: /^Морской бой, .*, вы здесь$/ }),
    ).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Выйти" })).toBeVisible();
    await expectAccessible(page, "account menu (ru)");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the menu fits the screen and signs out", async ({ page, game }) => {
      await signInAndConnect(page, game, "free");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await menuButton(page).click();
      const box = await page.getByRole("menu").boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(page.getByTestId("sign-in-cta")).toBeVisible();
      await expect(menuButton(page)).toHaveCount(0);
    });
  });
});
