import { blocksOf, text } from "./support/books.ts";
import { expect, hydrated, signIn, test } from "./support/fixtures.ts";

/*
 * What the original book pages did and edu-web now does too: sandboxes
 * that run by themselves, counters, copy guidance, the folding contents,
 * the ways into a book, shuffles per visit, anchors and the section in
 * view.
 */

const nodeSections = blocksOf("nodejs-internals", 1, "h3");

test.describe("SQL sandboxes run by themselves", () => {
  test("once one comes near the screen; the engine is not fetched before", async ({
    page,
  }) => {
    // A short screen: the first sandbox is well below it at first.
    await page.setViewportSize({ width: 1280, height: 400 });
    const workers: string[] = [];
    page.on("worker", (worker) => workers.push(worker.url()));
    await signIn(page, "reader", "/books/sql-internals/1");
    const sandbox = page.locator(".sandbox").first();
    await hydrated(sandbox.getByRole("button", { name: "Выполнить" }));
    await page.waitForTimeout(800);
    expect(workers).toEqual([]);
    await expect(sandbox.locator(".sql-table")).toHaveCount(0);
    // Its output box is there from the start: nothing moves when it fills.
    const box = await sandbox.locator(".sandbox-output").boundingBox();
    expect(box?.height).toBeGreaterThan(300);

    await sandbox.scrollIntoViewIfNeeded();
    const table = sandbox.locator(".sql-table");
    await expect(table).toBeVisible({ timeout: 30_000 });
    expect(workers).toHaveLength(1);
    await expect(sandbox.locator(".sql-count")).toHaveText("10 строк");
    // Its own first run is not announced; the reader's runs are.
    await expect(sandbox.getByRole("status")).toHaveText("");
    await sandbox.getByRole("button", { name: "Выполнить" }).click();
    await expect(sandbox.getByRole("status")).toHaveText("10 строк");
  });

  test("one inside an explanation runs when its tab is first shown", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/sql-internals/1");
    const explain = page.locator(".explain").filter({
      has: page.locator(".explain-topic", { hasText: "Первичный ключ" }),
    });
    await explain.scrollIntoViewIfNeeded();
    await hydrated(explain.getByRole("tab").first());
    const sandbox = explain.locator(".sandbox");
    await page.waitForTimeout(600);
    await expect(sandbox.locator(".sql-table")).toHaveCount(0);
    await explain.getByRole("tab", { name: "В коде" }).click();
    await expect(sandbox.locator(".sql-table")).toBeVisible({
      timeout: 30_000,
    });
    await expect(sandbox.locator(".sql-count")).toHaveText("3 строки");
  });
});

test.describe("counters", () => {
  test("the contents count the cards known; the book counts its topics", async ({
    page,
  }) => {
    await signIn(page, "reader", "/books/nodejs-internals/cards");
    const deckLink = page
      .locator(".toc-aside")
      .getByRole("link", { name: "Flash cards" });
    await expect(deckLink).toContainText("0/122");
    await page.getByRole("button", { name: "Показать ответ" }).click();
    await page.getByRole("button", { name: "Знаю" }).click();
    await expect(deckLink).toContainText("1/122");
    await page.goto("/books/nodejs-internals");
    await expect(page.locator(".book-hero .book-stats")).toContainText(
      "65 topics from different angles",
    );
  });
});

test.describe("copying code", () => {
  test("a copy the clipboard refuses says how to copy by hand", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
    });
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const head = page.locator(".code-block").first().locator(".code-head");
    const copy = head.getByRole("button");
    await hydrated(copy);
    await expect(copy).toHaveAccessibleName("Копировать");
    await copy.click();
    await expect(copy).toHaveAccessibleName(
      "Не скопировалось — выделите код вручную",
    );
    await expect(head.getByRole("status")).toContainText(
      "Не скопировалось — выделите код вручную",
    );
  });
});

test.describe("the folded contents on a phone", () => {
  test("fold again once a link in them is chosen, and the section lands at the top", async ({
    page,
  }) => {
    const second = nodeSections[1];
    if (!second) throw new Error("no second section");
    await page.setViewportSize({ width: 360, height: 780 });
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const toc = page.locator(".toc-disclosure");
    await hydrated(toc);
    await toc.locator("summary").click();
    expect(
      await toc.evaluate((node) => (node as HTMLDetailsElement).open),
    ).toBe(true);
    await toc.getByRole("link", { name: text(second.c) }).click();
    await expect(page).toHaveURL(new RegExp(`#${second.id}$`));
    expect(
      await toc.evaluate((node) => (node as HTMLDetailsElement).open),
    ).toBe(false);
    await expect
      .poll(() =>
        page
          .locator(`#${second.id}`)
          .evaluate((node) => Math.round(node.getBoundingClientRect().top)),
      )
      .toBeLessThan(60);
    // A chapter link folds them too.
    await toc.locator("summary").click();
    await toc.getByRole("link", { name: /Модули/ }).click();
    await page.waitForURL(/\/books\/nodejs-internals\/2$/);
    await expect(page.locator(".toc-disclosure")).not.toHaveAttribute(
      "open",
      /.*/,
    );
  });
});

test.describe("the book page", () => {
  test("start with chapter 1 and the cards; continue only past chapter 1", async ({
    page,
  }) => {
    await signIn(page, "subscriber", "/books/nodejs-internals");
    const cta = page.getByTestId("book-cta");
    await expect(cta).toHaveText("Start with chapter 1");
    await expect(cta).toHaveAttribute("href", "/books/nodejs-internals/1");
    await expect(page.getByTestId("book-deck")).toHaveText(
      "Flash cards for review",
    );
    await expect(page.getByTestId("book-deck")).toHaveAttribute(
      "href",
      "/books/nodejs-internals/cards",
    );
    await expect(page.getByTestId("book-start")).toHaveCount(0);
    // The assistant is on: the book says where its helpers are.
    await expect(page.getByTestId("assist-note")).toHaveAttribute("lang", "ru");
    await expect(page.getByTestId("assist-note")).toContainText(
      "Под каждым заголовком раздела есть кнопка «Объясни иначе»",
    );

    // Chapter 2 opened: continue there; chapter 1 is a second way in.
    const saved = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.headers()["next-action"] !== undefined,
    );
    await page.goto("/books/nodejs-internals/2");
    await hydrated(page.locator(".quiz-option").first());
    await saved;
    await expect(async () => {
      await page.goto("/books/nodejs-internals");
      await expect(cta).toHaveText("Continue: chapter 2", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(cta).toHaveAttribute("href", "/books/nodejs-internals/2");
    await expect(page.getByTestId("book-start")).toHaveText(
      "Start with chapter 1",
    );
    await expect(page.locator(".continue-note")).toContainText(
      "Chapter 2. Модули",
    );
  });
});

test.describe("shuffles", () => {
  test("an exercise and the deck start in a new order on every visit", async ({
    page,
  }) => {
    await signIn(page, "subscriber", "/books/nodejs-internals/1");
    const sorts = new Set<string>();
    for (let visit = 0; visit < 3; visit++) {
      if (visit) await page.reload();
      const items = page.locator(".sort").first().locator(".sort-item");
      await hydrated(items.first());
      sorts.add((await items.allTextContents()).join("|"));
    }
    expect(sorts.size).toBeGreaterThan(1);

    const firstCards = new Set<string>();
    for (let visit = 0; visit < 3; visit++) {
      await page.goto("/books/nodejs-internals/cards");
      const question = page.locator(".deck-question");
      await hydrated(page.getByRole("button", { name: "Показать ответ" }));
      firstCards.add((await question.textContent()) ?? "");
    }
    expect(firstCards.size).toBeGreaterThan(1);
  });
});

test.describe("anchors and the section in view", () => {
  test("an exercise has its id as an anchor; the contents mark the section being read", async ({
    page,
  }) => {
    const quiz = blocksOf("nodejs-internals", 1, "quiz")[0];
    const third = nodeSections[2];
    if (!quiz || !third) throw new Error("no quiz or third section");
    await signIn(page, "reader", "/");
    // A link from elsewhere straight to the exercise.
    await page.goto(`/books/nodejs-internals/1#${quiz.id}`);
    const frame = page.locator(`#${quiz.id}`);
    await expect(frame).toHaveClass(/exercise/);
    await expect
      .poll(() =>
        frame.evaluate((node) => Math.round(node.getBoundingClientRect().top)),
      )
      .toBeLessThan(60);

    const current = page.locator(
      ".toc-aside .toc-sections a[aria-current='location']",
    );
    await page
      .locator(`#${third.id}`)
      .evaluate((node) =>
        node.scrollIntoView({ block: "start", behavior: "instant" }),
      );
    await expect(current).toHaveText(text(third.c));
    await expect(current).toHaveCount(1);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(current).toHaveCount(0);
  });
});
