import type { Page } from "@playwright/test";
import {
  APP,
  expect,
  expectAccessible,
  FAKE,
  persona,
  preferRussian,
  test,
} from "./support";

/*
 * pay.outegro.dev among the other apps: the account menu, the app each
 * purchase belongs to, and the way back to the app the buyer came from
 * (only ever to a platform app).
 */

const BATTLESHIP = "https://battleship.fake.test";
const ADMIN = "https://admin.fake.test";

const menuButton = (page: Page) =>
  page.getByRole("button", {
    name: /(account and apps|аккаунт и приложения)$/i,
  });

const returnLink = (page: Page) => page.getByTestId("return-link");

test.describe("account menu", () => {
  test("names the buyer and links the account, the apps and sign-out", async ({
    page,
  }) => {
    await persona(page, {
      displayName: "Nick Lukashik",
      email: "nick@outegro.test",
    });
    await page.goto("/orders");
    const button = menuButton(page);
    await expect(button).toHaveAccessibleName(
      "Nick Lukashik, account and apps",
    );
    await expect(button).toContainText("Nick Lukashik");
    await button.click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("nick@outegro.test");
    const item = (name: string) =>
      menu.getByRole("menuitem", { name, exact: true });
    await expect(item("Profile")).toHaveAttribute("href", `${FAKE}/account`);
    await expect(item("Security")).toHaveAttribute(
      "href",
      `${FAKE}/account/security`,
    );
    await expect(item("Notifications")).toHaveAttribute(
      "href",
      `${FAKE}/account/notifications`,
    );
    // This app's own pages stay here; payments is the current app.
    await expect(item("Purchases & subscriptions")).toHaveAttribute(
      "href",
      "/orders",
    );
    await expect(item("Battleship, battleship.fake.test")).toHaveAttribute(
      "href",
      `${BATTLESHIP}/`,
    );
    await expect(item(`Account, ${new URL(FAKE).host}`)).toHaveAttribute(
      "href",
      `${FAKE}/account`,
    );
    await expect(
      item(`Payments, ${new URL(APP).host}, you are here`),
    ).toHaveAttribute("href", "/orders");
    await expect(
      menu.getByRole("menuitem", { name: /^Admin console/ }),
    ).toHaveCount(0);
    await expect(item("Portfolio, outegro.dev")).toHaveAttribute(
      "href",
      "https://outegro.dev/",
    );
    await expectAccessible(page, "account menu");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("a platform role adds the admin console; Russian follows the page", async ({
    page,
  }) => {
    await persona(page, {
      roles: ["billing_operator"],
      email: "ops@outegro.test",
    });
    await preferRussian(page);
    await page.goto("/subscriptions");
    const button = menuButton(page);
    await expect(button).toHaveAccessibleName(
      "ops@outegro.test, аккаунт и приложения",
    );
    await button.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Профиль" })).toBeFocused();
    await expect(
      menu.getByRole("menuitem", { name: "Админка, admin.fake.test" }),
    ).toHaveAttribute("href", `${ADMIN}/`);
    await expect(menu.getByRole("menuitem", { name: "Выйти" })).toBeVisible();
    await expectAccessible(page, "account menu (ru)");
  });

  test("still works when Identity cannot say who is signed in", async ({
    page,
  }) => {
    // Identity's /v1/me fails; the session and payments are fine.
    await persona(page, { identity: "down" });
    await page.goto("/orders");
    await expect(page.locator("article.order-row")).toHaveCount(4);
    const button = menuButton(page);
    await expect(button).toHaveAccessibleName("Account and apps");
    await button.click();
    await expect(
      page.getByRole("menuitem", { name: "Sign out", exact: true }),
    ).toBeVisible();
  });
});

test.describe("apps behind the purchases", () => {
  test("every purchase and subscription links the app it belongs to", async ({
    page,
  }) => {
    await persona(page);
    await page.goto("/orders");
    const rows = page.locator("article.order-row");
    await expect(rows).toHaveCount(4);
    for (const row of await rows.all()) {
      const app = row.getByRole("link", { name: "Open Battleship" });
      await expect(app).toHaveAttribute("href", `${BATTLESHIP}/`);
      await expect(app).toHaveText("Battleship");
    }
    // The link sits above the card's own link to the order.
    await rows.nth(0).getByRole("link", { name: "Open Battleship" }).hover();
    await expect(
      rows.nth(0).getByRole("link", { name: "Open Battleship" }),
    ).toBeVisible();

    await page.goto("/subscriptions");
    const cards = page.getByTestId("subscription-app-link");
    await expect(cards).toHaveCount(2);
    for (const link of await cards.all()) {
      await expect(link).toHaveAttribute("href", `${BATTLESHIP}/`);
      await expect(link).toHaveAccessibleName("Open Battleship");
    }
    await expectAccessible(page, "subscriptions with app links");
  });
});

test.describe("the way back to the app", () => {
  test("a buyer sent by Battleship finds the way back on every page", async ({
    page,
  }) => {
    await persona(page);
    const shop = `${BATTLESHIP}/shop`;
    await page.goto(`/subscriptions?return=${encodeURIComponent(shop)}`);
    await expect(returnLink(page)).toHaveText("Back to Battleship");
    await expect(returnLink(page)).toHaveAttribute("href", shop);
    // Remembered while the buyer looks around.
    await page.goto("/orders");
    await expect(returnLink(page)).toHaveAttribute("href", shop);
    const cookie = (await page.context().cookies(APP)).find(
      (c) => c.name === "og_return",
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    await expectAccessible(page, "purchases with a way back");

    await preferRussian(page);
    await page.reload();
    await expect(returnLink(page)).toHaveText("Вернуться в Морской бой");
  });

  test("the account and the admin console are ways back too", async ({
    page,
  }) => {
    await persona(page);
    await page.goto(`/orders?return=${encodeURIComponent(`${FAKE}/account`)}`);
    await expect(returnLink(page)).toHaveText("Back to your account");
    await page.goto(`/orders?return=${encodeURIComponent(`${ADMIN}/`)}`);
    await expect(returnLink(page)).toHaveText("Back to the admin console");
  });

  for (const hostile of [
    "https://evil.test/phish",
    "https://battleship.fake.test.evil.test/shop",
    "https://battleship.fake.test@evil.test/",
    "//evil.test/",
    "javascript:alert(document.cookie)",
    "/orders",
    APP,
  ]) {
    test(`ignores a return target it does not trust: ${hostile}`, async ({
      page,
    }) => {
      await persona(page);
      await page.goto(`/orders?return=${encodeURIComponent(hostile)}`);
      await expect(
        page.getByRole("heading", { name: "Your purchases." }),
      ).toBeVisible();
      await expect(returnLink(page)).toHaveCount(0);
      expect(
        (await page.context().cookies(APP)).some((c) => c.name === "og_return"),
      ).toBe(false);
    });
  }

  test("a hostile target never replaces a trusted one", async ({ page }) => {
    await persona(page);
    const shop = `${BATTLESHIP}/shop`;
    await page.goto(`/orders?return=${encodeURIComponent(shop)}`);
    await page.goto(
      `/subscriptions?return=${encodeURIComponent("https://evil.test/")}`,
    );
    await expect(returnLink(page)).toHaveAttribute("href", shop);
  });

  test("a tampered cookie is checked again and ignored", async ({ page }) => {
    await persona(page);
    await page
      .context()
      .addCookies([
        { name: "og_return", value: "https://evil.test/", url: APP },
      ]);
    await page.goto("/orders");
    await expect(
      page.getByRole("heading", { name: "Your purchases." }),
    ).toBeVisible();
    await expect(returnLink(page)).toHaveCount(0);
  });

  test("the way back survives signing in first", async ({ page }) => {
    await persona(page);
    const shop = `${BATTLESHIP}/shop`;
    // No session yet: SSO first, then the page with its ?return=.
    await page.goto(`/subscriptions?return=${encodeURIComponent(shop)}`);
    await expect(page).toHaveURL(
      `${APP}/subscriptions?return=${encodeURIComponent(shop)}`,
    );
    await expect(returnLink(page)).toHaveAttribute("href", shop);
  });
});
