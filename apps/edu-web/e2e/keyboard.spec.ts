import type { Locator, Page } from "@playwright/test";
import { blocksOf, text } from "./support/books.ts";
import { expect, hydrated, signIn, test } from "./support/fixtures.ts";

/*
 * The order and sort exercises from the keyboard alone: Tab to move, Enter
 * or Space to choose. Focus must follow the items as they move between
 * the columns, so the reader never has to reach for the mouse.
 */

const isFocused = (locator: Locator) =>
  locator.evaluate((node) => node === document.activeElement);

/** Presses Tab (or Shift+Tab) until `target` has focus. */
async function tabTo(page: Page, target: Locator, backwards = false) {
  for (let step = 0; step < 40; step++) {
    if (await isFocused(target)) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
  }
  throw new Error("the target never took focus");
}

test.describe("keyboard only", () => {
  test("an order exercise: pick every item in order, then try again", async ({
    page,
  }) => {
    // Chapter 2 is the first with an order exercise: a subscriber reads it.
    const data = blocksOf("nodejs-internals", 2, "order")[0];
    if (!data) throw new Error("no order exercise in chapter 2");
    await signIn(page, "subscriber", "/books/nodejs-internals/2");
    const exercise = page.locator(".order").first();
    const pool = exercise.locator(".order-column").first();
    await hydrated(pool.locator(".order-item").first());
    await pool.locator(".order-item").first().focus();
    for (const item of data.items) {
      // Focus stays in the options: the item is ahead of it or behind it.
      const texts = await pool.locator(".order-text").allTextContents();
      const index = texts.indexOf(text(item));
      const current = await pool
        .locator(".order-item")
        .evaluateAll((nodes) =>
          nodes.indexOf(document.activeElement as HTMLElement),
        );
      await tabTo(
        page,
        pool.locator(".order-item").nth(index),
        index < current,
      );
      await page.keyboard.press("Enter");
    }
    await expect(exercise.getByTestId("ex-result")).toHaveText(
      "Всё на своих местах",
    );
    const again = exercise.getByRole("button", { name: "Ещё раз" });
    await expect(again).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(exercise.locator(".order-column").last()).toContainText(
      "Нажимайте на варианты по порядку",
    );
    await expect(pool.locator(".order-item").first()).toBeFocused();
  });

  test("a sort exercise: choose every bucket with Tab and Space", async ({
    page,
  }) => {
    const data = blocksOf("nodejs-internals", 1, "sort")[0];
    if (!data) throw new Error("no sort exercise in chapter 1");
    await signIn(page, "reader", "/books/nodejs-internals/1");
    const exercise = page.locator(".sort").first();
    const rows = exercise.locator(".sort-row");
    await hydrated(rows.first().locator(".sort-bucket").first());
    await rows.first().locator(".sort-bucket").first().focus();
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const shown = (await row.locator(".sort-item").textContent()) ?? "";
      const item = data.items.find((candidate) => text(candidate.c) === shown);
      const bucket = data.buckets.find((b) => b.key === item?.key);
      if (!bucket) throw new Error(`no bucket for ${shown}`);
      await tabTo(
        page,
        row.getByRole("button", { name: text(bucket.c), exact: true }),
      );
      await page.keyboard.press("Space");
    }
    await expect(exercise.getByTestId("ex-result")).toHaveText(
      `С первой попытки: ${count} из ${count}`,
    );
    await expect(exercise.locator(".ex-solved")).toHaveText("решено");
  });
});
