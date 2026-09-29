import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, signInAndConnect, test } from "./support/fixtures.ts";
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
    });
  }
}
