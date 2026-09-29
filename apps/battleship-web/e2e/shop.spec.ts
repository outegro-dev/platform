import type { Page } from "@playwright/test";
import {
  APP,
  CHECKOUT,
  expect,
  PLATFORM,
  signInAndConnect,
  test,
} from "./support/fixtures.ts";

/**
 * The provider's checkout page. Like payments, it sends the buyer back to
 * the return URL with ?orderId=…&result=success|cancel appended.
 */
async function fakeCheckout(page: Page) {
  await page.route(`${CHECKOUT}/**`, async (route) => {
    const url = new URL(route.request().url());
    const back = url.searchParams.get("return") ?? `${APP}/shop`;
    const order = url.searchParams.get("order") ?? "";
    const link = (result: string) =>
      `${back}?orderId=${order}&amp;result=${result}`;
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Checkout</title></head><body><main><h1>Fake checkout</h1><a href="${link("success")}">Pay</a> <a href="${link("cancel")}">Cancel</a></main></body></html>`,
    });
  });
}

test.describe("shop", () => {
  test("prices come from the catalog, in the visitor's currency", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free", "/shop");
    await expect(page.getByTestId("price-premium")).toHaveText("$0.59/ month");
    await expect(page.getByTestId("price-silver")).toHaveText("$0.59once");
    await page.getByTestId("currency-RUB").click();
    await expect(page.getByTestId("price-silver")).toContainText("50");
    await expect(page.getByTestId("price-silver")).toContainText("₽");
    await page.getByTestId("currency-EUR").click();
    await expect(page.getByTestId("price-silver")).toContainText("€0.52");
  });

  test("RU visitors see roubles first", async ({ page, game, context }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await signInAndConnect(page, game, "free", "/shop");
    await expect(page.getByTestId("price-premium")).toContainText("50 ₽");
    await expect(page.getByTestId("price-premium")).toContainText("/ месяц");
    await expect(page.getByTestId("currency-RUB")).toBeChecked();
  });

  test("buying the Silver Fleet: checkout, processing, then success when the grant arrives", async ({
    page,
    game,
  }) => {
    await fakeCheckout(page);
    const fake = await signInAndConnect(page, game, "free", "/shop");
    await expect(page.getByTestId("cosmetic-ships-silver")).toBeDisabled();

    await page.getByTestId("buy-silver").click();
    // The first answer has no payment page yet: the shop retries with the same key.
    await page.waitForURL(`${CHECKOUT}/**`);
    await page.getByRole("link", { name: "Pay" }).click();
    await page.waitForURL(/\/shop\?orderId=[0-9a-f-]{36}&result=success$/);
    const banner = page.getByTestId("shop-banner");
    await expect(banner).toContainText("Processing payment…");

    // The payment grant lands in the game (webhook) and the socket says so.
    const grant = await fetch(`${PLATFORM}/__test/users/${fake.uid}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "cosmetics.silver-fleet" }),
    });
    expect(grant.ok).toBe(true);
    await game.current();
    fake.playerUpdated({});
    await expect(banner).toContainText("Payment received");
    await expect(banner).toContainText("Silver Fleet is active.");
    await expect(page.getByTestId("owned-silver")).toHaveText("Owned");
    await expect(page.getByTestId("cosmetic-ships-silver")).toBeEnabled();
    // Back in the game after checkout: one click to play.
    await banner.getByRole("link", { name: "Play now" }).click();
    await expect(page).toHaveURL(`${APP}/`);
    await expect(page.getByTestId("start-bot")).toBeVisible();
  });

  test("a cancelled payment says so calmly and the product can be bought again", async ({
    page,
    game,
  }) => {
    await fakeCheckout(page);
    await signInAndConnect(page, game, "free", "/shop");
    await page.getByTestId("buy-premium").click();
    await page.waitForURL(`${CHECKOUT}/**`);
    await page.getByRole("link", { name: "Cancel" }).click();
    await page.waitForURL(/\/shop\?orderId=[0-9a-f-]{36}&result=cancel$/);
    const banner = page.getByTestId("shop-banner");
    await expect(banner).toContainText("Payment cancelled");
    await expect(
      banner.getByRole("link", { name: "Back to the game" }),
    ).toHaveAttribute("href", "/");
    await expect(page.getByTestId("buy-premium")).toBeEnabled();
  });

  test("equipping a cosmetic changes the board skin", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "silver", "/shop");
    const classic = page.getByTestId("cosmetic-ships-classic");
    const silver = page.getByTestId("cosmetic-ships-silver");
    await expect(silver).toBeChecked();
    await classic.click();
    await expect(classic).toBeChecked();
    await expect(silver).not.toBeChecked();
    await page.getByTestId("cosmetic-theme-day").click();
    await expect(page.getByTestId("cosmetic-theme-day")).toBeChecked();
  });

  test("Premium members see their subscription as active", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "premium", "/shop");
    // The renewal date comes from payments' subscription.
    await expect(page.getByTestId("owned-premium")).toHaveText(
      "Active · renews Oct 29, 2026",
    );
    await expect(page.getByTestId("buy-silver")).toBeVisible();
    // Premium unlocks every cosmetic while it lasts.
    await expect(page.getByTestId("cosmetic-theme-night-sea")).toBeEnabled();
  });

  test("signed-out visitors can look at the shop", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByTestId("product-premium")).toContainText(
      "Battleship Premium",
    );
    await expect(
      page.getByRole("link", { name: "Sign in to buy" }).first(),
    ).toHaveAttribute("href", "/auth/sign-in?returnTo=%2Fshop");
  });
});
