import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { FakeGame } from "./support/fake-game.ts";
import {
  deployRandomFleet,
  expect,
  fireAt,
  signInAndConnect,
  startBotGame,
  test,
} from "./support/fixtures.ts";

/**
 * Screenshots of every screen (desktop and mobile, EN, plus RU) for review:
 * e2e/screenshots/*.png. Animations are settled before each capture.
 */
const dir = path.join(__dirname, "screenshots");
mkdirSync(dir, { recursive: true });

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

/** A few shots so the boards show misses, hits and a sunk ship. */
async function playSomeShots(page: Page, game: FakeGame) {
  const single = game.opponentFleet.find((ship) => ship.length === 1);
  const big = game.opponentFleet.find((ship) => ship.length === 4);
  if (single) await fireAt(page, single.x, single.y);
  if (big) await fireAt(page, big.x, big.y);
  game.script.botShots = [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
  ];
  const water = game.emptyCell();
  await fireAt(page, water.x, water.y);
  await expect(page.getByTestId("turn-indicator")).toHaveAttribute(
    "data-turn",
    "you",
    {
      timeout: 15_000,
    },
  );
}

const layouts = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 } },
] as const;

for (const layout of layouts) {
  test.describe(`screens ${layout.name}`, () => {
    test.use({ viewport: layout.viewport });

    test("guest home and leaderboard", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("sign-in-cta")).toBeVisible();
      await capture(page, `${layout.name}-home-guest`);
      await page.goto("/leaderboard");
      await expect(page.getByTestId("leaderboard-table")).toBeVisible();
      await capture(page, `${layout.name}-leaderboard-guest`);
    });

    test("lobby, placement, battle and result", async ({ page, game }) => {
      const fake = await signInAndConnect(page, game, "free");
      await capture(page, `${layout.name}-lobby`);
      await startBotGame(page);
      await page.getByTestId("fleet-tray").getByRole("button").first().click();
      await capture(page, `${layout.name}-placement`);
      await deployRandomFleet(page);
      await playSomeShots(page, fake);
      await capture(page, `${layout.name}-battle`);
      for (const cell of fake.enemyCells()) {
        const button = page
          .getByTestId("target-board")
          .locator(`button[data-x="${cell.x}"][data-y="${cell.y}"]`);
        if ((await button.getAttribute("aria-label"))?.includes("unknown")) {
          await fireAt(page, cell.x, cell.y);
        }
      }
      await expect(page.getByTestId("result")).toBeVisible();
      await page.waitForTimeout(1600);
      await capture(page, `${layout.name}-result`);
    });

    test("profile, shop and room", async ({ page, game }) => {
      await signInAndConnect(page, game, "premium", "/profile");
      await expect(page.getByTestId("stat-cards")).toBeVisible();
      await capture(page, `${layout.name}-profile-premium`);
      await page.goto("/shop");
      await expect(page.getByTestId("product-silver")).toBeVisible();
      await capture(page, `${layout.name}-shop-premium`);
      await page.goto("/");
      await page.getByTestId("create-room").click();
      await expect(page.getByTestId("room-host")).toBeVisible();
      await capture(page, `${layout.name}-room`);
    });

    test("free player's profile and shop", async ({ page, game }) => {
      await signInAndConnect(page, game, "free", "/profile");
      await expect(page.getByTestId("heatmap-locked")).toBeVisible();
      await capture(page, `${layout.name}-profile-free`);
      await page.goto("/shop");
      await expect(page.getByTestId("buy-silver")).toBeVisible();
      await capture(page, `${layout.name}-shop-free`);
    });
  });
}

test.describe("screens ru", () => {
  test("lobby and battle in Russian", async ({ page, game, context }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    const fake = await signInAndConnect(page, game, "silver");
    await capture(page, "ru-lobby");
    await startBotGame(page, "Лёгкий");
    await deployRandomFleet(page);
    await playSomeShots(page, fake);
    await capture(page, "ru-battle-night-sea");
    await page.goto("/shop");
    await capture(page, "ru-shop");
  });
});
