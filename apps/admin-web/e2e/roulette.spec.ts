import type { Locator, Page } from "@playwright/test";
import {
  expect,
  expectAccessible,
  settle,
  signIn,
  test,
  tracedRequests,
  useRussian,
  visit,
  withFailure,
} from "./fixtures";

const sidebarLinks = (page: Page) =>
  page
    .getByRole("navigation", { name: "Console sections" })
    .getByRole("link")
    .allTextContents();

/** One number of a panel, by its exact label. */
const stat = (panel: Locator, label: string) =>
  panel.locator(".stat").filter({
    has: panel.page().locator(".stat-label").getByText(label, { exact: true }),
  });

/** One fact of a panel (a term and its description), by its exact term. */
const fact = (panel: Locator, term: string) =>
  panel.locator(".fact").filter({
    has: panel.page().locator("dt").getByText(term, { exact: true }),
  });

/** The live round's number, from the Live page's heading. */
async function currentRound(page: Page): Promise<number> {
  await visit(page, "/roulette");
  const title = await page.locator("#live-round-title").textContent();
  return Number(/Round (\d+)/.exec(title ?? "")?.[1]);
}

/** Preview → confirm in an open command dialog, with a reason. */
async function previewAndConfirm(
  dialog: Locator,
  reason: string,
  confirm: string,
) {
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(
    dialog.getByRole("heading", { name: "What will change" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("an owner sees the live table, read again every few seconds in the background", async ({
  page,
}) => {
  await signIn(page, "owner", "/roulette");
  await expect(
    page
      .getByRole("navigation", { name: "Roulette sections" })
      .getByRole("link"),
  ).toHaveText([
    "Live",
    "Rounds",
    "Players",
    "Table",
    "Bonus of the day",
    "Services",
    "Audit",
  ]);
  const round = page.locator("#live-round");
  await expect(round.getByRole("heading", { level: 2 })).toHaveText(
    /^Round \d+$/,
  );
  await expect(round.locator(".status").first()).toHaveText("Taking bets");
  await expect(stat(round, "Left in this phase")).toContainText(/\d+ s/);
  await expect(stat(round, "Online")).toContainText("37");
  await expect(stat(round, "Bets this round")).toContainText("7");
  await expect(stat(round, "Staked this round")).toContainText("245,000 GRM");

  // Green would pay 84 % of its limit: close to it; red 24 %, black 13 %.
  const exposure = page.locator("#exposure");
  await expect(exposure).toContainText("The limit is 1,000,000 GRM per colour");
  const row = (color: string) =>
    exposure.locator(".bar-row").filter({ hasText: color });
  await expect(row("Green")).toContainText("840,000 GRM · 84%");
  await expect(row("Green")).toContainText("Close to the limit");
  await expect(row("Red")).toContainText("240,000 GRM · 24%");
  await expect(row("Red")).not.toContainText("Close to the limit");
  await expect(page.locator("#house")).toContainText("Last 24 hours");
  await expect(page.locator("#house")).toContainText("Since the first round");

  // The page asks again on its own; the proxy is told it is not the operator.
  const poll = await page.waitForRequest(
    (request) => request.url().endsWith("/api/roulette/live"),
    { timeout: 6_000 },
  );
  expect(poll.headers()["x-admin-background"]).toBe("1");
  const answer = await (await poll.response())?.json();
  expect(answer).toMatchObject({ ok: true, data: { online: 37 } });
  await expect(round).toContainText(/Updated (just now|\d+ seconds? ago)/);
  await expectAccessible(page);
});

test("support reads the roulette but changes nothing", async ({ page }) => {
  await signIn(page, "support", "/roulette/table");
  expect(await sidebarLinks(page)).toContain("Roulette");
  await expect(page.locator("#table")).toContainText("Minimum bet");
  await expect(
    page.getByText("Changing the table needs the roulette.manage permission."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause bets" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Change settings" }),
  ).toHaveCount(0);

  // The round that still takes bets: an owner could void it, support cannot.
  const round = await currentRound(page);
  await visit(page, `/roulette/rounds/${round}`);
  await expect(page.locator("#round")).toContainText(`Round ${round}`);
  await expect(page.getByRole("button", { name: "Void round" })).toHaveCount(0);

  await visit(page, "/roulette/daily");
  await expect(page.locator("#daily")).toContainText("Expected prize");
  await expect(
    page.getByRole("button", { name: "Change the bonus" }),
  ).toHaveCount(0);
});

test("without roulette.read the section is refused, not just hidden", async ({
  page,
}) => {
  await signIn(page, "editor", "/");
  expect(await sidebarLinks(page)).not.toContain("Roulette");
  await visit(page, "/roulette/rounds");
  await expect(page.getByText("Needs permission: roulette.read")).toBeVisible();
});

test("a settled round shows its chain link and cannot be voided", async ({
  page,
}) => {
  await signIn(page, "owner", "/roulette/rounds");
  const rounds = page.locator("#rounds");
  await expect(rounds.getByRole("link", { name: "No. 184" })).toBeVisible();
  await rounds.getByRole("link", { name: "No. 184" }).click();
  await settle(page);
  await expect(page).toHaveURL(/\/roulette\/rounds\/184$/);
  const round = page.locator("#round");
  await expect(round.getByRole("heading", { level: 2 })).toHaveText(
    "Round 184",
  );
  await expect(round.locator(".status").first()).toHaveText("Settled");
  await expect(page.getByRole("button", { name: "Void round" })).toHaveCount(0);
  const fairness = page.locator("#fairness");
  await expect(fact(fairness, "Chain link")).toContainText("Verified");
  for (const term of ["Seed", "Previous seed", "Commit", "Public seed"])
    await expect(
      fact(fairness, term).getByRole("button", { name: "Copy" }),
    ).toBeVisible();

  // An owner voided round 150 last week: it says so.
  await visit(page, "/roulette/rounds/150");
  await expect(page.locator("#round .status").first()).toHaveText("Voided");
  await expect(page.getByRole("button", { name: "Void round" })).toHaveCount(0);
});

test("an owner voids the current round: the preview counts what goes back", async ({
  page,
}) => {
  await signIn(page, "owner", "/roulette");
  const round = await currentRound(page);
  await visit(page, `/roulette/rounds/${round}`);
  await page.getByRole("button", { name: "Void round" }).click();
  const dialog = page.getByRole("dialog", { name: `Void round ${round}?` });
  await expect(
    dialog.getByRole("list", { name: "What happens" }),
  ).toContainText("returned by its reference");
  // No preview without a reason.
  await expect(dialog.getByRole("button", { name: "Preview" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("The wheel froze mid-spin");
  await dialog.getByRole("button", { name: "Preview" }).click();
  const preview = dialog.getByRole("region", { name: "What will change" });
  await expect(fact(preview, "Bets returned")).toContainText("7");
  await expect(fact(preview, "Grumbles returned")).toContainText("245,000 GRM");
  await expect(dialog).toContainText("“The wheel froze mid-spin”");
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Void round", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("status")
      .getByText(`Round ${round} voided: 7 bets returned.`),
  ).toBeVisible();
  await expect(page.locator("#round .status").first()).toHaveText("Voided");
  await expect(page.getByRole("button", { name: "Void round" })).toHaveCount(0);

  // The roulette's audit keeps it; the next round takes bets.
  await page
    .getByRole("navigation", { name: "Roulette sections" })
    .getByRole("link", { name: "Audit" })
    .click();
  await settle(page);
  const entry = page
    .locator("#roulette-audit .feed-item")
    .filter({ hasText: "“The wheel froze mid-spin”" });
  await expect(entry).toContainText(`Round voided · Round ${round}`);
  await expect(
    entry.getByRole("link", { name: `Round ${round}` }),
  ).toHaveAttribute("href", `/roulette/rounds/${round}`);
  expect(await currentRound(page)).toBeGreaterThan(round);
});

test.describe("the table's commands", () => {
  // Both change the same table and put it back: one after the other.
  test.describe.configure({ mode: "serial" });

  test.describe("for an operator whose role changed a moment ago", () => {
    test.use({
      userAgent: withFailure("fake-stale=roulette fake-trace=roulette-stale"),
    });

    test("bets are paused and resumed: preview, a fresh token, the audit", async ({
      page,
    }) => {
      await signIn(page, "owner", "/roulette/table");
      const table = page.locator("#table");
      await expect(table.locator(".status").first()).toHaveText("Bets open");

      await page.getByRole("button", { name: "Pause bets" }).click();
      const pause = page.getByRole("dialog", { name: "Pause bets?" });
      await pause.getByLabel("Reason").fill("Wallet incident, holding bets");
      await pause.getByRole("button", { name: "Preview" }).click();
      // The service said what changes: only the switch.
      const changes = pause.getByRole("list", { name: "What changes" });
      await expect(changes.locator("li")).toHaveCount(1);
      await expect(changes).toContainText("Bets paused");
      await expect(changes).toContainText("was Off, now On");
      await pause
        .getByRole("button", { name: "Pause bets", exact: true })
        .click();
      await expect(pause).toBeHidden();
      await expect(
        page.getByRole("status").getByText("Table settings changed."),
      ).toBeVisible();
      await expect(table.locator(".status").first()).toHaveText("Bets paused");

      // The first command met the stale token: the console refreshed the
      // session once and sent it again.
      const calls = await tracedRequests(page, "roulette-stale");
      const commands = calls.filter(
        (call) => call === "POST /roulette/v1/admin/table",
      );
      expect(commands.length).toBeGreaterThanOrEqual(3);
      const refresh = calls.indexOf("POST /auth/v1/sessions/refresh");
      expect(refresh).toBeGreaterThan(
        calls.indexOf("POST /roulette/v1/admin/table"),
      );

      await page.getByRole("button", { name: "Resume bets" }).click();
      await previewAndConfirm(
        page.getByRole("dialog", { name: "Resume bets?" }),
        "Wallet is back",
        "Resume bets",
      );
      await expect(table.locator(".status").first()).toHaveText("Bets open");

      await visit(page, "/roulette/audit");
      const audit = page.locator("#roulette-audit");
      await expect(audit).toContainText("“Wallet incident, holding bets”");
      await expect(audit).toContainText("“Wallet is back”");
      await expect(
        audit.getByRole("link", { name: "Roulette table" }).first(),
      ).toHaveAttribute("href", "/roulette/table");
    });
  });

  test("a change made meanwhile wins: the stale confirm is refused and the page catches up", async ({
    page,
    context,
  }) => {
    await signIn(page, "owner", "/roulette/table");
    await page.getByRole("button", { name: "Change settings" }).click();
    const edit = page.getByRole("dialog", {
      name: "Change the table settings",
    });
    // A minimum above the maximum is caught before anything is sent.
    await edit.getByLabel("Minimum bet").fill("60000");
    await expect(edit).toContainText("The minimum bet is above the maximum.");
    await edit.getByLabel("Reason").fill("Smaller bets for the launch week");
    await expect(edit.getByRole("button", { name: "Preview" })).toBeDisabled();
    await edit.getByLabel("Minimum bet").fill("10");
    await edit.getByLabel("Maximum bet").fill("20000");
    await edit.getByRole("button", { name: "Preview" }).click();
    const changes = edit.getByRole("list", { name: "What changes" });
    await expect(changes).toContainText("Maximum bet");
    await expect(changes).toContainText("was 50,000 GRM, now 20,000 GRM");

    // Meanwhile another tab pauses bets.
    const other = await context.newPage();
    await visit(other, "/roulette/table");
    await other.getByRole("button", { name: "Pause bets" }).click();
    await previewAndConfirm(
      other.getByRole("dialog", { name: "Pause bets?" }),
      "Checking a payout",
      "Pause bets",
    );
    await other.close();

    // The previewed change carries the old version: refused, back to editing,
    // and the page shows the table as it is now.
    await edit
      .getByRole("button", { name: "Change settings", exact: true })
      .click();
    await expect(
      page
        .locator(".toast")
        .filter({ hasText: "Someone changed these settings a moment ago" }),
    ).toBeVisible();
    await expect(edit.getByRole("button", { name: "Preview" })).toBeVisible();
    await expect(page.locator("#table .status").first()).toHaveText(
      "Bets paused",
    );
    await edit.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Resume bets" }).click();
    await previewAndConfirm(
      page.getByRole("dialog", { name: "Resume bets?" }),
      "Payout checked",
      "Resume bets",
    );
    await expect(page.locator("#table .status").first()).toHaveText(
      "Bets open",
    );
  });
});

test("the bonus of the day: a new prize table with its expected prize, then the old one back", async ({
  page,
}) => {
  await signIn(page, "owner", "/roulette/daily");
  const daily = page.locator("#daily");
  await expect(stat(daily, "Expected prize")).toContainText("32.5 GRM");
  await expect(stat(daily, "Claims in 24 h")).toContainText("214");
  // Several accounts on one device or address, each a link to its user card.
  const suspicions = page.locator("#suspicions");
  await expect(suspicions.locator("tbody tr")).toHaveCount(2);
  await expect(suspicions).toContainText("Device");
  await expect(suspicions).toContainText("IP address");
  await expect(suspicions.getByRole("link").first()).toHaveAttribute(
    "href",
    /^\/users\/[0-9a-f-]{36}$/,
  );

  const change = async (first: string, last: string, reason: string) => {
    await page.getByRole("button", { name: "Change the bonus" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Change the bonus of the day",
    });
    await dialog.getByLabel("Chance 4, %").fill(last);
    if (first !== last) {
      // Out of balance until the first line gives way.
      await expect(dialog).toContainText(
        "The chances must add up to exactly 100%.",
      );
    }
    await dialog.getByLabel("Chance 1, %").fill(first);
    await dialog.getByLabel("Reason").fill(reason);
    await dialog.getByRole("button", { name: "Preview" }).click();
    return dialog;
  };

  const dialog = await change("59", "2", "A bigger jackpot this week");
  const preview = dialog.getByRole("region", { name: "What will change" });
  await expect(preview).toContainText(
    "Expected prizewas 32.5 GRM, now 42.4 GRM",
  );
  await expect(
    preview.getByRole("table", { name: "Prize table after" }),
  ).toContainText("2%");
  await dialog
    .getByRole("button", { name: "Change the bonus", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Bonus of the day changed."),
  ).toBeVisible();
  await expect(stat(daily, "Expected prize")).toContainText("42.4 GRM");

  const back = await change("60", "1", "The jackpot week is over");
  await back
    .getByRole("button", { name: "Change the bonus", exact: true })
    .click();
  await expect(back).toBeHidden();
  await expect(stat(daily, "Expected prize")).toContainText("32.5 GRM");
});

test("players are found by nickname and lead to their bets and user card", async ({
  page,
}) => {
  await signIn(page, "owner", "/roulette/players");
  await expect(page.locator("#players tbody tr").first()).toBeVisible();
  await page.getByLabel("Nickname").fill("kraken");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=kraken/);
  await settle(page);
  const players = page.locator("#players");
  await expect(players).toContainText("Players matching “kraken”");
  await players.getByRole("link", { name: "Kraken" }).click();
  await settle(page);
  const player = page.locator("#player");
  await expect(player.getByRole("heading", { level: 2 })).toHaveText("Kraken");
  await expect(stat(player, "Turnover")).toContainText("GRM");
  await expect(page.locator("#last-bets tbody tr").first()).toBeVisible();
  await expect(player.getByRole("link", { name: "User card" })).toHaveAttribute(
    "href",
    /^\/users\/[0-9a-f-]{36}$/,
  );
});

test("the services behind the roulette, and a wallet in memory warns", async ({
  page,
}) => {
  await signIn(page, "owner", "/roulette/services");
  const services = page.locator("#services");
  await expect(services.locator(".health")).toHaveCount(4);
  await expect(services.getByText("Up", { exact: true })).toHaveCount(4);
  const engine = page.locator("#engine");
  await expect(fact(engine, "Leader")).toContainText(
    "roulette-backend-6f9c7d-2x4kq",
  );
  await expect(fact(engine, "Last frame")).toContainText("180 ms ago");
  await expect(fact(engine, "Wallet")).toContainText("wallet-backend");
  await expect(page.getByText("The wallet runs in memory")).toHaveCount(0);
});

test.describe("a wallet running in memory", () => {
  test.use({ userAgent: withFailure("fake-wallet=memory") });

  test("is a warning on the services page", async ({ page }) => {
    await signIn(page, "owner", "/roulette/services");
    await expect(
      page.getByRole("status").filter({ hasText: "The wallet runs in memory" }),
    ).toBeVisible();
    await expect(fact(page.locator("#engine"), "Wallet")).toContainText(
      "In memory",
    );
  });
});

test.describe("roulette-backend not answering", () => {
  test.use({ userAgent: withFailure("fake-down=roulette") });

  test("is a calm 'not answering' state, not an error page", async ({
    page,
  }) => {
    await signIn(page, "owner", "/roulette");
    await expect(page.getByText("Roulette is not connected yet")).toBeVisible();
    await expect(
      page.getByText("does not answer at its configured address"),
    ).toBeVisible();
    await visit(page, "/roulette/rounds");
    await expect(page.getByText("Roulette is not connected yet")).toBeVisible();
    // The bonus of the day is another service: it still answers.
    await visit(page, "/roulette/daily");
    await expect(stat(page.locator("#daily"), "Expected prize")).toBeVisible();
  });
});

test("roulette commands join the console's audit timeline", async ({
  page,
}) => {
  await signIn(page, "owner", "/audit?source=roulette");
  const timeline = page.locator("#timeline");
  await expect(
    timeline
      .locator(".feed-item")
      .filter({ hasText: "“The wheel froze mid-spin after a deploy”" }),
  ).toContainText("Round voided · Round 150");
  await expect(timeline.locator(".source-badge").first()).toHaveText(
    "Roulette",
  );
});

test("speaks Russian", async ({ page, context }) => {
  await useRussian(context);
  await signIn(page, "owner", "/roulette");
  expect(
    await page
      .getByRole("navigation", { name: "Разделы консоли" })
      .getByRole("link")
      .allTextContents(),
  ).toContain("Рулетка");
  await expect(
    page.getByRole("navigation", { name: "Разделы рулетки" }).getByRole("link"),
  ).toHaveText([
    "Live",
    "Раунды",
    "Игроки",
    "Стол",
    "Бонус дня",
    "Сервисы",
    "Аудит",
  ]);
  await expect(page.locator("#exposure")).toContainText("Близко к лимиту");
  await expect(page.locator("#live-round")).toContainText("Приём ставок");
  await visit(page, "/roulette/table");
  await expect(
    page.getByRole("button", { name: "Пауза ставок" }),
  ).toBeVisible();
});
