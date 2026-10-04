import { exerciseIdsOf } from "@outegro/edu-engine";
import type { Page } from "@playwright/test";
import { blocksOf, chapter } from "./support/books.ts";
import {
  expect,
  hydrated,
  injectFault,
  recordedAttempts,
  settle,
  signIn,
  test,
} from "./support/fixtures.ts";

/*
 * The server decides exercise results, and every save is visible: what
 * the page shows when edu-backend does not answer, when the browser is
 * offline, when the server refuses for good, and that a retry resends the
 * same attempt (same Idempotency-Key) and is counted once.
 */

const first = chapter("nodejs-internals", 1);
const quizData = blocksOf("nodejs-internals", 1, "quiz")[0];
if (!quizData) throw new Error("no quiz in chapter 1");
const quiz = quizData;
const total = exerciseIdsOf(first).length;

/** Answers the first quiz of Node chapter 1 right (or wrong) as the book says. */
async function answer(page: Page, right: boolean) {
  const box = page.locator(".quiz").first();
  const options = box.locator(".quiz-option");
  await hydrated(options.first());
  const wrong = quiz.options.findIndex(
    (_, index) => !quiz.answer.includes(index),
  );
  for (const index of right ? quiz.answer : [wrong])
    await options.nth(index).click();
  if (new Set(quiz.answer).size > 1)
    await box.getByRole("button", { name: "Проверить" }).click();
  return box;
}

const tocCount = (page: Page) =>
  page.locator(".toc-aside").getByRole("link", { name: /Устройство/ });

test.describe("exercise attempts", () => {
  test("a lost answer is shown as not saved, and Retry sends the same attempt once", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    // The server records the attempt, then the connection breaks.
    await injectFault(page, { route: "attempts", mode: "dropAfter" });
    const box = await answer(page, true);
    await expect(box.getByTestId("save-status")).toHaveText(
      "Не сохранено: нет ответа сервера.",
    );
    // The verdict of this device, marked as not saved; nothing solved yet.
    await expect(box.getByTestId("ex-result")).toHaveText("Верно.");
    await expect(box.locator(".ex-solved")).toHaveText("");
    await expect(tocCount(page)).toContainText(`0/${total}`);

    await box.getByRole("button", { name: "Повторить" }).click();
    await expect(box.getByTestId("save-status")).toHaveText(
      "Сохранено в аккаунте",
    );
    await expect(box.getByTestId("save-status")).toBeFocused();
    await expect(box.locator(".ex-solved")).toHaveText("решено");
    await expect(tocCount(page)).toContainText(`1/${total}`);
    // Two requests with one key, one attempt on the server.
    const recorded = await recordedAttempts(page, quiz.id);
    expect(recorded.requests).toBe(2);
    expect(recorded.count).toBe(1);
    expect(recorded.keys).toHaveLength(1);
  });

  test("offline, nothing is sent; back online, Retry saves it", async ({
    page,
    context,
    allowConsoleErrors,
  }) => {
    // The browser's own requests (prefetches) fail while offline.
    allowConsoleErrors(/ERR_INTERNET_DISCONNECTED/);
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await hydrated(page.locator(".quiz-option").first());
    await context.setOffline(true);
    const box = await answer(page, false);
    await expect(box.getByTestId("save-status")).toHaveText(
      "Нет сети: не сохранено.",
    );
    await expect(box.getByTestId("ex-result")).not.toHaveText("");
    expect((await recordedAttempts(page, quiz.id)).requests).toBe(0);

    await context.setOffline(false);
    await box.getByRole("button", { name: "Повторить" }).click();
    await expect(box.getByTestId("save-status")).toHaveText(
      "Сохранено в аккаунте",
    );
    expect((await recordedAttempts(page, quiz.id)).count).toBe(1);
  });

  test("keyboard: a retry that ends for good takes its button away and focus goes to the status line", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await injectFault(page, { route: "attempts", mode: "drop" });
    const box = await answer(page, true);
    const retry = box.getByRole("button", { name: "Повторить" });
    await expect(retry).toBeVisible();
    // The retry reaches a server that refuses it for good.
    await injectFault(page, { route: "attempts", mode: "status", status: 403 });
    await retry.focus();
    await page.keyboard.press("Enter");
    const status = box.getByTestId("save-status");
    await expect(status).toHaveText(
      "Не сохранено: глава вам больше не открыта.",
    );
    await expect(retry).toHaveCount(0);
    await expect(status).toBeFocused();
  });

  test("on a 360 px phone in Russian, a failed save and its Retry move nothing", async ({
    page,
    context,
    allowConsoleErrors,
  }) => {
    // The browser's own requests (prefetches) fail while offline.
    allowConsoleErrors(/ERR_INTERNET_DISCONNECTED/);
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    const box = page.locator(".quiz").first();
    const line = box.locator(".save-line");
    await hydrated(box.locator(".quiz-option").first());
    await settle(page);
    const before = await line.evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    await injectFault(page, { route: "attempts", mode: "drop" });
    await answer(page, true);
    const status = box.getByTestId("save-status");
    await expect(status).toHaveText("Не сохранено: нет ответа сервера.");
    await expect(box.getByRole("button", { name: "Повторить" })).toBeVisible();
    // The longest message next to its button: three lines, all kept from the start.
    const after = await line.evaluate((node) => ({
      line: node.getBoundingClientRect().height,
      message:
        node.querySelector(".save-message")?.getBoundingClientRect().height ??
        0,
    }));
    expect(after.line).toBe(before);
    expect(after.message).toBeLessThanOrEqual(before);
    // Offline the same.
    await page.context().setOffline(true);
    await box.getByRole("button", { name: "Повторить" }).click();
    await expect(status).toHaveText("Нет сети: не сохранено.");
    expect(
      await line.evaluate((node) => node.getBoundingClientRect().height),
    ).toBe(before);
    await page.context().setOffline(false);
  });

  test("a refusal for good says why, with no Retry", async ({ page }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await injectFault(page, { route: "attempts", mode: "status", status: 403 });
    const box = await answer(page, true);
    await expect(box.getByTestId("save-status")).toHaveText(
      "Не сохранено: глава вам больше не открыта.",
    );
    await expect(box.getByRole("button", { name: "Повторить" })).toHaveCount(0);
    await expect(box.locator(".ex-solved")).toHaveText("");
  });

  test("the page follows the server's verdict, not its own", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    // A wrong answer the server (here: steered) calls right and solved.
    await injectFault(page, {
      route: "attempts",
      mode: "verdict",
      verdict: { correct: true, solved: true },
    });
    const box = await answer(page, false);
    await expect(box.getByTestId("ex-result")).toHaveText("Верно.");
    await expect(box.locator(".ex-solved")).toHaveText("решено");

    // And a right one it calls wrong.
    await box.getByRole("button", { name: "Ответить заново" }).click();
    await injectFault(page, {
      route: "attempts",
      mode: "verdict",
      verdict: { correct: false, solved: true },
    });
    await answer(page, true);
    await expect(box.getByTestId("ex-result")).not.toHaveText("Верно.");
    await expect(box.getByTestId("ex-result")).toHaveText(/разбор ниже/);
  });

  test("checking shows on the button and in the result line until the server answers", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await injectFault(page, {
      route: "attempts",
      mode: "delay",
      delayMs: 1500,
    });
    const box = await answer(page, true);
    await expect(box.getByTestId("ex-result")).toHaveText("Проверяю…");
    await expect(box.locator(".ex-solved")).toHaveText("");
    await expect(box.getByTestId("ex-result")).toHaveText("Верно.");
    await expect(box.locator(".ex-solved")).toHaveText("решено");
  });
});

test.describe("flash card marks", () => {
  async function markFirstCard(page: Page, label: "Знаю" | "Ещё раз") {
    const show = page.getByRole("button", { name: "Показать ответ" });
    await hydrated(show);
    await show.click();
    await page.getByRole("button", { name: label }).last().click();
  }

  test("a failed save of any card is shown, and Retry saves every one", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/cards");
    await injectFault(page, { route: "cards", mode: "drop", times: 2 });
    await markFirstCard(page, "Знаю");
    await markFirstCard(page, "Ещё раз");
    const status = page.getByTestId("deck-save").getByTestId("save-status");
    await expect(status).toHaveText("2 отметки не сохранены.");
    // The marks stay on the page meanwhile.
    await expect(page.getByTestId("deck-know")).toHaveText("1");
    await expect(page.getByTestId("deck-again")).toHaveText("1");
    await page
      .getByTestId("deck-save")
      .getByRole("button", { name: "Повторить" })
      .click();
    await expect(status).toHaveText("Сохранено в аккаунте");
    await page.reload();
    await expect(page.getByTestId("deck-know")).toHaveText("1");
    await expect(page.getByTestId("deck-again")).toHaveText("1");
  });

  test("keyboard: Retry goes away under the focus once the marks are saving: the status line takes it", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/cards");
    await injectFault(page, { route: "cards", mode: "drop" });
    await markFirstCard(page, "Знаю");
    const save = page.getByTestId("deck-save");
    const status = save.getByTestId("save-status");
    await expect(status).toHaveText("1 отметка не сохранена.");
    const retry = save.getByRole("button", { name: "Повторить" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(retry).toHaveCount(0);
    await expect(status).toBeFocused();
    await expect(status).toHaveText("Сохранено в аккаунте");
  });

  test("offline, marks wait for the connection", async ({
    page,
    context,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/ERR_INTERNET_DISCONNECTED/);
    await signIn(page, "reader", "/books/nodejs-internals/cards");
    await hydrated(page.getByRole("button", { name: "Показать ответ" }));
    await context.setOffline(true);
    await markFirstCard(page, "Знаю");
    const status = page.getByTestId("deck-save").getByTestId("save-status");
    await expect(status).toHaveText("Нет сети: 1 отметка не сохранена.");
    await context.setOffline(false);
    await page
      .getByTestId("deck-save")
      .getByRole("button", { name: "Повторить" })
      .click();
    await expect(status).toHaveText("Сохранено в аккаунте");
  });

  test("a mark the server refuses for good is undone", async ({ page }) => {
    await signIn(page, "reader", "/books/nodejs-internals/cards");
    await injectFault(page, { route: "cards", mode: "status", status: 403 });
    await markFirstCard(page, "Знаю");
    const status = page.getByTestId("deck-save").getByTestId("save-status");
    await expect(status).toHaveText("Сервер не принял 1 отметку, она снята.");
    await expect(page.getByTestId("deck-know")).toHaveText("0");
    await expect(
      page.getByTestId("deck-save").getByRole("button", { name: "Повторить" }),
    ).toHaveCount(0);
  });
});
