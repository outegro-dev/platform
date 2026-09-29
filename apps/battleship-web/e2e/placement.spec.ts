import type { Locator, Page } from "@playwright/test";
import {
  expect,
  signInAndConnect,
  startBotGame,
  test,
} from "./support/fixtures.ts";

const cell = (page: Page, x: number, y: number) =>
  page
    .getByTestId("placement-board")
    .locator(`button[data-x="${x}"][data-y="${y}"]`);

/** Drags with the mouse from a point of `from` to the centre of `to`. */
async function drag(page: Page, from: Locator, to: Locator, grabX = 20) {
  const source = await from.boundingBox();
  const target = await to.boundingBox();
  if (!source || !target) throw new Error("not visible");
  await page.mouse.move(source.x + grabX, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
}

test.describe("fleet placement", () => {
  test.beforeEach(async ({ page, game }) => {
    await signInAndConnect(page, game, "free");
    await startBotGame(page);
  });

  test("random fleet, ready, and the opponent's readiness", async ({
    page,
    game,
  }) => {
    const fake = await game.current();
    fake.script.opponentPlaceDelayMs = 1500;
    await expect(page.getByTestId("opponent-status")).toHaveText(
      "Opponent is placing ships…",
    );
    await expect(page.getByTestId("ready")).toBeDisabled();
    await page.getByTestId("random-fleet").click();
    await expect(page.getByTestId("placement-status")).toHaveText(
      "All ships are on the board.",
    );
    await page.getByTestId("ready").click();
    await expect(page.getByTestId("fleet-deployed")).toHaveText(
      "Fleet deployed. Waiting for your opponent…",
    );
    await expect(page.getByTestId("battle")).toBeVisible();
    const placed = fake.received.find(
      (message) => message.type === "fleet.place",
    );
    expect(
      (placed?.payload as { ships: unknown[] } | undefined)?.ships,
    ).toHaveLength(10);
  });

  test("drag a ship from the tray onto the board", async ({ page }) => {
    await drag(page, page.getByTestId("tray-ship-0"), cell(page, 2, 3));
    for (const x of [2, 3, 4, 5]) {
      await expect(cell(page, x, 3)).toHaveAccessibleName(/, 4-cell ship$/);
    }
    await expect(cell(page, 6, 3)).toHaveAccessibleName("G4, empty");
    await expect(page.getByTestId("placement-status")).toHaveText(
      "4-cell ship placed at C4, horizontal.",
    );
    // Dragging a placed ship moves it.
    await drag(page, cell(page, 2, 3), cell(page, 2, 8), 10);
    await expect(cell(page, 2, 8)).toHaveAccessibleName(/, 4-cell ship$/);
    await expect(cell(page, 2, 3)).toHaveAccessibleName("C4, empty");
  });

  test("a drop that breaks the rules is refused with the reason", async ({
    page,
  }) => {
    await drag(page, page.getByTestId("tray-ship-0"), cell(page, 0, 0));
    await expect(cell(page, 0, 0)).toHaveAccessibleName("A1, 4-cell ship");
    await drag(page, page.getByTestId("tray-ship-1"), cell(page, 1, 1));
    await expect(page.getByTestId("placement-status")).toHaveText(
      "Ships can't touch, not even at the corners.",
    );
    await expect(page.getByTestId("tray-ship-1")).toHaveAccessibleName(
      "3-cell ship, not placed",
    );
    await expect(cell(page, 1, 1)).toHaveAccessibleName("B2, empty");
  });

  test("keyboard: arrows move, R rotates, Enter places, Delete lifts", async ({
    page,
  }) => {
    await cell(page, 0, 0).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect(cell(page, 2, 1)).toBeFocused();
    await page.keyboard.press("r");
    await page.keyboard.press("Enter");
    for (const y of [1, 2, 3, 4]) {
      await expect(cell(page, 2, y)).toHaveAccessibleName(/, 4-cell ship$/);
    }
    await expect(page.getByTestId("placement-status")).toHaveText(
      "4-cell ship placed at C2, vertical.",
    );
    await page.keyboard.press("Delete");
    await expect(cell(page, 2, 1)).toHaveAccessibleName("C2, empty");
    // Off the board: the reason is announced and nothing is placed.
    await page.keyboard.press("r");
    for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("placement-status")).toHaveText(
      "That position runs off the board.",
    );
  });

  test("tap to place: pick a ship in the tray, then a cell", async ({
    page,
  }) => {
    await page.getByTestId("tray-ship-3").click();
    await expect(page.getByTestId("tray-ship-3")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await cell(page, 5, 5).click();
    await expect(cell(page, 5, 5)).toHaveAccessibleName("F6, 2-cell ship");
    await expect(cell(page, 6, 5)).toHaveAccessibleName("G6, 2-cell ship");
    // Tapping the selected ship again turns it.
    await cell(page, 5, 5).click();
    await cell(page, 5, 5).click();
    await expect(cell(page, 5, 6)).toHaveAccessibleName("F7, 2-cell ship");
  });
});
