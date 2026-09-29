import { APP, expect, signInAndConnect, test } from "./support/fixtures.ts";

test.describe("lobby", () => {
  test("shows your rating, the three modes and the top captains", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free");
    await expect(page.getByTestId("rating-value")).toHaveText("1016");
    await expect(page.getByTestId("rating-card")).toContainText(
      "12 rated matches",
    );
    await expect(page.getByTestId("mode-bot")).toContainText("Versus bot");
    await expect(page.getByTestId("mode-quick")).toContainText("Quick match");
    await expect(page.getByTestId("mode-room")).toContainText("Private room");
    const mini = page.getByTestId("mini-leaderboard");
    await expect(mini.getByRole("listitem")).toHaveCount(6);
    await expect(mini).toContainText("Your place");
  });

  test("quick match: the search shows its time and can be cancelled", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await page.getByTestId("join-queue").click();
    const status = page.getByTestId("mode-quick").locator(".queue-status");
    await expect(status).toContainText(/Searching · 0:0\d/);
    await expect(status).toContainText("0:02", { timeout: 5000 });
    await page.getByTestId("leave-queue").click();
    await expect(status).toContainText("Rated · Elo");
    expect(fake.received.map((message) => message.type)).toEqual(
      expect.arrayContaining(["queue.join", "queue.leave"]),
    );
  });

  test("a found opponent opens the match", async ({ page, game }) => {
    const fake = await signInAndConnect(page, game, "free");
    await page.getByTestId("join-queue").click();
    await expect(page.getByTestId("leave-queue")).toBeVisible();
    fake.startHumanMatch({
      kind: "human",
      nickname: "Nemo",
      rating: 1512,
      premium: true,
    });
    await expect(page).toHaveURL(`${APP}/play`);
    await expect(page.getByTestId("placement")).toBeVisible();
  });

  test("private room: create, share the link, close", async ({
    page,
    game,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: APP,
    });
    await signInAndConnect(page, game, "free");
    await page.getByTestId("create-room").click();
    await expect(page).toHaveURL(`${APP}/room/K7M2QX`);
    await expect(page.getByTestId("share-url")).toHaveText(
      `${APP}/room/K7M2QX`,
    );
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${APP}/room/K7M2QX`,
    );
    await page.getByRole("button", { name: "Close room" }).click();
    await expect(page.getByTestId("room-closed")).toContainText(
      "The room was closed.",
    );
  });

  test("joining by code explains bad and unknown codes", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "free");
    const input = page.getByTestId("room-code-input");
    const hint = page.getByTestId("mode-room").locator(".field-hint");
    await input.fill("K0M");
    await page.getByTestId("join-room").click();
    await expect(hint).toHaveText(
      "A room code has 6 letters and digits, like K7M2QX.",
    );
    await input.fill("zz zz zz");
    await page.getByTestId("join-room").click();
    await expect(hint).toHaveText("That room does not exist or has expired.");
  });

  test("a friend's invite link joins the room and starts the match", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free", "/room/ABCDEF");
    await expect(page).toHaveURL(`${APP}/play`);
    await expect(page.getByTestId("placement")).toBeVisible();
    expect(
      fake.received.find((message) => message.type === "room.join")?.payload,
    ).toEqual({
      code: "ABCDEF",
    });
    await expect(page.getByTestId("opponent-chip")).toContainText(
      "Grace O'Malley",
    );
  });

  test("Hard and Expert are locked without Premium; the server is never asked", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await page.getByRole("radio", { name: /Hard/ }).click();
    await expect(
      page.getByTestId("mode-bot").locator(".status-line"),
    ).toContainText("Hard and Expert bots are part of Battleship Premium.");
    await page.getByTestId("start-bot").click();
    const dialog = page.getByRole("dialog", { name: "Unlock Hard and Expert" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("premium-required-note")).toHaveCount(0);
    expect(fake.received.some((message) => message.type === "bot.start")).toBe(
      false,
    );
    await dialog.getByRole("link", { name: "See Premium" }).click();
    await expect(page).toHaveURL(`${APP}/shop`);
  });

  test("the server's premium_required refusal is explained, not swallowed", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "stale-premium");
    await page.getByRole("radio", { name: /Expert/ }).click();
    await page.getByTestId("start-bot").click();
    const dialog = page.getByRole("dialog", { name: "Unlock Hard and Expert" });
    await expect(dialog.getByTestId("premium-required-note")).toContainText(
      "The game server asked for Premium.",
    );
    const start = fake.received.find((message) => message.type === "bot.start");
    expect(start?.payload).toEqual({ level: "expert" });
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toBeHidden();
  });

  test("an unreachable game server is shown with a retry, then the lobby connects", async ({
    page,
    game,
    allowConsoleErrors,
  }) => {
    allowConsoleErrors(/503/);
    await page.context().addCookies([
      {
        name: "e2e_persona",
        value: "unlucky",
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/auth/sign-in?returnTo=%2F");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "The game server is not answering" }),
    ).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByTestId("start-bot")).toBeDisabled();
    await expect(page.getByTestId("mode-bot")).toContainText(
      "Connect to the game server to play.",
    );
    await game.current(15_000);
    await expect(page.getByTestId("start-bot")).toBeEnabled({
      timeout: 15_000,
    });
    await expect(page.getByTestId("player-chip")).toHaveAttribute(
      "title",
      /Connected/,
    );
  });
});
