import type { Locator, Page } from "@playwright/test";
import {
  deployRandomFleet,
  expect,
  fireAt,
  signInAndConnect,
  startBotGame,
  test,
} from "./support/fixtures.ts";

const key = (page: Page) => page.getByTestId("board-legend");
const item = (legend: Locator, mark: string) =>
  legend.locator(`[data-mark="${mark}"]`);

/** Items of the key in order: what each one says. */
async function texts(legend: Locator) {
  return legend.locator(".legend-item").allInnerTexts();
}

test.describe("board key", () => {
  test("placement: every mark of the fleet editor, drawn like the board", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free");
    await startBotGame(page);
    const legend = key(page);
    await expect(
      legend.getByRole("heading", { name: "Board key" }),
    ).toBeVisible();
    // Wide screens show it all: no toggle.
    await expect(page.getByTestId("legend-toggle")).toBeHidden();
    expect(await texts(legend)).toEqual([
      "Your ship: drag it to move",
      "Selected: click or tap it again to turn it",
      "Fits here",
      "Can't go here: off the board, on or next to a ship",
      "Orientation: horizontal · R or Rotate turns it",
    ]);
    await expect(item(legend, "placed").locator(".ship")).toHaveAttribute(
      "data-state",
      "idle",
    );
    await expect(
      item(legend, "selected").locator(".ship-selected"),
    ).toHaveCount(1);
    await expect(
      item(legend, "fits").locator(".preview-cell:not([data-bad])"),
    ).toHaveCount(2);
    await expect(
      item(legend, "blocked").locator(".preview-cell[data-bad]"),
    ).toHaveCount(2);

    // The orientation follows R.
    await page.keyboard.press("r");
    await expect(item(legend, "turn")).toHaveText(
      "Orientation: vertical · R or Rotate turns it",
    );
    await expect(item(legend, "turn").locator(".ship")).toHaveAttribute(
      "data-orientation",
      "vertical",
    );

    // The board shows the same pieces: a picked ship gets the frame, a
    // spot that breaks the rules is hatched.
    const board = page.getByTestId("placement-board");
    const cell = (x: number, y: number) =>
      board.locator(`button[data-x="${x}"][data-y="${y}"]`);
    await page.keyboard.press("r");
    await cell(2, 3).click();
    await expect(board.locator(".ship-selected")).toHaveCount(0);
    await cell(2, 3).click();
    await expect(board.locator(".ship-selected")).toHaveCount(1);
    await page.getByTestId("tray-ship-1").click();
    await expect(board.locator(".ship-selected")).toHaveCount(0);
    await cell(3, 4).hover();
    await expect(board.locator(".preview-cell[data-bad]")).toHaveCount(3);
    await cell(3, 7).hover();
    await expect(board.locator(".preview-cell:not([data-bad])")).toHaveCount(3);
  });

  test("battle and result: every mark, in the player's own look", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await startBotGame(page);
    await deployRandomFleet(page);
    const legend = key(page);
    await expect(
      legend.getByRole("heading", { name: "Board key" }),
    ).toBeVisible();
    expect(await texts(legend)).toEqual([
      "Your ship",
      "Your ship, hit",
      "Miss: open water",
      "Hit: a ship is there",
      "Ship sunk",
      "Water around a sunk ship: no ship can be there",
      "Latest shot",
    ]);
    // Same pieces as the boards, in this player's classic skin and flames.
    await expect(item(legend, "ship").locator(".ship")).toHaveAttribute(
      "data-skin",
      "classic",
    );
    await expect(
      item(legend, "ship-hit").locator('.mark[data-kind="hit"] .flame'),
    ).toHaveCount(1);
    await expect(
      item(legend, "miss").locator('.mark[data-kind="miss"] .mark-dot'),
    ).toHaveCount(1);
    await expect(
      item(legend, "hit").locator('.mark[data-kind="hit"]'),
    ).toHaveCount(1);
    await expect(
      item(legend, "sunk").locator('.ship[data-state="wreck"]'),
    ).toHaveCount(1);
    await expect(
      item(legend, "around").locator('.mark[data-kind="miss"]'),
    ).toHaveCount(2);
    await expect(item(legend, "last").locator(".shot-marker")).toHaveCount(1);
    await expect(legend.locator(".legend-swatch[data-sea]")).toHaveCount(0);

    const target = fake.enemyCells()[0];
    if (target) await fireAt(page, target.x, target.y);
    await page.getByRole("button", { name: "Resign" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Resign" })
      .click();
    await expect(page.getByTestId("result")).toBeVisible();
    // After the match the enemy fleet shows: the key explains it too.
    await expect(item(key(page), "afloat")).toHaveText(
      "Enemy ship left afloat, shown after the match",
    );
    await expect(
      item(key(page), "afloat").locator('.ship[data-state="ghost"]'),
    ).toHaveCount(1);
  });

  test("in Russian, on the night sea with silver ships and shards", async ({
    page,
    game,
    context,
  }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await signInAndConnect(page, game, "silver");
    await startBotGame(page, "Лёгкий");
    const legend = key(page);
    await expect(
      legend.getByRole("heading", { name: "Обозначения" }),
    ).toBeVisible();
    expect(await texts(legend)).toEqual([
      "Ваш корабль: перетащите, чтобы передвинуть",
      "Выбран: нажмите на него ещё раз, чтобы повернуть",
      "Встанет сюда",
      "Сюда нельзя: за краем, на корабле или вплотную к нему",
      "Положение: горизонтально · R или «Повернуть» меняет его",
    ]);
    await deployRandomFleet(page);
    expect(await texts(key(page))).toEqual([
      "Ваш корабль",
      "Ваш корабль подбит",
      "Промах: пустая вода",
      "Попадание: там корабль",
      "Корабль потоплен",
      "Вода вокруг потопленного: кораблей там нет",
      "Последний выстрел",
    ]);
    await expect(
      key(page).locator('.legend-swatch[data-sea="night"]'),
    ).toHaveCount(7);
    await expect(item(key(page), "ship").locator(".ship")).toHaveAttribute(
      "data-skin",
      "silver",
    );
    await expect(item(key(page), "hit").locator(".shards")).toHaveCount(1);
  });

  test("replays explain the same marks", async ({ page, game }) => {
    await signInAndConnect(page, game, "premium", "/profile");
    await page
      .getByTestId("history")
      .getByRole("link", { name: "Replay" })
      .first()
      .click();
    await expect(page.getByTestId("replay")).toBeVisible();
    expect(await texts(key(page))).toEqual([
      "Ship",
      "Ship, hit",
      "Miss: open water",
      "Ship sunk",
      "Water around a sunk ship: no ship can be there",
      "The move shown",
    ]);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the key is one line that opens and closes", async ({
      page,
      game,
    }) => {
      await signInAndConnect(page, game, "free");
      await startBotGame(page);
      const toggle = page.getByTestId("legend-toggle");
      const list = key(page).getByRole("list");
      await expect(toggle).toHaveText("What the marks mean");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(list).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(list).toBeVisible();
      await expect(item(key(page), "fits")).toHaveText("Fits here");
      await toggle.click();
      await expect(list).toBeHidden();

      await deployRandomFleet(page);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(item(key(page), "last")).toHaveText("Latest shot");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
    });
  });
});
