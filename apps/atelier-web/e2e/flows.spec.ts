import {
  expect,
  expectAccessible,
  resetMock,
  screenshot,
  settle,
  test,
  viewports,
} from "./support";

/*
 * What the owner does on each screen, against the mock backend: moving
 * cards from the keyboard and by drag, the panel and its deep link, the
 * Inbox keys, adding a vacancy, lifting a pause.
 */

test.beforeEach(async ({ page }) => {
  await resetMock(page);
});

/** A column of the board by its stage key (found, fit, building…). */
const column = (page: import("@playwright/test").Page, stage: string) =>
  page.locator(`[data-column="${stage}"]`);

test("moves a card from the keyboard with the Move menu", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  const card = page.getByRole("article", { name: "Northwind Labs" });
  await card.getByRole("button", { name: "Move Northwind Labs" }).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expectAccessible(page, "move menu");
  await screenshot(page, "flow-move-menu", false);
  await menu.getByRole("menuitemradio", { name: "Ready" }).click();
  await expect(page.getByTestId("action-status")).toHaveText(
    "Northwind Labs moved to Ready.",
  );
  await expect(
    column(page, "ready").getByRole("article", { name: "Northwind Labs" }),
  ).toBeVisible();
  // The server kept it: a reload shows the same.
  await page.reload();
  await expect(
    column(page, "ready").getByRole("article", { name: "Northwind Labs" }),
  ).toBeVisible();
});

test("archives a card with a reason", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("article", { name: "Polder Energy" })
    .getByRole("button", { name: "Move Polder Energy" })
    .click();
  await page.getByRole("menuitemradio", { name: "Archive" }).click();
  const dialog = page.getByRole("dialog", { name: "Why is it archived?" });
  await expect(dialog).toBeVisible();
  await expectAccessible(page, "archive dialog");
  await dialog.getByRole("button", { name: "No reply" }).click();
  await expect(page.getByTestId("action-status")).toHaveText(
    "Polder Energy archived: No reply.",
  );
  await page.getByRole("button", { name: "Show the archive" }).first().click();
  await expect(
    column(page, "archived").getByRole("article", { name: "Polder Energy" }),
  ).toBeVisible();
});

test("drags a card to another column on a desktop", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  const card = page.getByRole("article", { name: "Kestrel Pay" });
  await card.dragTo(column(page, "building"));
  await expect(
    column(page, "building").getByRole("article", { name: "Kestrel Pay" }),
  ).toBeVisible();
  await expect(page.getByTestId("action-status")).toHaveText(
    "Kestrel Pay moved to Building.",
  );
});

test("filters the board and keeps the filters in the address", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search" }).fill("backend");
  await expect(page.getByText(/ of \d+ shown/)).toBeVisible();
  await expect(page).toHaveURL(/\?q=backend/);
  await page.getByRole("combobox", { name: "Mark" }).selectOption("meeting");
  await expect(page).toHaveURL(/flag=meeting/);
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue(
    "backend",
  );
  await page.getByRole("searchbox", { name: "Search" }).fill("zzzz");
  await expect(page.getByText("Nothing matches these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("opens an application in the panel, sends it and keeps the deep link", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Brightline Health", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "Brightline Health" });
  await expect(panel).toBeVisible();
  const url = page.url();
  expect(url).toMatch(/\/applications\/[0-9a-f-]{36}$/);

  await panel.getByRole("tab", { name: "Texts" }).click();
  await expect(
    panel.getByRole("button", { name: "Copy: Cover letter" }),
  ).toBeVisible();

  await panel.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("action-status")).toHaveText(
    "Sent. The card moved to Sent.",
  );
  await expect(
    panel.getByRole("button", { name: "Stage: Sent" }),
  ).toBeVisible();

  // Back closes the panel; Forward opens it again.
  await page.goBack();
  await expect(panel).toBeHidden();
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: "Brightline Health" }),
  ).toBeVisible();

  // A reload of the address is the application's own page.
  await page.goto(url);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "Brightline Health" }),
  ).toBeVisible();
});

test("retries a broken build from the failed step", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Halcyon Freight", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "Halcyon Freight" });
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await page
    .getByRole("menuitem", { name: /Retry from the failed step/ })
    .click();
  await expect(page.getByTestId("action-status")).toHaveText(
    "The pipeline runs again from Fit to the page.",
  );
  await expect(panel.getByText("Needs edit")).toHaveCount(0);
});

test("the Inbox: J and K move, Enter takes, X skips", async ({ page }) => {
  await page.goto("/inbox");
  await settle(page);
  const list = page.getByRole("list", { name: /New matches/ });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("action-status")).toHaveText(
    "Northwind Labs taken. Its CV is being built.",
  );
  await expect(rows).toHaveCount(3);
  await page.keyboard.press("x");
  await expect(page.getByTestId("action-status")).toHaveText(
    "Kestrel Pay skipped.",
  );
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toBeFocused();
  await expectAccessible(page, "inbox after keys");
  await page.goto("/");
  await expect(
    column(page, "building").getByRole("article", { name: "Northwind Labs" }),
  ).toBeVisible();
});

test("adding a vacancy explains every mistake", async ({ page }) => {
  await page.goto("/new");
  const field = page.getByRole("textbox", { name: "Link or vacancy text" });
  const submit = page.getByRole("button", { name: "Add to the board" });
  await submit.click();
  await expect(
    page.getByText("Paste a link or the text of the vacancy."),
  ).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();

  await field.fill("https://jobs lever co/northwind");
  await submit.click();
  await expect(page.getByText(/This link doesn't look complete/)).toBeVisible();

  await field.fill("Senior engineer, remote, Node.js");
  await expect(page.getByText("Vacancy text, 32 characters")).toBeVisible();
  await submit.click();
  await expect(
    page.getByText(
      "That's 32 characters. Paste the whole vacancy: at least 100.",
    ),
  ).toBeVisible();
  await expectAccessible(page, "add vacancy with an error");
  await screenshot(page, "flow-add-error", false);

  await field.fill("https://jobs.lever.example/northwind/77");
  await expect(page.getByText("A link to jobs.lever.example")).toBeVisible();
  await submit.click();
  await expect(
    page.getByRole("heading", { name: "On the board" }),
  ).toBeVisible();
  await screenshot(page, "flow-add-done", false);
  await page.getByRole("button", { name: "Add another" }).click();
  await expect(field).toHaveValue("");
});

test("lifts a provider pause", async ({ page }) => {
  await page.goto("/pipeline");
  const paused = page.getByRole("listitem").filter({ hasText: "claude-code" });
  await expect(paused.getByText("Paused")).toBeVisible();
  await paused.getByRole("button", { name: "Lift pause" }).click();
  await expect(page.getByTestId("action-status")).toHaveText(
    "claude-code takes work again.",
  );
  await expect(paused.getByText("Available")).toBeVisible();
  await expect(paused.getByRole("button", { name: "Lift pause" })).toHaveCount(
    0,
  );
});

test.describe("on a phone", () => {
  test.use({ viewport: viewports.mobile });

  test("the stage switcher scrolls the board to a column", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const switcher = page.getByRole("navigation", { name: "Go to a stage" });
    await switcher.getByRole("button", { name: /^Sent/ }).click();
    await expect(
      switcher.getByRole("button", { name: /^Sent/ }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      column(page, "sent").getByRole("article").first(),
    ).toBeInViewport();
    await screenshot(page, "flow-mobile-switcher-sent", false);
  });

  test("the menu sheet has the account, language and theme", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open the menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expectAccessible(page, "menu sheet");
    await screenshot(page, "flow-mobile-menu", false);
    await sheet.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-tone", "dark");
    await sheet.getByRole("button", { name: /RU/ }).click();
    // The sheet itself is now in Russian.
    await expect(page.getByRole("dialog", { name: "Меню" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { level: 1, name: "Доска" }),
    ).toBeVisible();
  });
});
