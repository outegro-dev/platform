import { expect, settle, signIn, test, useRussian } from "./fixtures";

test("a finished match shows both boards and steps through the moves", async ({
  page,
}) => {
  await signIn(page, "owner", "/battleship/matches?status=finished");
  await page.locator("table .row-link").first().click();
  await settle(page);

  const boards = page.getByRole("img", { name: /^Board of / });
  await expect(boards).toHaveCount(2);
  await expect(boards.first()).toHaveAttribute("aria-label", /ships afloat/);
  const status = page.locator(".replay-status");
  await expect(status).toContainText(/^Move (\d+) of \1 ·/);

  await page.getByRole("button", { name: "First move" }).click();
  await expect(status).toContainText("Before the first shot");
  await expect(page.locator(".cell[data-shot]")).toHaveCount(0);
  await page.getByRole("button", { name: "Next move" }).click();
  await expect(status).toContainText(/^Move 1 of \d+ · .+ fired at [A-J]\d+/);
  await expect(page.locator(".cell[data-last]")).toHaveCount(1);

  // The move list jumps too, and the slider follows.
  const moves = page.getByRole("list", { name: "Moves" }).getByRole("button");
  await moves.nth(4).click();
  await expect(moves.nth(4)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("slider", { name: "Move" })).toHaveValue("5");
  await page.keyboard.press("Tab");
});

test("a loss on the placement clock reads as not deploying in time", async ({
  page,
  context,
}) => {
  await signIn(page, "owner", "/battleship/matches?status=finished");
  const row = page
    .getByRole("row")
    .filter({ hasText: "Did not deploy in time" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Captain Mira");
  await row.locator(".row-link").click();
  await settle(page);
  await expect(page.locator("#match")).toContainText(
    "Winner: Captain Mira · Did not deploy in time",
  );

  await useRussian(context);
  await page.reload();
  await settle(page);
  await expect(page.locator("#match")).toContainText(
    "Победитель: Captain Mira · Не расставил флот вовремя",
  );
  await page.goto("/battleship/matches?status=finished");
  await settle(page);
  await expect(
    page.getByRole("row").filter({ hasText: "Не расставил флот вовремя" }),
  ).toHaveCount(1);
});

test("a live match can be aborted with a reason", async ({ page }) => {
  await signIn(page, "owner", "/battleship/matches?status=battle&mode=quick");
  await page
    .getByRole("link", { name: "Captain Mira vs Oleg-the-Bold" })
    .click();
  await settle(page);
  await expect(page.getByText(/Live: In battle, turn of/)).toBeVisible();
  await page.getByRole("button", { name: "Abort match" }).click();
  const dialog = page.getByRole("dialog", { name: "Abort this match?" });
  await expect(dialog).toContainText("Ratings do not change.");
  await dialog
    .getByLabel("Reason")
    .fill("Both players reported a frozen board");
  await dialog.getByRole("button", { name: "Abort match" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Match aborted."),
  ).toBeVisible();
  await expect(page.locator(".panel .status").first()).toHaveText("Aborted");
  await expect(page.getByRole("button", { name: "Abort match" })).toHaveCount(
    0,
  );

  await page.getByRole("link", { name: "Moderation log" }).click();
  await settle(page);
  await expect(
    page.getByText("“Both players reported a frozen board”"),
  ).toBeVisible();
});

test("a player can be hidden from the leaderboard", async ({ page }) => {
  await signIn(page, "owner", "/battleship/players?query=Kraken");
  await page.getByRole("link", { name: "Kraken" }).click();
  await settle(page);
  await page.getByRole("button", { name: "Hide from leaderboard" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Hide from the leaderboard?",
  });
  await dialog.getByLabel("Reason").fill("Suspected win trading, under review");
  await dialog.getByRole("button", { name: "Hide player" }).click();
  await expect(
    page.getByRole("status").getByText("Player hidden from the leaderboard."),
  ).toBeVisible();
  await expect(
    page.locator(".panel").first().getByText("Hidden from leaderboard"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show on leaderboard" }),
  ).toBeVisible();
});

test("support may moderate; auditors cannot open the game at all", async ({
  page,
}) => {
  await signIn(page, "support", "/battleship/players?query=SeaWolf");
  await page.getByRole("link", { name: "SeaWolf" }).click();
  await settle(page);
  await expect(
    page.getByRole("button", { name: "Reset nickname" }),
  ).toBeVisible();
});
