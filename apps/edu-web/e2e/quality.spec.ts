import type { Page } from "@playwright/test";
import {
  cutOffElements,
  expect,
  expectAccessible,
  expectNothingCutOff,
  hydrated,
  injectFault,
  layoutShift,
  setAssist,
  settle,
  signIn,
  test,
} from "./support/fixtures.ts";

/** Opens an exercise's answered state, so axe sees marks and explanations too. */
async function answerAQuiz(page: Page) {
  const quiz = page.locator(".quiz").nth(1);
  await quiz.locator(".quiz-option").first().click();
  const check = quiz.getByRole("button", { name: "Проверить" });
  if (await check.isVisible()) await check.click();
  await expect(quiz.locator(".why")).toBeVisible();
}

for (const size of [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone (360 px)", viewport: { width: 360, height: 780 } },
]) {
  test.describe(`accessibility and layout, ${size.name}`, () => {
    test.use({ viewport: size.viewport });

    test("library and book pages", async ({ page }) => {
      for (const path of [
        "/",
        "/books/nodejs-internals",
        "/books/sql-internals",
      ]) {
        await page.goto(path);
        await settle(page);
        await expectAccessible(page, path);
        await expectNothingCutOff(page, path);
      }
      await signIn(page, "reader", "/");
      await expectAccessible(page, "library, signed in");
      await page.goto("/books/sql-internals");
      await expectAccessible(page, "book, signed in (locked)");
    });

    test("chapter pages: text, figures, exercises, gates", async ({ page }) => {
      await page.goto("/books/nodejs-internals/1");
      await expectAccessible(page, "chapter gate (signed out)");
      await signIn(page, "reader", "/books/nodejs-internals/1");
      await settle(page);
      await answerAQuiz(page);
      await page.locator(".flash-card").first().click();
      await expectAccessible(page, "node chapter 1");
      await expectNothingCutOff(page, "node chapter 1");
      await page.goto("/books/nodejs-internals/3");
      await expectAccessible(page, "locked chapter");
      await expectNothingCutOff(page, "locked chapter");
    });

    test("SQL chapter with a result, the simulator and the deck", async ({
      page,
    }) => {
      await signIn(page, "subscriber", "/books/sql-internals/1");
      const sandbox = page.locator(".sandbox").first();
      await sandbox.getByRole("button", { name: "Выполнить" }).click();
      await expect(sandbox.locator(".sql-table")).toBeVisible({
        timeout: 30_000,
      });
      await expectAccessible(page, "sql chapter 1 with a result");
      await expectNothingCutOff(page, "sql chapter 1");
      await page.goto("/books/sql-internals/intro");
      await expectAccessible(page, "sql preface");
      await expectNothingCutOff(page, "sql preface");
      await page.goto("/books/nodejs-internals/4");
      await page
        .locator(".simulator")
        .getByRole("button", { name: "Дальше" })
        .click();
      await expectAccessible(page, "node chapter 4 (simulator)");
      await expectNothingCutOff(page, "node chapter 4");
      await page.goto("/books/nodejs-internals/cards");
      await page.getByRole("button", { name: "Показать ответ" }).click();
      await expectAccessible(page, "deck");
      await expectNothingCutOff(page, "deck");
    });
  });
}

test.describe("no layout shift", () => {
  test("library, book and chapter load without moving", async ({ page }) => {
    for (const path of ["/", "/books/nodejs-internals"]) {
      await page.goto(path);
      await settle(page);
      expect(await layoutShift(page), path).toBeLessThan(0.02);
    }
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await settle(page);
    expect(await layoutShift(page), "chapter").toBeLessThan(0.02);
  });
});

test.describe("no layout shift after an interaction", () => {
  test("a sandbox's own first run (the engine downloads) moves nothing", async ({
    page,
  }) => {
    // Fonts warm first: this measures the run, not a cold font swap.
    await signIn(page, "reader", "/");
    await settle(page);
    await page.goto("/books/sql-internals/1");
    const sandbox = page.locator(".sandbox").first();
    await hydrated(sandbox.getByRole("button", { name: "Выполнить" }));
    // No click: it runs by itself near the screen, into the output box
    // that was there from the start.
    await expect(sandbox.locator(".sql-table")).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(800);
    expect(await layoutShift(page)).toBeLessThan(0.005);
    // The reader's own run lands in the same box.
    const before = await layoutShift(page);
    await sandbox.getByRole("button", { name: "Выполнить" }).click();
    await expect(sandbox.getByRole("status")).toHaveText("10 строк");
    await page.waitForTimeout(500);
    expect((await layoutShift(page)) - before).toBeLessThan(0.005);
  });

  test("a verdict that comes late moves nothing", async ({ page }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await injectFault(page, {
      route: "attempts",
      mode: "delay",
      delayMs: 1200,
    });
    const quiz = page.locator(".quiz").first();
    const option = quiz.locator(".quiz-option").first();
    await hydrated(option);
    await settle(page);
    const before = await layoutShift(page);
    await option.click();
    const check = quiz.getByRole("button", { name: "Проверить" });
    if (await check.isVisible()) await check.click();
    await expect(quiz.getByTestId("save-status")).toHaveText(
      "Сохранено в аккаунте",
      { timeout: 10_000 },
    );
    await page.waitForTimeout(300);
    expect((await layoutShift(page)) - before).toBeLessThan(0.005);
  });
});

test.describe("reduced motion", () => {
  test("movement stops, meaning stays", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const card = page.locator(".flash-card").first();
    await hydrated(card);
    const duration = await card.evaluate(
      (node) => getComputedStyle(node).transitionDuration,
    );
    expect(
      duration.split(",").every((value) => Number.parseFloat(value) <= 0.001),
      duration,
    ).toBe(true);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).not.toBe("smooth");
    // The card still turns: only the movement is gone.
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator(".flash-item").first().locator(".flash-back"),
    ).toBeVisible();
  });
});

test.describe("nothing is cut off at the sides", () => {
  test("the check sees a box past the viewport's edge, and not one that scrolls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    // Hydrated first: React must not take the test's own box for a mismatch.
    await hydrated(page.getByRole("button", { name: "RU — Русский" }));
    await expectNothingCutOff(page, "library");
    // A box wider than the phone, in the page: cut off (html clips it).
    await page.evaluate(() => {
      const wide = document.createElement("div");
      wide.id = "too-wide";
      wide.style.width = "600px";
      wide.textContent = "too wide";
      document.body.append(wide);
    });
    expect(await cutOffElements(page)).toEqual([
      expect.stringContaining("too wide"),
    ]);
    // The same box in a scrolling one is not.
    await page.evaluate(() => {
      const wide = document.getElementById("too-wide");
      const scroller = document.createElement("div");
      scroller.style.overflowX = "auto";
      wide?.replaceWith(scroller);
      if (wide) scroller.append(wide);
    });
    expect(await cutOffElements(page)).toEqual([]);
  });

  test("the reading screens at 360 px, with their open and failed states", async ({
    page,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/status of 503/);
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, "reader", "/books/nodejs-internals/1");
    // The contents unfolded, a quiz answered and not saved, a card turned.
    await page.locator(".toc-disclosure summary").click();
    await expectNothingCutOff(page, "chapter, contents open");
    await page.locator(".toc-disclosure summary").click();
    await injectFault(page, { route: "attempts", mode: "drop" });
    const quiz = page.locator(".quiz").first();
    await hydrated(quiz.locator(".quiz-option").first());
    await quiz.locator(".quiz-option").first().click();
    const check = quiz.getByRole("button", { name: "Проверить" });
    if (await check.isVisible()) await check.click();
    await expect(quiz.getByRole("button", { name: "Повторить" })).toBeVisible();
    await page.locator(".flash-card").first().click();
    await expectNothingCutOff(page, "chapter, a save failed");
    // The assistant paused for the day, said in the panel.
    await setAssist(page, { paused: true });
    const toggle = page.getByRole("button", { name: "Объясни иначе" }).first();
    await toggle.click();
    const panel = page.getByTestId("assist-panel").first();
    await panel.getByRole("radio", { name: "Глубже" }).click();
    await expect(panel.getByTestId("assist-answer")).toContainText(
      "приостановлен",
    );
    await expectNothingCutOff(page, "chapter, the assistant paused");
    await expectAccessible(page, "chapter, the assistant paused (360 px)");
    // The deck with a mark that did not reach the account.
    await page.goto("/books/nodejs-internals/cards");
    await injectFault(page, { route: "cards", mode: "drop" });
    await page.getByRole("button", { name: "Показать ответ" }).click();
    await page.getByRole("button", { name: "Знаю" }).click();
    await expect(
      page.getByTestId("deck-save").getByRole("button", { name: "Повторить" }),
    ).toBeVisible();
    await expectNothingCutOff(page, "deck, a mark not saved");
    // The book page and the library, signed in.
    await page.goto("/books/nodejs-internals");
    await expectNothingCutOff(page, "book page, signed in");
    await page.goto("/");
    await expectNothingCutOff(page, "library, signed in");
  });
});

test.describe("delivery", () => {
  test("CSP with a nonce, admits the SQL worker; pages are never stored", async ({
    page,
    request,
  }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(response?.headers()["permissions-policy"]).not.toContain(
      "publickey-credentials",
    );
    const css = await page
      .locator('link[rel="stylesheet"]')
      .first()
      .getAttribute("href");
    expect(css).toMatch(/^\/_next\/static\//);
    const asset = await request.get(css as string);
    expect(asset.headers()["cache-control"]).toContain("immutable");
  });

  test("health probes", async ({ request }) => {
    for (const path of ["/health", "/health/deep"]) {
      const health = await request.get(path);
      expect(health.status()).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", service: "edu-web" });
    }
  });
});

test.describe("languages", () => {
  test("a switch that fails keeps the language and says why", async ({
    page,
    context,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/ERR_FAILED|ERR_INTERNET_DISCONNECTED|Failed to fetch/);
    await page.goto("/");
    const russian = page.getByRole("button", { name: "RU — Русский" });
    await hydrated(russian);
    // Offline: explained at once, nothing is sent.
    await context.setOffline(true);
    await russian.click();
    await expect(page.getByTestId("action-status")).toHaveText(
      "You're offline. Check the connection and try again.",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await context.setOffline(false);
    // Online, but the server action does not get through.
    await page.route("**/*", (route) =>
      route.request().method() === "POST" &&
      route.request().headers()["next-action"]
        ? route.abort()
        : route.continue(),
    );
    await russian.click();
    await expect(page.getByTestId("action-status")).toHaveText(
      "The language did not change. Try again.",
    );
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Interactive textbooks",
    );
  });

  test("the interface switches between English and Russian; the book stays Russian", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".toc-heading")).toHaveText("Contents");
    await expect(page.locator(".quiz").first()).toContainText("Проверь себя");

    await page.getByRole("button", { name: "RU — Русский" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.locator(".toc-heading")).toHaveText("Оглавление");
    await expect(page.locator(".brand-product")).toHaveText("Обучение");
    await expect(page.getByRole("navigation", { name: "Главы" })).toContainText(
      "Дальше",
    );
    // The book's own words do not change with the interface.
    await expect(page.locator(".quiz").first()).toContainText("Проверь себя");
    await expect(page.locator("article.book-article")).toHaveAttribute(
      "lang",
      "ru",
    );

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Интерактивные учебники",
    );
    await page.getByRole("button", { name: "EN — English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Interactive textbooks",
    );
  });
});
