import type { Locator, Page } from "@playwright/test";
import type { FakeGame } from "./support/fake-game.ts";
import {
  APP,
  deployRandomFleet,
  expect,
  fireAt,
  layoutShift,
  signInAndConnect,
  startBotGame,
  test,
} from "./support/fixtures.ts";

/** Sinks every enemy ship the fake server placed. */
async function sinkEverything(page: Page, fake: FakeGame) {
  for (const cell of fake.enemyCells()) {
    const button = page
      .getByTestId("target-board")
      .locator(`button[data-x="${cell.x}"][data-y="${cell.y}"]`);
    if (/unknown/.test((await button.getAttribute("aria-label")) ?? "")) {
      await fireAt(page, cell.x, cell.y);
    }
  }
}

/** A cell of your own fleet, for the bot to hit. */
function ownShipCell(fake: FakeGame) {
  const ship = fake.match?.viewFor("you").own?.ships[0];
  if (!ship) throw new Error("no fleet");
  return { x: ship.x, y: ship.y };
}

/** Open water in your own waters, for the bot to miss. */
function ownWaterCell(fake: FakeGame) {
  const ships = new Set(
    (fake.match?.viewFor("you").own?.ships ?? []).flatMap((ship) =>
      Array.from({ length: ship.length }, (_, i) =>
        ship.orientation === "horizontal"
          ? `${ship.x + i},${ship.y}`
          : `${ship.x},${ship.y + i}`,
      ),
    ),
  );
  for (let y = 9; y >= 0; y--)
    for (let x = 9; x >= 0; x--) if (!ships.has(`${x},${y}`)) return { x, y };
  throw new Error("no open water");
}

/** Waits until the element's own animations (its entrance) are over. */
async function settled(locator: Locator) {
  await locator.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
}

async function inBattle(page: Page, fake: FakeGame, level = "Easy") {
  await startBotGame(page, level);
  await deployRandomFleet(page);
  expect(fake.match?.currentPhase).toBe("battle");
}

const nemo = {
  kind: "human",
  nickname: "Nemo",
  rating: 1512,
  premium: true,
} as const;

test.describe("match", () => {
  test("a full match against a bot, to victory, then play again", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake, "Medium");
    await expect(page.getByTestId("turn-indicator")).toHaveAttribute(
      "data-turn",
      "you",
    );
    await expect(page.getByTestId("turn-indicator")).toContainText("Your turn");

    // Miss once: the bot hits your ship (and shoots again), then misses.
    fake.script.botDelayMs = 700;
    const own = ownShipCell(fake);
    fake.script.botShots = [own, fake.emptyCell()];
    const water = fake.emptyCell();
    await fireAt(page, water.x, water.y);
    await expect(page.getByTestId("turn-indicator")).toHaveAttribute(
      "data-turn",
      "opponent",
    );
    await expect(page.getByTestId("turn-indicator")).toContainText(
      "Opponent's turn",
    );
    await expect(page.getByTestId("own-board")).toContainText("your ship, hit");
    await expect(page.getByTestId("turn-indicator")).toHaveAttribute(
      "data-turn",
      "you",
      {
        timeout: 15_000,
      },
    );

    await sinkEverything(page, fake);
    await expect(page.getByTestId("result")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Victory.",
    );
    await expect(page.getByTestId("result-reason")).toHaveText(
      "You sank the whole enemy fleet.",
    );
    await expect(page.getByTestId("rating-delta")).toHaveText(
      "Rating unchanged",
    );
    // The enemy fleet is revealed on the result board.
    await expect(page.getByTestId("target-board")).toContainText("sunk");

    await page.getByTestId("play-again").click();
    await expect(page.getByTestId("placement")).toBeVisible();
    const starts = fake.received.filter(
      (message) => message.type === "bot.start",
    );
    expect(starts.map((message) => message.payload)).toEqual([
      { level: "medium" },
      { level: "medium" },
    ]);
  });

  test("the pending-shot guard never fires twice", async ({ page, game }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake);
    const [first, second] = fake.enemyCells();
    if (!first || !second) throw new Error("no ships");
    const board = page.getByTestId("target-board");
    await board
      .locator(`button[data-x="${first.x}"][data-y="${first.y}"]`)
      .click();
    await board
      .locator(`button[data-x="${second.x}"][data-y="${second.y}"]`)
      .click({ force: true });
    await expect(
      board.locator(`button[data-x="${first.x}"][data-y="${first.y}"]`),
    ).toHaveAccessibleName(/hit|sunk/);
    expect(
      fake.received.filter((message) => message.type === "shot.fire"),
    ).toHaveLength(1);
  });

  test("the latest shot is marked on the board it landed on", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake);
    const target = page.getByTestId("target-board");
    const own = page.getByTestId("own-board");
    await expect(page.locator(".board .shot-marker")).toHaveCount(0);

    // Your shot: the brackets frame that cell of the enemy waters. They lock
    // on with a zoom, so they are measured once it is over, and the bot
    // answers only after that.
    const miss = ownWaterCell(fake);
    fake.script.botShots = [miss];
    fake.script.botDelayMs = 1500;
    const water = fake.emptyCell();
    await fireAt(page, water.x, water.y);
    const marker = target.locator(".shot-marker");
    await expect(marker).toHaveCount(1);
    await settled(marker);
    const cell = await target
      .locator(`button[data-x="${water.x}"][data-y="${water.y}"]`)
      .boundingBox();
    const box = await marker.boundingBox();
    expect(Math.abs((box?.x ?? 0) - (cell?.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((box?.y ?? 0) - (cell?.y ?? 0))).toBeLessThan(2);

    // Their answer moves it to your waters: only the latest shot is marked.
    await expect(own.locator(".shot-marker")).toHaveCount(1);
    await expect(target.locator(".shot-marker")).toHaveCount(0);
    await expect(page.getByTestId("last-shot")).toHaveText(
      `They fired at ${"ABCDEFGHIJ"[miss.x]}${miss.y + 1}: miss.`,
    );
    await settled(own.locator(".shot-marker"));
    const ownCell = await own
      .locator(".cell")
      .nth(miss.y * 10 + miss.x)
      .boundingBox();
    const ownBox = await own.locator(".shot-marker").boundingBox();
    expect(Math.abs((ownBox?.x ?? 0) - (ownCell?.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((ownBox?.y ?? 0) - (ownCell?.y ?? 0))).toBeLessThan(2);
  });

  test("a refused shot changes nothing and resyncs", async ({ page, game }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake);
    fake.script.rejectNextShot = "not_your_turn";
    const water = fake.emptyCell();
    const button = page
      .getByTestId("target-board")
      .locator(`button[data-x="${water.x}"][data-y="${water.y}"]`);
    await button.click();
    await expect(page.getByTestId("banner-rejected")).toHaveText(
      "It's not your turn yet.",
    );
    await expect(button).toHaveAccessibleName(/unknown/);
    expect(fake.received.at(-1)?.type).toBe("match.sync");
  });

  test("with reduced motion the same match is played with fades only", async ({
    browser,
    game,
  }) => {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 900 },
      baseURL: APP,
    });
    const page = await context.newPage();
    await page.routeWebSocket(/\/ws\?ticket=/, (ws) => game.connect(ws));
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const fake = await signInAndConnect(page, game, "silver");
    await inBattle(page, fake);
    const shimmer = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector(".board-water") as Element,
          "::after",
        ).animationName,
    );
    expect(shimmer).toBe("none");
    await sinkEverything(page, fake);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Victory.",
    );
    await expect(page.locator(".fireworks")).toBeHidden();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("a dropped connection shows the reconnect banner and the match comes back", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake);
    const target = fake.enemyCells()[0];
    if (!target) throw new Error("no ships");
    await fireAt(page, target.x, target.y);
    const before = fake.received.length;
    fake.script.readyDelayMs = 1500;
    await fake.drop();
    const banner = page.getByTestId("banner-reconnecting");
    await expect(banner).toHaveText(
      "Connection lost. Reconnecting — your match is safe for 60 seconds.",
    );
    await expect(banner).toBeHidden({ timeout: 15_000 });
    expect(fake.connections).toBe(2);
    expect(
      fake.received.slice(before).map((message) => message.type),
    ).toContain("match.sync");
    await expect(
      page
        .getByTestId("target-board")
        .locator(`button[data-x="${target.x}"][data-y="${target.y}"]`),
    ).toHaveAccessibleName(/hit|sunk/);
    expect(await layoutShift(page)).toBeLessThan(0.02);
  });

  test("reloading during a match restores it from the server", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake);
    const target = fake.enemyCells()[0];
    if (!target) throw new Error("no ships");
    await fireAt(page, target.x, target.y);
    await page.reload();
    await expect(page.getByTestId("battle")).toBeVisible();
    await expect(
      page
        .getByTestId("target-board")
        .locator(`button[data-x="${target.x}"][data-y="${target.y}"]`),
    ).toHaveAccessibleName(/hit|sunk/);
    await expect(page.getByTestId("own-board")).toContainText("your ship");
  });

  test("the opponent's disconnection is shown with their countdown", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    fake.script.turnMs = 30_000;
    fake.startHumanMatch({
      kind: "human",
      nickname: "Nemo",
      rating: 1512,
      premium: true,
    });
    await expect(page.getByTestId("placement")).toBeVisible();
    // The deploy clock says what happens at zero.
    await expect(page.getByTestId("placement-rule")).toHaveText(
      "Deploy before 0, or you lose the match.",
    );
    await deployRandomFleet(page);
    await expect(page.getByTestId("opponent-chip")).toContainText("Nemo");
    const indicator = page.getByTestId("turn-indicator");
    await expect(indicator.getByRole("timer")).toHaveAccessibleName(
      /^\d+ s left for your shot$/,
    );
    await expect(indicator.getByRole("timer")).toContainText(/^\d+s$/);
    await expect(page.getByTestId("turn-rule")).toHaveText(
      "30 s per turn · 3 timeouts in a row lose",
    );

    fake.script.botDelayMs = 60_000;
    fake.presence(false, 45_000);
    const banner = page.getByTestId("banner-opponent-away");
    await expect(banner).toContainText(
      /Your opponent disconnected\. If they're not back in (4[0-5]) s, you win\./,
    );
    // The chip says it too, in place of the rating.
    const away = page.getByTestId("opponent-away");
    await expect(away).toHaveText(/^Offline · (4[0-5]) s$/);
    // Their turn while they are away: the indicator says why nothing moves.
    const water = fake.emptyCell();
    await fireAt(page, water.x, water.y);
    await expect(indicator).toHaveAttribute("data-turn", "opponent");
    await expect(indicator.getByRole("timer")).toHaveAccessibleName(
      /^\d+ s left for their shot$/,
    );
    await expect(page.getByTestId("turn-hint-theirs")).toHaveText(
      "They're offline. Waiting for them…",
    );
    fake.presence(true);
    await expect(banner).toBeHidden();
    await expect(away).toHaveCount(0);
    await expect(page.getByTestId("opponent-chip")).toContainText(
      "Rating 1512",
    );
    await expect(page.getByTestId("turn-hint-theirs")).toHaveText(
      "Waiting for their shot…",
    );
  });

  test("the turn indicator says what to do now", async ({ page, game }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake);
    const hint = page.getByTestId("turn-hint-yours");
    await expect(page.getByTestId("turn-rule")).toHaveText(
      "No time limit against a bot",
    );
    await expect(hint).toHaveText("Pick a cell in enemy waters.");

    // A hit keeps the turn, and the indicator says so; so does a sinking.
    const ship = fake.opponentFleet.find((item) => item.length === 2);
    if (!ship) throw new Error("no destroyer");
    const cells = [0, 1].map((i) =>
      ship.orientation === "horizontal"
        ? { x: ship.x + i, y: ship.y }
        : { x: ship.x, y: ship.y + i },
    );
    for (const [index, cell] of cells.entries()) {
      await fireAt(page, cell.x, cell.y);
      await expect(hint).toHaveText(
        index === 0 ? "Hit! Fire again." : "Sunk! Fire again.",
      );
    }

    // Their hit keeps their turn too.
    fake.script.botDelayMs = 1500;
    fake.script.botShots = [ownShipCell(fake), ownWaterCell(fake)];
    const water = fake.emptyCell();
    await fireAt(page, water.x, water.y);
    await expect(page.getByTestId("turn-hint-theirs")).toHaveText(
      "They hit, so they fire again…",
    );
    await expect(page.getByTestId("turn-indicator")).toHaveAttribute(
      "data-turn",
      "you",
      { timeout: 15_000 },
    );
    await expect(hint).toHaveText("Pick a cell in enemy waters.");
  });

  test("the last seconds of a turn say what happens at zero", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    fake.script.turnMs = 7_000;
    fake.startHumanMatch({
      kind: "human",
      nickname: "Nemo",
      rating: 1512,
      premium: false,
    });
    await deployRandomFleet(page);
    const hint = page.getByTestId("turn-hint-yours");
    await expect(hint).toHaveText("Pick a cell in enemy waters.");
    await expect(hint).toHaveText("Fire now: at 0 your turn passes.", {
      timeout: 5000,
    });
    await expect(
      page.getByTestId("turn-indicator").getByRole("timer"),
    ).toHaveAttribute("data-urgent");
  });

  test("resigning asks first, then ends the match as a loss", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await inBattle(page, fake);
    await page.getByRole("button", { name: "Resign" }).click();
    const dialog = page.getByRole("dialog", { name: "Resign this match?" });
    await dialog.getByRole("button", { name: "Keep playing" }).click();
    await expect(dialog).toBeHidden();
    expect(
      fake.received.some((message) => message.type === "match.resign"),
    ).toBe(false);
    await page.getByRole("button", { name: "Resign" }).click();
    await dialog.getByRole("button", { name: "Resign" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Defeat.");
    await expect(page.getByTestId("result-reason")).toHaveText("You resigned.");
    await page.getByTestId("back-to-lobby").click();
    await expect(page).toHaveURL(`${APP}/`);
  });

  test("a fleet not deployed before the clock runs out loses, and says so", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    fake.startHumanMatch(nemo);
    await expect(page.getByTestId("placement")).toBeVisible();
    fake.opponentDeploys();
    await expect(page.getByTestId("opponent-status")).toHaveText(
      "Opponent is ready",
    );
    fake.placementClockRunsOut();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Defeat.");
    // Not "three turns in a row": no turn was ever played.
    await expect(page.getByTestId("result-reason")).toHaveText(
      "You didn't deploy your fleet in time.",
    );
    await expect(page.getByTestId("rating-delta")).toContainText("−16");
  });

  test("an opponent who does not deploy in time loses, and it says so", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    fake.script.opponentPlaceDelayMs = 60_000;
    fake.startHumanMatch(nemo);
    await page.getByTestId("random-fleet").click();
    await page.getByTestId("ready").click();
    await expect(page.getByTestId("fleet-deployed")).toBeVisible();
    fake.placementClockRunsOut();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Victory.",
    );
    await expect(page.getByTestId("result-reason")).toHaveText(
      "Your opponent didn't deploy their fleet in time.",
    );
  });

  test("Russian: a fleet not deployed in time", async ({
    page,
    game,
    context,
  }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    const fake = await signInAndConnect(page, game, "free");
    fake.startHumanMatch(nemo);
    await expect(page.getByTestId("placement")).toBeVisible();
    fake.opponentDeploys();
    fake.placementClockRunsOut();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Поражение.",
    );
    await expect(page.getByTestId("result-reason")).toHaveText(
      "Вы не успели расставить флот.",
    );
  });

  test("a match the server aborts is cancelled calmly", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    await startBotGame(page);
    fake.send("match.aborted", { reason: "placement_timeout" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Match cancelled.",
    );
    await expect(page.getByTestId("result-reason")).toHaveText(
      "Nobody deployed a fleet in time. There is no winner, and ratings are unchanged.",
    );
    await page.getByRole("button", { name: "Back to lobby" }).click();
    await expect(page).toHaveURL(`${APP}/`);
  });

  test("a match both players left is cancelled without a winner", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    fake.startHumanMatch({
      kind: "human",
      nickname: "Nemo",
      rating: 1512,
      premium: true,
    });
    await deployRandomFleet(page);
    fake.send("match.aborted", { reason: "abandoned" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Match cancelled.",
    );
    await expect(page.getByTestId("result-reason")).toHaveText(
      "Both players were disconnected for too long. There is no winner, and ratings are unchanged.",
    );
    await page.getByRole("button", { name: "Back to lobby" }).click();
    await expect(page).toHaveURL(`${APP}/`);
  });

  test("coming back to a match that was cancelled meanwhile leads to the lobby", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "free");
    fake.startHumanMatch({
      kind: "human",
      nickname: "Nemo",
      rating: 1512,
      premium: true,
    });
    await deployRandomFleet(page);
    fake.endWhileAway();
    await fake.drop();
    const notice = page.getByTestId("ended-away");
    await expect(notice).toContainText("The match ended while you were away");
    await expect(notice).toContainText(
      "if they left too, it was cancelled and ratings are unchanged.",
    );
    await notice.getByRole("link", { name: "Back to lobby" }).click();
    await expect(page).toHaveURL(`${APP}/`);
    await expect(page.getByTestId("start-bot")).toBeVisible();
  });
});
