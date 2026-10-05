import type { Locator, Page } from "@playwright/test";
import { blocksOf } from "./support/books.ts";
import {
  assistLog,
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

/*
 * The reading assistant against the fake edu-backend: scripted answers
 * streamed as Server-Sent Events through edu-web's BFF. The book is
 * Russian, so are the helpers; the interface around them is English.
 */

const firstSection = blocksOf("nodejs-internals", 1, "h3")[0];
const firstTask = blocksOf("sql-internals", 1, "sqlTask")[0];
const retelling =
  "Node.js — это рантайм: движок V8 исполняет JavaScript, а libuv даёт цикл событий, пул потоков и доступ к файлам и сети. Привязки на C++ соединяют их с ядром ОС.";

/** Opens "Explain it differently" under the chapter's first section. */
async function openPanel(page: Page): Promise<Locator> {
  const toggle = page.getByRole("button", { name: "Объясни иначе" }).first();
  await hydrated(toggle);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByTestId("assist-panel").first();
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("explain it differently", () => {
  test("a style answer streams in; Stop keeps what came and hangs up", async ({
    page,
  }) => {
    if (!firstSection) throw new Error("no section in chapter 1");
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const toggle = page.getByRole("button", { name: "Объясни иначе" });
    // Under every section heading, none elsewhere.
    await expect(toggle).toHaveCount(
      blocksOf("nodejs-internals", 1, "h3").length,
    );
    const panel = await openPanel(page);
    await expect(panel).toContainText(
      "Помощник объяснит этот раздел по-другому. Выберите способ или задайте свой вопрос.",
    );
    await expect(panel.getByTestId("assist-quota")).toHaveText(
      "Осталось 30 из 30 на сегодня",
    );
    const styles = panel.getByRole("radiogroup", {
      name: "Способ объяснения",
    });
    await expect(styles.getByRole("radio")).toHaveText([
      "Проще",
      "Другая аналогия",
      "На примере кода",
      "Глубже",
      "Как ответить на собесе",
      "Частые ошибки",
    ]);

    await styles.getByRole("radio", { name: "Проще" }).click();
    const answer = panel.getByTestId("assist-answer");
    const text = answer.locator(".assist-md");
    await expect(text).toContainText("Итог: порядок задаёт цикл событий.");
    // The Markdown subset as elements: bold, a list, inline code, a code block.
    await expect(text.locator("strong").first()).toHaveText("Проще.");
    await expect(text.locator("li")).toHaveCount(2);
    await expect(text.locator("li").nth(1)).toHaveText(
      "Второе: setImmediate выполняется в фазе check. Это продолжение второго пункта.",
    );
    await expect(text.locator(".code-title")).toHaveText("JavaScript");
    await expect(panel.getByTestId("assist-quota")).toHaveText(
      "Осталось 29 из 30 на сегодня",
    );
    expect((await assistLog(page)).requests.at(-1)?.body).toEqual({
      chapter: 1,
      section: firstSection.id,
      style: "simpler",
    });

    // A slow answer, stopped on its way.
    await injectFault(page, { route: "assist", mode: "delay", delayMs: 700 });
    await styles.getByRole("radio", { name: "Глубже" }).click();
    await expect(answer).toContainText(
      "Помощник пишет объяснение: глубже. Обычно 5–30 секунд.",
    );
    await expect(text).toContainText("Глубже.", { timeout: 5000 });
    await panel.getByRole("button", { name: "Остановить" }).click();
    await expect(answer).toContainText("Остановлено.");
    const kept = await text.innerText();
    expect(kept).not.toContain("Итог");
    // The BFF hung up on edu-backend: the model stops too.
    await expect.poll(async () => (await assistLog(page)).hangUps).toBe(1);
    await page.waitForTimeout(1500);
    await expect(text).toHaveText(kept);
    // The words already shown were counted.
    await expect(panel.getByTestId("assist-quota")).toHaveText(
      "Осталось 28 из 30 на сегодня",
    );

    // The disclosure closes and opens the panel, answer kept.
    await toggle.first().click();
    await expect(panel).toBeHidden();
    await toggle.first().click();
    await expect(text).toHaveText(kept);
  });

  test("another version sends the previous answer as what not to repeat", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const panel = await openPanel(page);
    await panel.getByRole("radio", { name: "Другая аналогия" }).click();
    const answer = panel.getByTestId("assist-answer");
    await expect(answer).toContainText("Итог: порядок задаёт цикл событий.");
    // Only Stop while it runs; another version once a style answer came.
    await panel.getByRole("button", { name: "Ещё вариант" }).click();
    await expect(answer).toContainText("Другой вариант.");
    const asked = (await assistLog(page)).requests.at(-1)?.body;
    expect(asked).toMatchObject({ chapter: 1, style: "analogy" });
    expect(String(asked?.avoid)).toMatch(/^\*\*Другая аналогия\.\*\* Раздел/);
    expect(String(asked?.avoid).length).toBeLessThanOrEqual(1500);
  });

  test("the reader's own question; an empty one only focuses the field", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const panel = await openPanel(page);
    await panel.getByRole("radio", { name: "На примере кода" }).click();
    await expect(
      panel.getByRole("radio", { name: "На примере кода" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("assist-answer")).toContainText("Итог");
    const field = panel.getByRole("textbox", {
      name: "Свой вопрос по разделу",
    });
    await expect(field).toHaveAttribute(
      "placeholder",
      "Свой вопрос: что осталось непонятным?",
    );
    await panel.getByRole("button", { name: "Спросить" }).click();
    await expect(field).toBeFocused();
    expect((await assistLog(page)).requests).toHaveLength(1);
    await field.fill("Зачем Node.js нужен libuv?");
    await field.press("Control+Enter");
    const answer = panel.getByTestId("assist-answer");
    await expect(answer).toContainText(
      "Ответ на вопрос. Вы спросили: «Зачем Node.js нужен libuv?».",
    );
    // A question clears the chosen way; another version is for those only.
    await expect(panel.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Ещё вариант" }),
    ).toHaveCount(0);
    expect((await assistLog(page)).requests.at(-1)?.body).toEqual({
      chapter: 1,
      section: firstSection?.id,
      question: "Зачем Node.js нужен libuv?",
    });
  });

  test("a broken-off answer keeps its text and offers to retry", async ({
    page,
    allowConsoleErrors,
  }) => {
    // The browser logs the refused request (503) itself.
    allowConsoleErrors(/status of 503/);
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const panel = await openPanel(page);
    await injectFault(page, { route: "assist", mode: "streamError" });
    await panel.getByRole("radio", { name: "Проще" }).click();
    const answer = panel.getByTestId("assist-answer");
    await expect(answer).toContainText(
      "Помощник сейчас не отвечает. Попробуйте ещё раз — всё остальное в книге работает как обычно.",
    );
    await expect(answer.locator(".assist-md")).toContainText("Проще.");
    await panel.getByRole("button", { name: "Повторить" }).click();
    await expect(answer).toContainText("Итог: порядок задаёт цикл событий.");
    await expect(answer).not.toContainText("не отвечает");

    // Every slot taken (503 busy): the same, before any words.
    await injectFault(page, {
      route: "assist",
      mode: "status",
      status: 503,
      reason: "busy",
    });
    await panel.getByRole("radio", { name: "Частые ошибки" }).click();
    await expect(answer).toContainText("Помощник сейчас не отвечает.");
    await expect(
      panel.getByRole("button", { name: "Повторить" }),
    ).toBeVisible();
  });
});

test.describe("explain it in your own words", () => {
  test("too short is said in place; the review comes with the score and the best one", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const box = page.getByTestId("own-words");
    await expect(box).toContainText("Объясни своими словами · с помощником");
    await expect(box).toContainText(
      "Не подглядывая в текст, объясните главное из этой главы",
    );
    // One box per chapter, before the recap.
    await expect(box).toHaveCount(1);
    expect(
      await box.evaluate(
        (node) =>
          node.nextElementSibling?.querySelector(".recap-title") !== null ||
          node.nextElementSibling?.classList.contains("recap"),
      ),
    ).toBe(true);
    const field = box.getByRole("textbox", { name: "Ваше объяснение" });
    await expect(field).toHaveAttribute(
      "placeholder",
      "Например: «Устройство — это…»",
    );
    await hydrated(field);
    await field.fill("Node.js — это рантайм для JavaScript.");
    await box.getByRole("button", { name: "Проверить понимание" }).click();
    await expect(box.locator("#own-words-note")).toHaveText(
      "Слишком коротко: напишите хотя бы 2–3 предложения (от 80 символов), чтобы было что проверить.",
    );
    await expect(field).toBeFocused();
    expect((await assistLog(page)).requests).toHaveLength(0);

    await field.fill(retelling);
    await expect(box.locator("#own-words-note")).toHaveText(
      "Хватит 5–10 предложений",
    );
    // Long enough to see the waiting line on a loaded machine (300 ms raced).
    await injectFault(page, { route: "assist", mode: "delay", delayMs: 1500 });
    await box.getByRole("button", { name: "Проверить понимание" }).click();
    const answer = box.getByTestId("own-words-answer");
    await expect(answer).toContainText(
      "Помощник читает объяснение и сверяет с главой. Обычно 10–40 секунд.",
    );
    await expect(answer).toContainText("Оценка понимания: 8", {
      timeout: 10_000,
    });
    await expect(box.getByTestId("understanding-score")).toHaveText(
      "Оценка понимания: 8/10",
    );
    await expect(box.getByTestId("understanding-best")).toHaveText(
      "Понимание подтверждено · лучшая оценка 8/10",
    );
    expect((await assistLog(page)).requests.at(-1)).toEqual({
      kind: "understanding",
      body: { chapter: 1, text: retelling },
    });
    // The contents mark the chapter as understood (interface words).
    await expect(
      page
        .locator(".toc-aside")
        .getByRole("link", { name: /Устройство.*understanding confirmed/ }),
    ).toBeVisible();

    // Next visit: the best score from the progress, the draft from this browser.
    await page.reload();
    await expect(page.getByTestId("understanding-best")).toHaveText(
      "Понимание подтверждено · лучшая оценка 8/10",
    );
    await expect(
      page.getByRole("textbox", { name: "Ваше объяснение" }),
    ).toHaveValue(retelling);
  });
});

test.describe("what is wrong with my query", () => {
  test("offered only after a failed check, once per check, about the query checked", async ({
    page,
  }) => {
    if (!firstTask) throw new Error("no SQL task in chapter 1");
    await signIn(page, "reader", "/books/sql-internals/1");
    const task = page.locator(".sql-task").first();
    const editor = task.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    const ask = task.getByRole("button", { name: "Спросить, что не так" });
    await expect(task.getByTestId("sql-hint")).toHaveCount(0);

    await editor.fill("SELECT * FROM client;");
    await task.getByRole("button", { name: "Проверить" }).click();
    await expect(ask).toBeVisible({ timeout: 30_000 });
    await editor.fill("SELECT 1;");
    await ask.click();
    await expect(ask).toHaveAttribute("aria-disabled", "true");
    const answer = task.getByTestId("sql-hint-answer");
    await expect(answer).toContainText(
      "Посмотрите на имя таблицы: в учебной базе она называется customers.",
    );
    expect((await assistLog(page)).requests.at(-1)?.body).toEqual({
      exerciseId: firstTask.id,
      sql: "SELECT * FROM client;",
      problem: "error",
      detail: "no such table: client",
    });

    // A result unlike the solution's: asked about with its start.
    await editor.fill("SELECT id FROM products;");
    await task.getByRole("button", { name: "Проверить" }).click();
    await expect(task.locator(".ex-result")).toHaveText(
      "Пока не совпадает. Колонок у вас 1, а нужно 3.",
    );
    await expect(answer).toHaveCount(0);
    await expect(ask).not.toHaveAttribute("aria-disabled", "true");
    await ask.click();
    await expect(answer).toContainText("Проверка: columns.");
    const body = (await assistLog(page)).requests.at(-1)?.body;
    expect(body).toMatchObject({
      problem: "columns",
      sql: "SELECT id FROM products;",
    });
    expect(body?.mine).toMatchObject({ columns: ["id"] });

    // Right: nothing to ask, and the last hint is gone.
    await editor.fill(firstTask.solution);
    await task.getByRole("button", { name: "Проверить" }).click();
    await expect(task.locator(".ex-result")).toHaveText(
      "Верно. Результат совпал с эталоном.",
    );
    await expect(ask).toHaveCount(0);
    await expect(answer).toHaveCount(0);
  });

  test("today's answers left show before the first hint; after Stop it may be asked again", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals/1");
    const task = page.locator(".sql-task").first();
    const editor = task.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await editor.fill("SELECT * FROM client;");
    await task.getByRole("button", { name: "Проверить" }).click();
    const ask = task.getByRole("button", { name: "Спросить, что не так" });
    await expect(ask).toBeVisible({ timeout: 30_000 });
    // Visible with the offer, before anything is asked.
    await expect(task.getByTestId("assist-quota")).toHaveText(
      "Осталось 30 из 30 на сегодня",
    );
    await injectFault(page, { route: "assist", mode: "delay", delayMs: 700 });
    await ask.click();
    const answer = task.getByTestId("sql-hint-answer");
    await expect(answer.locator(".assist-md")).toContainText("Что не так", {
      timeout: 5000,
    });
    await task.getByRole("button", { name: "Остановить" }).click();
    await expect(answer).toContainText("Остановлено.");
    // Stopped: the same check may be asked about again.
    await expect(ask).not.toHaveAttribute("aria-disabled", "true");
    await ask.click();
    await expect(answer).toContainText("customers");
    await expect(answer).not.toContainText("Остановлено.");
    // One complete hint per check, from the keyboard too.
    await expect(ask).toHaveAttribute("aria-disabled", "true");
    await ask.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect((await assistLog(page)).requests).toHaveLength(2);
    // The stopped hint's words counted, and so did the complete one.
    await expect(task.getByTestId("assist-quota")).toHaveText(
      "Осталось 28 из 30 на сегодня",
    );
  });
});

test.describe("limits and switching off", () => {
  test("the day's limit: why, when it comes back, and cached answers still served", async ({
    page,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/status of 429/);
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const panel = await openPanel(page);
    await panel.getByRole("radio", { name: "Проще" }).click();
    await expect(panel.getByTestId("assist-answer")).toContainText("Итог");
    await setAssist(page, { usedToday: 30 });
    await page.reload();
    const again = await openPanel(page);
    await expect(again.getByTestId("assist-quota")).toHaveText(
      "Осталось 0 из 30 на сегодня",
    );
    await again.getByRole("radio", { name: "Глубже" }).click();
    const answer = again.getByTestId("assist-answer");
    await expect(answer).toContainText(
      /Лимит помощника на сегодня исчерпан: 30 из 30\. Новые ответы — (сегодня|завтра) с \d{2}:\d{2}\./,
    );
    await expect(again.getByRole("button", { name: "Повторить" })).toHaveCount(
      0,
    );
    // The same section in the same way: from the cache, which costs nothing.
    await again.getByRole("radio", { name: "Проще" }).click();
    await expect(answer).toContainText("Итог: порядок задаёт цикл событий.");
    await expect(again.getByTestId("assist-quota")).toHaveText(
      "Осталось 0 из 30 на сегодня",
    );
  });

  test("off: no helper anywhere, and none left once a request finds it off", async ({
    page,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/status of 503/);
    await signIn(page, "reader", "/books/nodejs-internals");
    await expect(page.getByTestId("assist-note")).toContainText(
      "Под каждым заголовком раздела есть кнопка «Объясни иначе»",
    );
    await setAssist(page, { enabled: false });
    await page.reload();
    await expect(page.getByTestId("assist-note")).toHaveCount(0);
    await page.goto("/books/nodejs-internals/1");
    await expect(page.locator("article.book-article h1")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Объясни иначе" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("own-words")).toHaveCount(0);

    // On with the page, off by the time of asking (503 disabled).
    await setAssist(page, { enabled: true });
    await page.reload();
    const panel = await openPanel(page);
    await setAssist(page, { enabled: false });
    await panel.getByRole("radio", { name: "Проще" }).click();
    await expect(
      page.getByRole("button", { name: "Объясни иначе" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("assist-panel")).toHaveCount(0);
    await expect(page.getByTestId("own-words")).toHaveCount(0);
  });
});

test.describe("fails closed: no status, no helpers", () => {
  test.describe("signed out (a free book)", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 e2e-free-books",
    });

    test("no helper anywhere: the assistant's status is a signed-in reader's", async ({
      page,
    }) => {
      await page.goto("/books/nodejs-internals");
      await expect(page.locator("h1.book-title")).toBeVisible();
      await expect(page.getByTestId("assist-note")).toHaveCount(0);

      await page.goto("/books/nodejs-internals/1");
      // The chapter is open to everyone, and its islands have hydrated.
      await hydrated(page.locator(".quiz-option").first());
      await expect(
        page.getByRole("button", { name: "Объясни иначе" }),
      ).toHaveCount(0);
      await expect(page.getByTestId("assist-panel")).toHaveCount(0);
      await expect(page.getByTestId("own-words")).toHaveCount(0);

      // A failed SQL check offers no hint, and no sign-in for one.
      await page.goto("/books/sql-internals/1");
      const task = page.locator(".sql-task").first();
      const editor = task.getByRole("textbox", { name: "SQL-запрос" });
      await hydrated(editor);
      await editor.fill("SELECT * FROM client;");
      await task.getByRole("button", { name: "Проверить" }).click();
      await expect(task.getByRole("alert")).toContainText(
        "no such table: client",
        { timeout: 30_000 },
      );
      await expect(task.getByTestId("sql-hint")).toHaveCount(0);
      await expect(
        task.getByRole("button", { name: "Спросить, что не так" }),
      ).toHaveCount(0);
      await expect(task.getByRole("link", { name: /помощник/i })).toHaveCount(
        0,
      );
    });
  });

  test("signed in, but the status did not load: no helper either", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await expect(
      page.getByRole("button", { name: "Объясни иначе" }).first(),
    ).toBeVisible();
    await injectFault(page, {
      route: "assistStatus",
      mode: "status",
      status: 503,
      times: 5,
    });
    await page.reload();
    await hydrated(page.locator(".quiz-option").first());
    await expect(
      page.getByRole("button", { name: "Объясни иначе" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("own-words")).toHaveCount(0);
    await page.goto("/books/nodejs-internals");
    await expect(page.locator("h1.book-title")).toBeVisible();
    await expect(page.getByTestId("assist-note")).toHaveCount(0);
  });
});

test.describe("paused for today (the shared daily limit)", () => {
  test("says why, with no Retry; the reader's own count stays, cached answers still come", async ({
    page,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/status of 503/);
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const panel = await openPanel(page);
    const answer = panel.getByTestId("assist-answer");
    await panel.getByRole("radio", { name: "Проще" }).click();
    await expect(answer).toContainText("Итог: порядок задаёт цикл событий.");
    await setAssist(page, { paused: true });
    await panel.getByRole("radio", { name: "Глубже" }).click();
    await expect(answer).toContainText(
      "Помощник на сегодня приостановлен: исчерпан общий дневной лимит. Попробуйте завтра — всё остальное в книге работает как обычно.",
    );
    await expect(panel.getByRole("button", { name: "Повторить" })).toHaveCount(
      0,
    );
    await expect(panel.getByTestId("assist-quota")).toHaveText(
      "Осталось 29 из 30 на сегодня",
    );
    // The helpers stay: the same section in the same way comes from the cache.
    await panel.getByRole("radio", { name: "Проще" }).click();
    await expect(answer).toContainText("Итог: порядок задаёт цикл событий.");
    await expect(answer).not.toContainText("приостановлен");

    // The SQL task's hint says the same.
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
      "Помощник на сегодня приостановлен",
    );
    await expect(task.getByRole("button", { name: "Повторить" })).toHaveCount(
      0,
    );
  });
});

test.describe("reduced motion", () => {
  test("the waiting dots stand still; the waiting words stay", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const panel = await openPanel(page);
    await injectFault(page, { route: "assist", mode: "delay", delayMs: 2000 });
    await panel.getByRole("radio", { name: "Проще" }).click();
    const wait = panel.locator(".assist-wait");
    await expect(wait).toContainText("Помощник пишет объяснение: проще.");
    expect(
      await wait
        .locator(".assist-dots i")
        .first()
        .evaluate((node) => getComputedStyle(node).animationName),
    ).toBe("none");
  });
});

test.describe("keyboard, accessibility, phones, layout", () => {
  test("keyboard only: open, choose a way, stop; focus stays in the panel", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const toggle = page.getByRole("button", { name: "Объясни иначе" }).first();
    await hydrated(toggle);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByTestId("assist-panel").first();
    // Into the ways of explaining (a radio group), across with the arrows.
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("radio", { name: "Проще" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      panel.getByRole("radio", { name: "Другая аналогия" }),
    ).toBeFocused();
    await injectFault(page, { route: "assist", mode: "delay", delayMs: 700 });
    await page.keyboard.press("Space");
    const stop = panel.getByRole("button", { name: "Остановить" });
    await expect(stop).toBeVisible();
    for (
      let i = 0;
      i < 6 &&
      !(await stop.evaluate((node) => node === document.activeElement));
      i++
    )
      await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
    await expect(panel.locator(".assist-md")).toContainText(
      "Другая аналогия.",
      {
        timeout: 5000,
      },
    );
    await page.keyboard.press("Enter");
    await expect(panel.getByTestId("assist-answer")).toContainText(
      "Остановлено.",
    );
    // Stop went away under the focus: it moves to the answer, not the page.
    await expect(panel.locator(".assist-text")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      panel.getByRole("button", { name: "Ещё вариант" }),
    ).toBeFocused();
  });

  test("keyboard: when a request finds the assistant off, focus goes to a stable place, not the page", async ({
    page,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/status of 503/);
    if (!firstSection) throw new Error("no section in chapter 1");
    await signIn(page, "reader", "/books/nodejs-internals/1");

    // "Explain it differently": to the section's heading.
    const toggle = page.getByRole("button", { name: "Объясни иначе" }).first();
    await hydrated(toggle);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    const panel = page.getByTestId("assist-panel").first();
    await expect(panel.getByRole("radio", { name: "Проще" })).toBeFocused();
    await setAssist(page, { enabled: false });
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Объясни иначе" }),
    ).toHaveCount(0);
    const heading = page.locator(`h2#${firstSection.id}`);
    await expect(heading).toBeFocused();
    // Tab goes on from the section, not from the top of the page.
    await page.keyboard.press("Tab");
    expect(
      await heading.evaluate(
        (node) =>
          (node.compareDocumentPosition(
            document.activeElement ?? document.body,
          ) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      ),
    ).toBe(true);

    // "Explain it in your own words": to the heading of the section it closes.
    await setAssist(page, { enabled: true });
    await page.reload();
    const field = page.getByRole("textbox", { name: "Ваше объяснение" });
    await hydrated(field);
    await field.fill(retelling);
    const before = await page.evaluate(() => {
      const box = document.getElementById("own-words");
      if (!box) return null;
      return (
        [...document.querySelectorAll<HTMLElement>("article h1, article h2")]
          .filter(
            (node) =>
              node.compareDocumentPosition(box) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          )
          .at(-1)?.id ?? null
      );
    });
    if (!before) throw new Error("no heading before the own-words box");
    await setAssist(page, { enabled: false });
    await field.focus();
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("own-words")).toHaveCount(0);
    await expect(page.locator(`h2#${before}`)).toBeFocused();

    // "Ask what is wrong": to the task's result line.
    await setAssist(page, { enabled: true });
    await page.goto("/books/sql-internals/1");
    const task = page.locator(".sql-task").first();
    const editor = task.getByRole("textbox", { name: "SQL-запрос" });
    await hydrated(editor);
    await editor.fill("SELECT id FROM products;");
    await task.getByRole("button", { name: "Проверить" }).click();
    const ask = task.getByRole("button", { name: "Спросить, что не так" });
    await expect(ask).toBeVisible({ timeout: 30_000 });
    await setAssist(page, { enabled: false });
    await ask.focus();
    await page.keyboard.press("Enter");
    await expect(task.getByTestId("sql-hint")).toHaveCount(0);
    const result = task.getByTestId("ex-result");
    await expect(result).toBeFocused();
    await expect(result).toHaveText(
      "Пока не совпадает. Колонок у вас 1, а нужно 3.",
    );
  });

  for (const size of [
    { name: "desktop", viewport: { width: 1440, height: 900 } },
    { name: "phone (360 px)", viewport: { width: 360, height: 780 } },
  ]) {
    test(`open helpers have no accessibility violations, ${size.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(size.viewport);
      await signIn(page, "reader", "/books/nodejs-internals/1");
      const panel = await openPanel(page);
      await panel.getByRole("radio", { name: "Проще" }).click();
      await expect(panel.getByTestId("assist-answer")).toContainText("Итог");
      const box = page.getByTestId("own-words");
      const field = box.getByRole("textbox", { name: "Ваше объяснение" });
      await hydrated(field);
      await field.fill(retelling);
      await box.getByRole("button", { name: "Проверить понимание" }).click();
      await expect(box.getByTestId("understanding-score")).toBeVisible();
      await expectAccessible(
        page,
        `node chapter 1 with the assistant, ${size.name}`,
      );
      await expectNothingCutOff(page, `assistant, ${size.name}`);

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
      await expectAccessible(page, `sql task hint, ${size.name}`);
      await expectNothingCutOff(page, `sql task hint, ${size.name}`);
    });
  }

  test("nothing moves while an answer streams in", async ({ page }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const panel = await openPanel(page);
    await settle(page);
    await injectFault(page, { route: "assist", mode: "delay", delayMs: 350 });
    const before = await layoutShift(page);
    await panel.getByRole("radio", { name: "Глубже" }).click();
    await expect(panel.getByTestId("assist-answer")).toContainText(
      "Итог: порядок задаёт цикл событий.",
      { timeout: 10_000 },
    );
    await expect(
      panel.getByRole("button", { name: "Ещё вариант" }),
    ).toBeVisible();
    await page.waitForTimeout(300);
    expect((await layoutShift(page)) - before).toBeLessThan(0.005);
  });
});
