import type { Locator, Page } from "@playwright/test";
import {
  expect,
  openFirstRow,
  openUserTab,
  signIn,
  test,
  useRussian,
  visit,
} from "./fixtures";

/** One number of a panel, by its exact label. */
const stat = (panel: Locator, label: string) =>
  panel.locator(".stat").filter({
    has: panel.page().locator(".stat-label").getByText(label, { exact: true }),
  });

/** The balance on the open wallet card, as digits. */
async function balanceOf(page: Page) {
  const text = await page
    .locator("#wallet .fact")
    .filter({ has: page.locator("dt").getByText("Balance", { exact: true }) })
    .locator("dd")
    .innerText();
  return Number(text.replace(/\D/g, ""));
}

async function openMiraWallet(page: Page) {
  await signIn(page, "owner", "/users?query=mira");
  await openFirstRow(page);
  await openUserTab(page, "Wallet");
}

test.describe("the wallet section", () => {
  // The commands change Mira's wallet: one test after the other, never at once.
  test.describe.configure({ mode: "serial" });

  test("shows grumbles on hand and system accounts that sum to zero", async ({
    page,
  }) => {
    await signIn(page, "owner", "/wallet");
    await expect(
      page
        .getByRole("navigation", { name: "Console sections" })
        .getByRole("link", { name: "Wallet" }),
    ).toHaveAttribute("aria-current", "page");
    const now = page.locator("#now");
    await expect(stat(now, "On players' wallets")).toBeVisible();
    await expect(stat(now, "Open issues")).toContainText("0");
    const total = page
      .locator("#system tr")
      .filter({ hasText: "All accounts together" })
      .locator("td");
    await expect(total).toHaveText("0");
    await expect(page.locator("#day")).toContainText("Debit");
    // The recent wallets open their card.
    await page.locator("table a.link").first().click();
    await expect(page).toHaveURL(/\/wallet\/wallets\/[0-9a-f-]{36}$/);
  });

  test("an owner grants grumbles with a preview and a reason, once per form", async ({
    page,
  }) => {
    await openMiraWallet(page);
    const before = await balanceOf(page);
    // The journal tells who did what and why, before → after.
    const journal = page.locator("#journal");
    await expect(journal).toContainText(
      "Granted 500 instead of 100 by mistake",
    );
    await expect(journal).toContainText("Nick Lukashik");

    await page.getByRole("button", { name: "Grant", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Grant grumbles" });
    await expect(dialog).toContainText(
      `The wallet holds ${before.toLocaleString("en-US")} now.`,
    );
    await dialog.getByLabel("Amount").fill("250");
    await expect(dialog.locator("output")).toContainText(
      `Balance after: ${(before + 250).toLocaleString("en-US")}`,
    );
    await dialog.getByLabel("Reason").fill("Compensation for the outage");
    await dialog.getByRole("button", { name: "Grant", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("status").getByText("250 grumbles granted"),
    ).toBeVisible();
    await expect.poll(() => balanceOf(page)).toBe(before + 250);
    const first = journal.locator("tbody tr").first();
    await expect(first).toContainText("Grant");
    await expect(first).toContainText("+250");
    await expect(first).toContainText("Compensation for the outage");
  });

  test("taking more than the wallet holds changes nothing", async ({
    page,
  }) => {
    await openMiraWallet(page);
    const before = await balanceOf(page);
    await page.getByRole("button", { name: "Take", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Take grumbles" });
    await dialog.getByLabel("Amount").fill(String(before + 1));
    await expect(dialog.locator("output")).toContainText(
      "Below zero: nothing would be taken",
    );
    await dialog.getByLabel("Reason").fill("Testing the floor");
    await dialog.getByRole("button", { name: "Take", exact: true }).click();
    await expect(dialog).toContainText(
      "The wallet holds less than that. Nothing was taken.",
    );
    await page.keyboard.press("Escape");
    expect(await balanceOf(page)).toBe(before);
  });

  test("an owner sets the balance and the wallet works out the difference", async ({
    page,
  }) => {
    await openMiraWallet(page);
    const before = await balanceOf(page);
    await page
      .getByRole("button", { name: "Set balance", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Set the balance" });
    await dialog.getByLabel("New balance").fill(String(before));
    await expect(dialog.locator("output")).toContainText(
      "The same balance: nothing would change",
    );
    await dialog.getByLabel("New balance").fill("100");
    await expect(dialog.locator("output")).toContainText(
      `${before.toLocaleString("en-US")} → 100`,
    );
    await dialog.getByLabel("Reason").fill("Season reset");
    await dialog
      .getByRole("button", { name: "Set balance", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("status").getByText("Balance set to 100 grumbles"),
    ).toBeVisible();
    await expect.poll(() => balanceOf(page)).toBe(100);
    const first = page.locator("#journal tbody tr").first();
    await expect(first).toContainText("Taken by operator");
    await expect(first).toContainText("Console");
    await expect(first).toContainText("Season reset");
  });

  test("the journal says where each operation came from and filters by it", async ({
    page,
  }) => {
    await openMiraWallet(page);
    const journal = page.locator("#journal");
    await expect(journal).toContainText("Roulette");
    await expect(journal).toContainText("round:r-");
    await journal.getByLabel("Source").selectOption("daily-bonus");
    await journal.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/tab=wallet.*source=daily-bonus/);
    const rows = journal.locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Daily bonus");
    await visit(page, "/wallet");
    const turnover = page.locator("#turnover");
    await expect(turnover).toContainText("Daily bonus");
    await expect(turnover).toContainText("Roulette");
  });

  test("is the owner's alone: other roles neither see nor open it", async ({
    page,
  }) => {
    await signIn(page, "support", "/wallet");
    await expect(
      page
        .getByRole("navigation", { name: "Console sections" })
        .getByRole("link", { name: "Wallet" }),
    ).toHaveCount(0);
    await expect(page.getByText("wallet.read")).toBeVisible();
    await visit(page, "/users?query=mira");
    await openFirstRow(page);
    await expect(
      page
        .getByRole("navigation", { name: "User sections" })
        .getByRole("link", { name: /^Wallet/ }),
    ).toHaveCount(0);
  });

  test("speaks Russian", async ({ page, context }) => {
    await useRussian(context);
    await signIn(page, "owner", "/wallet/reconciliation");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Кошелёк");
    await expect(page.locator("#issues")).toContainText(
      "Баланс расходится с журналом",
    );
    await expect(page.locator("#issues")).toContainText("Закрыто");
  });
});
