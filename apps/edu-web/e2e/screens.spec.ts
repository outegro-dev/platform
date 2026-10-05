import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  engineLoadsOffline,
  expect,
  HUGE_RESULT,
  hydrated,
  injectFault,
  setAssist,
  settle,
  signIn,
  test,
} from "./support/fixtures.ts";

/**
 * Screenshots for review (e2e/screenshots, not committed): the library, a
 * Node chapter with a figure and an answered quiz, an answer that did not
 * reach the account, the event loop simulator, a SQL chapter with a
 * sandbox result, the deck with its saves, the chapter skeleton, the
 * not-found page and the reading assistant (explain it differently,
 * waiting and answered; explain it in your own words with its score; the
 * SQL task hint; the book page's note; paused for the day), the sandbox
 * offline, an SQL result too large to save — desktop and phone — and a
 * failed save on a 360 px phone in Russian.
 */
const dir = path.join(__dirname, "screenshots");
mkdirSync(dir, { recursive: true });

async function capture(page: Page, name: string, around?: Locator | "top") {
  await settle(page);
  if (around === "top") {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(dir, `${name}.png`),
      animations: "disabled",
    });
    return;
  }
  if (around) {
    await around.evaluate((node) =>
      window.scrollTo(
        0,
        node.getBoundingClientRect().top + window.scrollY - 24,
      ),
    );
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(dir, `${name}.png`),
      animations: "disabled",
    });
    return;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

for (const device of [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`screens, ${device.name}`, () => {
    test.use({ viewport: device.viewport });

    test("library", async ({ page }) => {
      await signIn(page, "reader", "/");
      await capture(page, `${device.name}-library`);
    });

    test("node chapter: figure and quiz", async ({ page }) => {
      await signIn(page, "reader", "/books/nodejs-internals/1");
      await capture(page, `${device.name}-node-chapter-top`, "top");
      await capture(
        page,
        `${device.name}-node-figure`,
        page.locator(".figure").first(),
      );
      const quiz = page.locator(".quiz").first();
      await quiz.locator(".quiz-option").first().click();
      await quiz.locator(".quiz-option").nth(2).click();
      await quiz.getByRole("button", { name: "Проверить" }).click();
      await expect(quiz.locator(".why")).toBeVisible();
      await capture(page, `${device.name}-node-quiz`, quiz);
    });

    test("an answer that did not reach the account", async ({ page }) => {
      await signIn(page, "reader", "/books/nodejs-internals/1");
      await injectFault(page, { route: "attempts", mode: "drop" });
      const quiz = page.locator(".quiz").first();
      await quiz.locator(".quiz-option").first().click();
      const check = quiz.getByRole("button", { name: "Проверить" });
      if (await check.isVisible()) await check.click();
      await expect(
        quiz.getByRole("button", { name: "Повторить" }),
      ).toBeVisible();
      await capture(page, `${device.name}-node-quiz-unsaved`, quiz);
    });

    test("deck with its saves", async ({ page }) => {
      await signIn(page, "reader", "/books/nodejs-internals/cards");
      await page.getByRole("button", { name: "Показать ответ" }).click();
      await page.getByRole("button", { name: "Знаю" }).click();
      await expect(page.getByTestId("deck-save")).toContainText(
        "Сохранено в аккаунте",
      );
      await capture(page, `${device.name}-deck`, page.locator(".deck"));
    });

    test("chapter skeleton while the next chapter loads", async ({ page }) => {
      // One capture is enough: the phone shows the same frame, folded.
      test.skip(device.name === "phone");
      await signIn(page, "subscriber", "/books/nodejs-internals/2");
      await settle(page);
      // Hold the next chapter's data so its loading state stays on screen.
      await page.route("**/books/nodejs-internals/3*", async (route) => {
        await new Promise((done) => setTimeout(done, 4000));
        await route.continue().catch(() => undefined);
      });
      await page
        .getByRole("navigation", { name: "Chapters" })
        .getByRole("link", { name: /Next/ })
        .click();
      await expect(page.locator(".skeleton-article")).toBeVisible();
      await page.screenshot({
        path: path.join(dir, `${device.name}-chapter-skeleton.png`),
        animations: "disabled",
      });
    });

    test("not found", async ({ page, allowConsoleErrors }) => {
      allowConsoleErrors(/status of 404/);
      await page.goto("/books/no-such-book");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await capture(page, `${device.name}-not-found`, "top");
    });

    test("event loop simulator", async ({ page }) => {
      await signIn(page, "subscriber", "/books/nodejs-internals/4");
      const sim = page.locator(".simulator");
      for (let i = 0; i < 5; i++)
        await sim.getByRole("button", { name: "Дальше" }).click();
      await capture(page, `${device.name}-simulator`, sim);
    });

    test("sql chapter: sandbox result", async ({ page }) => {
      await signIn(page, "reader", "/books/sql-internals/1");
      const sandbox = page.locator(".sandbox").first();
      await sandbox.getByRole("button", { name: "Выполнить" }).click();
      await expect(sandbox.locator(".sql-table")).toBeVisible({
        timeout: 30_000,
      });
      await capture(page, `${device.name}-sql-sandbox`, sandbox);
    });

    test("states of the QA fixes: assistant paused, engine offline, result too large, a failed save on a 360 px phone", async ({
      page,
      context,
      allowConsoleErrors,
    }) => {
      allowConsoleErrors(/status of 503|ERR_INTERNET_DISCONNECTED/);
      await signIn(page, "reader", "/books/nodejs-internals/1");
      await setAssist(page, { paused: true });
      const toggle = page
        .getByRole("button", { name: "Объясни иначе" })
        .first();
      await hydrated(toggle);
      await toggle.click();
      const panel = page.getByTestId("assist-panel").first();
      await panel.getByRole("radio", { name: "Глубже" }).click();
      await expect(panel.getByTestId("assist-answer")).toContainText(
        "приостановлен",
      );
      await capture(page, `${device.name}-assist-paused`, panel);

      const engine = await engineLoadsOffline(context);
      await page.goto("/books/sql-internals/1");
      const sandbox = page.locator(".sandbox").first();
      // Near the screen it runs by itself; the engine's download waits.
      await sandbox.scrollIntoViewIfNeeded();
      await expect(sandbox.locator(".sql-message")).toBeVisible();
      await engine.offline();
      await expect(sandbox.locator(".sql-offline")).toBeVisible({
        timeout: 30_000,
      });
      await capture(page, `${device.name}-sql-offline`, sandbox);
      await engine.online();
      await expect(sandbox.locator(".sql-table")).toBeVisible({
        timeout: 30_000,
      });

      const task = page.locator(".sql-task").first();
      const editor = task.getByRole("textbox", { name: "SQL-запрос" });
      await hydrated(editor);
      await editor.fill(HUGE_RESULT);
      await task.getByRole("button", { name: "Проверить" }).click();
      await expect(task.getByTestId("save-status")).toContainText(
        "слишком большой",
        { timeout: 30_000 },
      );
      await capture(
        page,
        `${device.name}-sql-too-large`,
        task.locator(".ex-status"),
      );

      if (device.name !== "phone") return;
      await context.addCookies([
        { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
      ]);
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto("/books/nodejs-internals/1");
      await injectFault(page, { route: "attempts", mode: "drop" });
      const quiz = page.locator(".quiz").first();
      await hydrated(quiz.locator(".quiz-option").first());
      await quiz.locator(".quiz-option").first().click();
      const check = quiz.getByRole("button", { name: "Проверить" });
      if (await check.isVisible()) await check.click();
      await expect(
        quiz.getByRole("button", { name: "Повторить" }),
      ).toBeVisible();
      await capture(page, "phone-360-save-failed", quiz.locator(".ex-status"));
    });

    test("reading assistant", async ({ page }) => {
      await signIn(page, "reader", "/books/nodejs-internals");
      await capture(page, `${device.name}-book-assist-note`, "top");
      await page.goto("/books/nodejs-internals/1");
      const toggle = page
        .getByRole("button", { name: "Объясни иначе" })
        .first();
      await hydrated(toggle);
      await toggle.click();
      const panel = page.getByTestId("assist-panel").first();
      await injectFault(page, {
        route: "assist",
        mode: "delay",
        delayMs: 4000,
      });
      await panel.getByRole("radio", { name: "На примере кода" }).click();
      await expect(panel.getByTestId("assist-answer")).toContainText(
        "Помощник пишет объяснение",
      );
      await capture(page, `${device.name}-assist-waiting`, panel);
      await panel.getByRole("button", { name: "Остановить" }).click();
      await panel.getByRole("radio", { name: "Проще" }).click();
      await expect(panel.getByTestId("assist-answer")).toContainText("Итог");
      await capture(page, `${device.name}-assist-explain`, panel);

      const box = page.getByTestId("own-words");
      const field = box.getByRole("textbox", { name: "Ваше объяснение" });
      await field.fill(
        "Node.js — это рантайм: движок V8 исполняет JavaScript, а libuv даёт цикл событий, пул потоков и доступ к файлам и сети.",
      );
      await box.getByRole("button", { name: "Проверить понимание" }).click();
      await expect(box.getByTestId("understanding-score")).toBeVisible();
      await capture(page, `${device.name}-assist-own-words`, box);

      await page.goto("/books/sql-internals/1");
      const task = page.locator(".sql-task").first();
      const editor = task.getByRole("textbox", { name: "SQL-запрос" });
      await hydrated(editor);
      await editor.fill("SELECT * FROM client;");
      await task.getByRole("button", { name: "Проверить" }).click();
      await task
        .getByRole("button", { name: "Спросить, что не так" })
        .click({ timeout: 30_000 });
      await expect(task.getByTestId("sql-hint-answer")).toContainText(
        "customers",
      );
      await capture(
        page,
        `${device.name}-assist-sql-hint`,
        task.locator(".ex-status"),
      );
    });
  });
}
