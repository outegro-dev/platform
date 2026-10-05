import { exerciseIdsOf } from "@outegro/edu-engine";
import type { Page } from "@playwright/test";
import { blocksOf, chapter, text } from "./support/books.ts";
import { expect, hydrated, SITE, signIn, test } from "./support/fixtures.ts";

const first = chapter("nodejs-internals", 1);
const third = chapter("nodejs-internals", 3);

/** Answers the first quiz of Node chapter 1 right (or wrong) as the book says. */
async function answerFirstQuiz(page: Page, right: boolean) {
  const data = blocksOf("nodejs-internals", 1, "quiz")[0];
  if (!data) throw new Error("no quiz in chapter 1");
  const quiz = page.locator(".quiz").first();
  const options = quiz.locator(".quiz-option");
  const multiple = new Set(data.answer).size > 1;
  const wrong = data.options.findIndex(
    (_, index) => !data.answer.includes(index),
  );
  const picks = right ? data.answer : [wrong];
  for (const index of picks) await options.nth(index).click();
  if (multiple) await quiz.getByRole("button", { name: "Проверить" }).click();
  return quiz;
}

test.describe("reading", () => {
  test("chapter 1 is a preview the reader can read", async ({ page }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const article = page.locator("article.book-article");
    await expect(article).toHaveAttribute("lang", "ru");
    await expect(article.getByRole("heading", { level: 1 })).toHaveText(
      first.title,
    );
    // Sections become h2 under the chapter's h1, with their anchors.
    const section = first.blocks.find((block) => block.t === "h3");
    if (section?.t !== "h3") throw new Error("no section");
    await expect(article.locator(`h2#${section.id}`)).toBeVisible();
    // A diagram, code with a copy button, exercises in the book's language.
    await expect(article.locator(".figure svg").first()).toHaveAttribute(
      "role",
      "img",
    );
    await expect(article.locator(".code-block").first()).toContainText(
      "Копировать",
    );
    await expect(article.locator(".quiz").first()).toContainText(
      "Проверь себя",
    );
    // The contents: this chapter's sections, locks on the others.
    const toc = page.locator(".toc-aside");
    await expect(toc.getByRole("link", { name: /Устройство/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      toc.getByRole("link", { name: /Асинхронность.*locked/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Chapters" }),
    ).toContainText("02");
  });

  test("chapter 3 is locked for the reader: why, and how to get access", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/3");
    const gate = page.getByTestId("chapter-gate");
    await expect(gate.getByRole("heading", { level: 1 })).toHaveText(
      third.title,
    );
    await expect(gate.getByRole("heading", { level: 2 })).toHaveText(
      "This chapter comes with full access",
    );
    await expect(gate).toContainText("Chapter 1 is open to you.");
    await expect(gate).toContainText("access is granted by invitation");
    await expect(gate.getByTestId("access-offer")).toHaveAttribute(
      "href",
      `${SITE}/#contact`,
    );
    await expect(
      gate.getByRole("link", { name: "Read chapter 1" }),
    ).toHaveAttribute("href", "/books/nodejs-internals/1");
    await expect(page.locator(".quiz")).toHaveCount(0);
  });

  test("a subscriber reads chapter 3", async ({ page }) => {
    await signIn(page, "subscriber", "/books/nodejs-internals/3");
    await expect(page.getByTestId("chapter-gate")).toHaveCount(0);
    await expect(
      page.locator("article.book-article").getByRole("heading", { level: 1 }),
    ).toHaveText(third.title);
    const quiz = page.locator(".quiz").first();
    await quiz.locator(".quiz-option").first().click();
    const check = quiz.getByRole("button", { name: "Проверить" });
    if (await check.isVisible()) await check.click();
    await expect(quiz.locator(".quiz-option[data-mark]").first()).toBeVisible();
    // On to chapter 4 in the page (client navigation): a fresh chapter.
    await page
      .getByRole("navigation", { name: "Chapters" })
      .getByRole("link", { name: /Next/ })
      .click();
    await expect(
      page.locator("article.book-article").getByRole("heading", { level: 1 }),
    ).toHaveText(chapter("nodejs-internals", 4).title);
    await expect(page.locator(".quiz-option[data-mark]")).toHaveCount(0);
    await expect(page.locator(".simulator")).toBeVisible();
  });

  test("staff read every chapter of every book", async ({ page }) => {
    await signIn(page, "staff", "/books/sql-internals/13");
    await expect(page.getByTestId("chapter-gate")).toHaveCount(0);
    await expect(
      page.locator("article.book-article").getByRole("heading", { level: 1 }),
    ).toHaveText(chapter("sql-internals", 13).title);
  });

  test("a quiz answer is saved: solved after a reload", async ({ page }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const quiz = await answerFirstQuiz(page, true);
    await expect(quiz.locator(".ex-result")).toHaveText("Верно.");
    await expect(quiz.locator(".ex-solved")).toHaveText("решено");
    // The book is Russian: so are its exercises, statuses included.
    await expect(quiz.getByTestId("save-status")).toHaveText(
      "Сохранено в аккаунте",
    );
    await expect(quiz.locator(".why")).toContainText("Разбор");
    // The contents count it at once.
    await expect(
      page.locator(".toc-aside").getByRole("link", { name: /Устройство/ }),
    ).toContainText(`1/${exerciseIdsOf(first).length}`);

    await page.reload();
    const again = page.locator(".quiz").first();
    await expect(again.locator(".ex-solved")).toHaveText("решено");
    await expect(again.locator(".why")).toHaveCount(0);
  });

  test("a wrong answer shows the right one and the explanation; retry resets", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const quiz = await answerFirstQuiz(page, false);
    await expect(quiz.locator(".quiz-option[data-mark='wrong']")).toHaveCount(
      1,
    );
    await expect(
      quiz.locator(".quiz-option[data-mark='missed']").first(),
    ).toBeVisible();
    await expect(quiz.locator(".why")).toBeVisible();
    await expect(quiz.locator(".ex-solved")).toHaveText("");
    await quiz.getByRole("button", { name: "Ответить заново" }).click();
    await expect(quiz.locator(".quiz-option[data-mark]")).toHaveCount(0);
    await expect(quiz.locator(".why")).toHaveCount(0);
    await expect(quiz.locator(".quiz-option").first()).toBeFocused();
  });

  test("a sort exercise scores the first choice of every item", async ({
    page,
  }) => {
    const data = blocksOf("nodejs-internals", 1, "sort")[0];
    if (!data) throw new Error("no sort in chapter 1");
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const sort = page.locator(".sort").first();
    const rows = sort.locator(".sort-row");
    await expect(rows).toHaveCount(data.items.length);
    for (let i = 0; i < data.items.length; i++) {
      const row = rows.nth(i);
      const shown = (await row.locator(".sort-item").textContent()) ?? "";
      const item = data.items.find((candidate) => text(candidate.c) === shown);
      const bucket = data.buckets.find(
        (candidate) => candidate.key === item?.key,
      );
      if (!bucket) throw new Error(`no bucket for ${shown}`);
      await row
        .getByRole("button", { name: text(bucket.c), exact: true })
        .click();
    }
    await expect(sort.locator(".ex-result")).toHaveText(
      `С первой попытки: ${data.items.length} из ${data.items.length}`,
    );
    await expect(sort.locator(".ex-solved")).toHaveText("решено");
  });

  test("the reading position is remembered; continuing starts past chapter 1", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    // The position is saved once the page runs (hydrated).
    const saved = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.headers()["next-action"] !== undefined,
    );
    await hydrated(page.locator(".flash-card").first());
    await saved;
    await page.goto("/books/nodejs-internals");
    // Chapter 1 is where every reader starts: no "continue" for it (the
    // book pages' own rule); chapter 2 on is offered (parity.spec).
    await expect(page.getByTestId("book-cta")).toHaveText(
      "Start with chapter 1",
    );
    await expect(page.locator(".continue-note")).toHaveCount(0);
  });

  test("explanations from different angles remember the preferred view", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const explain = page.locator(".explain").first();
    await expect(explain.getByRole("tab", { selected: true })).toHaveText(
      "На пальцах",
    );
    await explain.getByRole("tab", { name: "В коде" }).click();
    await expect(explain.getByRole("tabpanel")).toBeVisible();
    // Arrow keys move between the views (Radix tabs).
    await page.keyboard.press("ArrowRight");
    await expect(explain.getByRole("tab", { selected: true })).toHaveText(
      "На собесе",
    );
    await page.waitForTimeout(500);
    await page.reload();
    await expect(
      page.locator(".explain").first().getByRole("tab", { selected: true }),
    ).toHaveText("На собесе");
  });

  test("on a phone the contents fold above the chapter", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, "reader", "/books/nodejs-internals/1");
    await expect(page.locator(".toc-aside")).toBeHidden();
    const toc = page.locator(".toc-disclosure");
    await expect(toc.locator("summary")).toContainText("Chapter 1: Устройство");
    await expect(toc.getByRole("link", { name: /Модули/ })).toBeHidden();
    await toc.locator("summary").click();
    await toc.getByRole("link", { name: /Модули/ }).click();
    await page.waitForURL(/\/books\/nodejs-internals\/2$/);
    await expect(page.getByTestId("chapter-gate")).toBeVisible();
  });

  test("flash cards turn over; a card keeps its name, says whether it is turned and shows the answer as text", async ({
    page,
  }) => {
    const flash = blocksOf("nodejs-internals", 1, "cards")[0]?.cards[0];
    if (!flash) throw new Error("no flash cards in chapter 1");
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const item = page.locator(".flash-item").first();
    const card = item.getByRole("button");
    await expect(card).toHaveAccessibleName(text(flash.front));
    await expect(card).toHaveAttribute("aria-expanded", "false");
    await expect(item.locator(".flash-back")).toBeHidden();
    await card.scrollIntoViewIfNeeded();
    const size = await card.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expect(card).toHaveAccessibleName(text(flash.front));
    const answer = item.locator(".flash-back");
    await expect(answer).toBeVisible();
    await expect(answer).toContainText(text(flash.back));
    // Turned, the card keeps its size; a click on the answer turns it back.
    expect(
      await card.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    ).toEqual(size);
    // A real click on the answer's place (the answer lets it through to
    // the button underneath, so Playwright's own target check would balk).
    await answer.click({ force: true });
    await expect(card).toHaveAttribute("aria-expanded", "false");
    // From the keyboard: Enter turns it.
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(card).toHaveAttribute("aria-expanded", "true");
  });

  test("the contents say each chapter's solved count in words", async ({
    page,
  }) => {
    const total = exerciseIdsOf(first).length;
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const toc = page.locator(".toc-aside");
    await expect(
      toc.getByRole("link", { name: /Устройство/ }),
    ).toHaveAccessibleName(new RegExp(`Устройство.*0 of ${total} solved`));
    await expect(
      toc.getByRole("link", { name: /Flash cards/ }),
    ).toHaveAccessibleName(/Flash cards.*0 of \d+ known/);
    // In the interface's language, as the rest of the contents.
    await page.getByRole("button", { name: "RU — Русский" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(
      toc.getByRole("link", { name: /Устройство/ }),
    ).toHaveAccessibleName(new RegExp(`Устройство.*решено 0 из ${total}`));
  });
});
