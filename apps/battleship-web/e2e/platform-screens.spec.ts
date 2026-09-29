import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  expect,
  PLATFORM,
  signInAndConnect,
  test,
} from "./support/fixtures.ts";
import type { Persona } from "./support/personas.ts";

/**
 * Screenshots of the ways into the rest of the platform — the account menu,
 * what the player owns in the shop and profile, the way back after checkout —
 * at 1440 and 390 px, in English and Russian: e2e/screenshots/platform-*.png.
 */
const dir = path.join(__dirname, "screenshots");
mkdirSync(dir, { recursive: true });

async function capture(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(dir, `platform-${name}.png`),
    fullPage,
    animations: "disabled",
  });
}

const layouts = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
] as const;

for (const layout of layouts) {
  for (const locale of ["en", "ru"] as const) {
    test.describe(`${layout.name} ${locale}`, () => {
      test.use({ viewport: layout.viewport });

      test.beforeEach(async ({ context }) => {
        await context.addCookies([
          { name: "og_locale", value: locale, domain: "localhost", path: "/" },
        ]);
      });

      const shot = (name: string) => `${name}--${layout.name}-${locale}`;

      test("account menu", async ({ page, game }) => {
        const persona: Persona = locale === "en" ? "operator" : "free";
        await signInAndConnect(page, game, persona);
        await capture(page, shot("header"));
        await page
          .getByRole("button", {
            name: /(account and apps|аккаунт и приложения)$/,
          })
          .click();
        await expect(page.getByRole("menu")).toBeVisible();
        await page.waitForTimeout(300);
        await capture(page, shot("account-menu"));
      });

      test("shop and profile of a Premium player", async ({ page, game }) => {
        await signInAndConnect(page, game, "premium", "/shop");
        await expect(page.getByTestId("manage-subscription")).toBeVisible();
        await page.getByTestId("product-premium").scrollIntoViewIfNeeded();
        await capture(page, shot("shop-premium"));
        await page.getByTestId("payments-note").scrollIntoViewIfNeeded();
        await capture(page, shot("shop-note"));
        await page.goto("/profile");
        await expect(page.getByTestId("purchases-card")).toBeVisible();
        await page.getByTestId("purchases-card").scrollIntoViewIfNeeded();
        await capture(page, shot("profile-purchases"));
      });

      test("back from checkout", async ({ page, game }) => {
        const fake = await signInAndConnect(page, game, "free", "/shop");
        // What the shop remembers while the buyer is on the provider's page.
        await page.evaluate(() =>
          sessionStorage.setItem(
            "bs:pending-purchase",
            JSON.stringify({
              productKey: "battleship-silver-fleet",
              feature: "cosmetics.silver-fleet",
            }),
          ),
        );
        await page.goto(
          "/shop?orderId=5e0c0de0-0000-4000-8000-00000000abcd&result=success",
        );
        const banner = page.getByTestId("shop-banner");
        await expect(banner.getByTestId("back-to-game")).toBeVisible();
        await capture(page, shot("checkout-processing"));
        await fetch(`${PLATFORM}/__test/users/${fake.uid}/grant`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ feature: "cosmetics.silver-fleet" }),
        });
        (await game.current()).playerUpdated({});
        await expect(banner).toHaveAttribute("data-tone", "success");
        await page.waitForTimeout(300);
        await capture(page, shot("checkout-success"));
      });
    });
  }
}
