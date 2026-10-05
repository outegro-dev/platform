import { cardsOf } from "@outegro/edu-engine";
import { book } from "./support/books.ts";
import { expect, signIn, test } from "./support/fixtures.ts";

const node = book("nodejs-internals");
const openCards = cardsOf(node.chapters[0] ?? { blocks: [] }).length;
const allCards = node.chapters.reduce(
  (sum, chapter) => sum + cardsOf(chapter).length,
  0,
);

test.describe("flash card deck", () => {
  test("know and again are counted and saved", async ({ page }) => {
    await signIn(page, "reader", "/books/nodejs-internals/cards");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      node.deck.title,
    );
    const know = page.getByTestId("deck-know");
    const again = page.getByTestId("deck-again");
    const fresh = page.getByTestId("deck-new");
    // The reader opens chapter 1 only: its cards, and a note on the rest.
    await expect(fresh).toHaveText(String(openCards));
    await expect(page.locator(".deck-locked")).toContainText(
      `${allCards - openCards} more cards are in chapters you cannot open yet.`,
    );

    await page.getByRole("button", { name: "Показать ответ" }).click();
    await expect(page.locator(".deck-answer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Знаю" })).toBeFocused();
    await page.getByRole("button", { name: "Знаю" }).click();
    await expect(know).toHaveText("1");
    await expect(fresh).toHaveText(String(openCards - 1));
    await expect(page.locator(".deck-answer")).toHaveCount(0);
    await expect(page.locator(".deck-source")).toContainText(
      `карточка 2 из ${openCards}`,
    );

    await page.getByRole("button", { name: "Показать ответ" }).click();
    await page.getByRole("button", { name: "Ещё раз" }).last().click();
    await expect(again).toHaveText("1");
    await expect(page.getByTestId("save-status")).toHaveText(
      "Сохранено в аккаунте",
    );

    await page.reload();
    await expect(know).toHaveText("1");
    await expect(again).toHaveText("1");
    // "Again" alone: the one card marked so.
    // The sets are one choice (kit toggle group: radio buttons).
    await page
      .getByRole("radiogroup", { name: "Какие карточки показывать" })
      .getByRole("radio", { name: "Ещё раз" })
      .click();
    await expect(page.locator(".deck-source")).toContainText("карточка 1 из 1");
  });

  test("signed out, the deck asks to sign in", async ({ page }) => {
    await page.goto("/books/sql-internals/cards");
    await expect(page.getByTestId("chapter-gate")).toContainText(
      "Sign in to read",
    );
  });
});
