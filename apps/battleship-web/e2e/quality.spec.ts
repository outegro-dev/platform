import type { Page } from "@playwright/test";
import {
  APP,
  deployRandomFleet,
  expect,
  expectAccessible,
  fireAt,
  layoutShift,
  PLATFORM,
  signIn,
  signInAndConnect,
  startBotGame,
  test,
} from "./support/fixtures.ts";

/** Lets the page settle (fonts, first data, socket) before measuring. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
}

test.describe("accessibility (axe, WCAG 2.2 AA: no serious or critical issues)", () => {
  test("public screens", async ({ page, allowConsoleErrors }) => {
    allowConsoleErrors(/status of 404/);
    for (const path of [
      "/",
      "/leaderboard",
      "/shop",
      "/auth/error?reason=unavailable",
      "/no-such-page",
    ]) {
      await page.goto(path);
      await expectAccessible(page, path);
    }
  });

  test("lobby, placement, battle and result", async ({ page, game }) => {
    const fake = await signInAndConnect(page, game, "free");
    await expectAccessible(page, "lobby");
    await startBotGame(page);
    await expectAccessible(page, "placement");
    await deployRandomFleet(page);
    const target = fake.enemyCells()[0];
    if (target) await fireAt(page, target.x, target.y);
    await expectAccessible(page, "battle");
    await page.getByRole("button", { name: "Resign" }).click();
    await expectAccessible(page, "resign dialog");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Resign" })
      .click();
    await expect(page.getByTestId("result")).toBeVisible();
    await expectAccessible(page, "result");
  });

  test("night sea board, profile, shop, room and replay", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "silver");
    await startBotGame(page);
    await deployRandomFleet(page);
    const target = fake.enemyCells()[0];
    if (target) await fireAt(page, target.x, target.y);
    await expectAccessible(page, "battle (night sea)");
    await page.goto("/profile");
    await expectAccessible(page, "profile");
    await page.goto("/shop");
    await expectAccessible(page, "shop");
    await page.goto("/");
    await page.getByTestId("create-room").click();
    await expect(page.getByTestId("room-host")).toBeVisible();
    await expectAccessible(page, "room");
  });

  test("Premium profile and replay", async ({ page, game }) => {
    await signInAndConnect(page, game, "premium", "/profile");
    await expectAccessible(page, "profile (premium)");
    await page.goto("/replay/00000000-0000-4000-8000-000000001000");
    await expect(page.getByTestId("replay")).toBeVisible();
    await expectAccessible(page, "replay");
  });
});

test.describe("no layout shift", () => {
  test("public pages load without moving", async ({ page }) => {
    for (const path of ["/", "/leaderboard", "/shop"]) {
      await page.goto(path);
      await settle(page);
      expect(await layoutShift(page), path).toBeLessThan(0.02);
    }
  });

  test("lobby, profile and shop signed in, and errors that appear in place", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free");
    await settle(page);
    expect(await layoutShift(page), "lobby").toBeLessThan(0.02);
    // An inline error takes the space reserved for it.
    const card = page.getByTestId("mode-room");
    const before = await card.boundingBox();
    await page.getByTestId("room-code-input").fill("bad");
    await page.getByTestId("join-room").click();
    await expect(card.locator(".field-hint")).not.toBeEmpty();
    expect(await card.boundingBox()).toEqual(before);
    await page.goto("/profile");
    await settle(page);
    expect(await layoutShift(page), "profile").toBeLessThan(0.02);
    const settings = page.getByTestId("settings");
    const box = await settings.boundingBox();
    await settings.getByLabel("Nickname").fill("x");
    await page.getByTestId("save-nickname").click();
    await expect(settings.locator(".field-hint")).toHaveAttribute(
      "data-tone",
      "error",
    );
    expect(await settings.boundingBox()).toEqual(box);
    await page.goto("/shop");
    await settle(page);
    expect(await layoutShift(page), "shop").toBeLessThan(0.02);
  });

  test("the battle screen does not move while shots land and banners come and go", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await startBotGame(page);
    await deployRandomFleet(page);
    const boards = page.locator(".boards");
    const before = await boards.boundingBox();
    for (const cell of fake.enemyCells().slice(0, 3))
      await fireAt(page, cell.x, cell.y);
    fake.presence(false);
    await expect(page.getByTestId("banner-opponent-away")).toBeVisible();
    fake.presence(true);
    await expect(page.getByTestId("banner-opponent-away")).toBeHidden();
    expect(await boards.boundingBox()).toEqual(before);
    expect(await layoutShift(page)).toBeLessThan(0.02);
  });
});

test.describe("languages and phones", () => {
  test("Russian: the whole game speaks it", async ({ page, game, context }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Топите флот.",
    );
    await expect(page.getByTestId("sign-in-cta")).toHaveText("Войти и играть");
    await signInAndConnect(page, game, "free");
    await expect(page.getByTestId("mode-bot")).toContainText("Против бота");
    await startBotGame(page, "Лёгкий");
    await expect(
      page.getByRole("heading", { name: "Расставьте флот" }),
    ).toBeVisible();
    await deployRandomFleet(page);
    await expect(page.getByTestId("turn-indicator")).toContainText("Ваш ход");
    await expect(page.getByTestId("turn-rule")).toHaveText(
      "С ботом время не ограничено",
    );
    await expect(
      page.getByTestId("target-board").locator("button").first(),
    ).toHaveAccessibleName("A1, неизвестно");
  });

  test("Russian: the clock and an absent opponent explain themselves", async ({
    page,
    game,
    context,
  }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    const fake = await signInAndConnect(page, game, "free");
    fake.script.turnMs = 30_000;
    fake.startHumanMatch({
      kind: "human",
      nickname: "Nemo",
      rating: 1512,
      premium: true,
    });
    await expect(page.getByTestId("placement-rule")).toHaveText(
      "Расставьте флот до нуля, иначе матч проигран.",
    );
    await deployRandomFleet(page);
    const indicator = page.getByTestId("turn-indicator");
    await expect(page.getByTestId("turn-rule")).toHaveText(
      "30 с на ход · 3 пропуска подряд — поражение",
    );
    await expect(indicator.getByRole("timer")).toHaveAccessibleName(
      /^Осталось \d+ с на ваш выстрел$/,
    );
    fake.presence(false, 45_000);
    await expect(page.getByTestId("banner-opponent-away")).toContainText(
      /Соперник отключился\. Если он не вернётся за (4[0-5]) с, победа ваша\./,
    );
    await expect(page.getByTestId("opponent-away")).toHaveText(
      /^Не в сети · (4[0-5]) с$/,
    );
  });

  test.describe("phone", () => {
    test.use({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });

    test("boards are stacked, target first, cells at least 32 px", async ({
      page,
      game,
    }) => {
      const fake = await signInAndConnect(page, game, "free");
      await expect(page.locator(".tab-bar")).toBeVisible();
      await startBotGame(page);
      const placementCell = await page
        .getByTestId("placement-board")
        .locator("button")
        .first()
        .boundingBox();
      expect(placementCell?.width ?? 0).toBeGreaterThanOrEqual(32);
      await deployRandomFleet(page);
      const target = await page.getByTestId("target-board").boundingBox();
      const own = await page.getByTestId("own-board").boundingBox();
      expect(target && own && target.y < own.y).toBe(true);
      expect(Math.abs((target?.x ?? 0) - (own?.x ?? 0))).toBeLessThan(2);
      for (const board of ["target-board", "own-board"]) {
        const cell = await page
          .getByTestId(board)
          .locator(".cell")
          .first()
          .boundingBox();
        expect(cell?.width ?? 0, board).toBeGreaterThanOrEqual(32);
        expect(cell?.height ?? 0, board).toBeGreaterThanOrEqual(32);
      }
      const width = page.viewportSize()?.width ?? 0;
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      // Tap to fire works on touch screens.
      const cell = fake.enemyCells()[0];
      if (cell) {
        await page
          .getByTestId("target-board")
          .locator(`button[data-x="${cell.x}"][data-y="${cell.y}"]`)
          .tap();
        await expect(
          page
            .getByTestId("target-board")
            .locator(`button[data-x="${cell.x}"][data-y="${cell.y}"]`),
        ).toHaveAccessibleName(/hit|sunk/);
      }
    });

    test("at 360 px, the smallest supported width, cells are still 32 px", async ({
      page,
      game,
    }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await signInAndConnect(page, game, "free");
      await startBotGame(page);
      await deployRandomFleet(page);
      for (const board of ["target-board", "own-board"]) {
        const cell = await page
          .getByTestId(board)
          .locator(".cell")
          .first()
          .boundingBox();
        expect(cell?.width ?? 0, board).toBeGreaterThanOrEqual(32);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(360);
    });

    test("a long banner floats over the boards instead of pushing them", async ({
      page,
      game,
    }) => {
      const fake = await signInAndConnect(page, game, "free");
      await startBotGame(page);
      await deployRandomFleet(page);
      const boards = page.locator(".boards");
      const before = await boards.boundingBox();
      fake.script.readyDelayMs = 1500;
      await fake.drop();
      await expect(page.getByTestId("banner-reconnecting")).toBeVisible();
      expect(await boards.boundingBox()).toEqual(before);
      await expect(page.getByTestId("banner-reconnecting")).toBeHidden({
        timeout: 15_000,
      });
    });

    test("every page fits the screen", async ({ page, game }) => {
      await signInAndConnect(page, game, "premium");
      for (const path of ["/", "/leaderboard", "/profile", "/shop"]) {
        await page.goto(path);
        await settle(page);
        const width = page.viewportSize()?.width ?? 0;
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
          path,
        ).toBeLessThanOrEqual(width);
      }
    });
  });
});

test.describe("delivery", () => {
  test("CSP admits the game socket; pages are never stored, build assets are", async ({
    page,
    request,
  }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain(
      `connect-src 'self' ${PLATFORM.replace("http:", "ws:")}`,
    );
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    const css = await page
      .locator('link[rel="stylesheet"]')
      .first()
      .getAttribute("href");
    expect(css).toMatch(/^\/_next\/static\//);
    const asset = await request.get(css as string);
    expect(asset.headers()["cache-control"]).toContain("immutable");
    const health = await request.get("/health");
    expect(await health.json()).toEqual({
      status: "ok",
      service: "battleship-web",
    });
  });

  test("the ticket endpoint needs a session and a same-origin caller", async ({
    page,
    request,
  }) => {
    const anonymous = await request.post("/api/ws-ticket");
    expect(anonymous.status()).toBe(401);
    await signIn(page, "free");
    const forged = await page.request.post("/api/ws-ticket", {
      headers: { origin: "https://evil.test" },
    });
    expect(forged.status()).toBe(403);
    const ok = await page.request.post("/api/ws-ticket", {
      headers: { origin: APP },
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).ticket.length).toBeGreaterThanOrEqual(32);
  });
});
