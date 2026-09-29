import {
  APP,
  expect,
  signIn,
  signInAndConnect,
  test,
} from "./support/fixtures.ts";

test.describe("leaderboard and profile", () => {
  test("leaderboard: all time, this week with points gained, and your place", async ({
    page,
  }) => {
    await signIn(page, "free", "/leaderboard");
    const table = page.getByTestId("leaderboard-table");
    await expect(table.locator("tbody tr")).toHaveCount(12);
    await expect(page.getByTestId("your-place")).toContainText("#9");
    await page.getByRole("tab", { name: "This week" }).click();
    await expect(page).toHaveURL(`${APP}/leaderboard?period=week`);
    await expect(table.locator("tbody tr")).toHaveCount(6);
    await expect(table.locator("tbody tr").first()).toContainText(
      "+64 this week",
    );
    await expect(page.getByText(/Since Sep 28, 2026/)).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "All time" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(table.locator("tbody tr")).toHaveCount(12);
  });

  test("a free player's profile: stats, locked heatmap and replays, paged history", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free", "/profile");
    await expect(page.getByTestId("profile-nickname")).toHaveText(
      "Sailor 4821",
    );
    const stats = page.getByTestId("stat-cards");
    await expect(stats).toContainText("Win rate58%");
    await expect(page.getByTestId("heatmap-locked")).toContainText(
      "The shot heatmap is part of Premium.",
    );
    const history = page.getByTestId("history");
    await expect(history.getByRole("listitem")).toHaveCount(10);
    await expect(
      history
        .getByRole("link", { name: /Replay: Replays are part of Premium/ })
        .first(),
    ).toHaveAttribute("href", "/shop");
    await page.getByTestId("load-more").click();
    await expect(history.getByRole("listitem")).toHaveCount(20);
    await page.getByTestId("load-more").click();
    await expect(history.getByRole("listitem")).toHaveCount(23);
    await expect(page.getByTestId("load-more")).toHaveCount(0);
  });

  test("Premium: the heatmap and the replay viewer", async ({ page, game }) => {
    await signInAndConnect(page, game, "premium", "/profile");
    await expect(
      page
        .getByTestId("heatmap-card")
        .getByRole("img", { name: "Shot heatmap" }),
    ).toBeVisible();
    await page
      .getByTestId("history")
      .getByRole("link", { name: "Replay" })
      .first()
      .click();
    await expect(page).toHaveURL(/\/replay\/[0-9a-f-]{36}$/);
    const step = page.getByTestId("replay-step");
    await expect(step).toHaveText(/Move 0 of \d+/);
    const marker = page.getByTestId("replay").locator(".shot-marker");
    await expect(marker).toHaveCount(0);
    await page.getByTestId("replay-next").click();
    await expect(step).toHaveText(/Move 1 of \d+/);
    await expect(
      page.getByText(/^You → [A-J]\d+: (miss|hit|sunk)$/),
    ).toBeVisible();
    // The move being shown is framed on its board.
    await expect(marker).toHaveCount(1);
    await page.getByRole("button", { name: "Last move" }).click();
    const total = Number((await step.textContent())?.match(/of (\d+)/)?.[1]);
    await expect(step).toHaveText(`Move ${total} of ${total}`);
  });

  test("replays are Premium: a free player gets the lock with a way to Premium", async ({
    page,
  }) => {
    await signIn(page, "free", "/replay/00000000-0000-4000-8000-000000001000");
    await expect(page.getByTestId("replay-locked")).toContainText(
      "Replays are part of Premium",
    );
    await expect(
      page.getByRole("link", { name: "See Premium" }),
    ).toHaveAttribute("href", "/shop");
  });

  test("nickname: checked like the server, taken names refused, saved everywhere", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free", "/profile");
    const settings = page.getByTestId("settings");
    const input = settings.getByLabel("Nickname");
    const hint = settings.locator(".field-hint");
    await input.fill("ab");
    await page.getByTestId("save-nickname").click();
    await expect(hint).toHaveText(
      "Use 3–20 letters or digits; spaces, - and _ only in the middle.",
    );
    await input.fill("Taken Name");
    await page.getByTestId("save-nickname").click();
    await expect(hint).toHaveText("That nickname is taken. Try another.");
    await input.fill("Captain Hook");
    await page.getByTestId("save-nickname").click();
    await expect(hint).toHaveText("Saved.");
    await expect(page.getByTestId("profile-nickname")).toHaveText(
      "Captain Hook",
    );
    await expect(page.getByTestId("player-chip")).toContainText("Captain Hook");
  });

  test("sound is off by default and the choice is remembered", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free", "/profile");
    const toggle = page.getByTestId("sound-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.reload();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("a browser in another time zone than the server", () => {
  test.use({ timezoneId: "Pacific/Auckland" });

  test("hydrates dates without mismatches and shows local times", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free", "/profile");
    const first = page.getByTestId("history").locator(".history-meta").first();
    // 12:00 UTC on 29 September is midnight in Auckland (NZDT, UTC+13): the 30th.
    await expect(first).toContainText("Sep 30, 2026");
    await page.goto("/leaderboard?period=week");
    // The week starts on Monday 00:00 UTC, shown as that calendar day.
    await expect(page.getByText("Since Sep 28, 2026")).toBeVisible();
  });
});
