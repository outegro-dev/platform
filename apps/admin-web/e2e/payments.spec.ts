import type { Locator } from "@playwright/test";
import {
  expect,
  openFirstRow,
  openUserTab,
  settle,
  signIn,
  test,
  visit,
  withFailure,
} from "./fixtures";

/** A grant's row: its status, and whether it still offers a revoke. */
const grantRow = (list: Locator, feature: string) => {
  const row = list.locator("tbody tr").filter({ hasText: feature });
  return {
    status: row.locator(".status"),
    revoke: row.getByRole("button", { name: "Revoke" }),
    row,
  };
};

test.describe("connected", () => {
  test("revenue per currency, open sales and an order's story", async ({
    page,
  }) => {
    await signIn(page, "owner", "/payments");
    await expect(page.getByText("Sales open").first()).toBeVisible();
    for (const currency of ["EUR", "RUB", "USD"])
      await expect(page.getByText(`Net, ${currency}`)).toBeVisible();
    await expect(page.getByText(/₽\d/).first()).toBeVisible();
    await expect(
      page.getByText("Each currency is counted on its own", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Products and prices" }),
    ).toBeVisible();

    await page
      .getByRole("navigation", { name: "Payments sections" })
      .getByRole("link", { name: "Orders" })
      .click();
    await settle(page);
    await page.getByLabel("Status").selectOption("paid");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/status=paid/);
    await settle(page);
    await page.locator("table .row-link").first().click();
    await settle(page);

    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline).toContainText("Order created");
    await expect(timeline).toContainText("Checkout started");
    await expect(timeline).toContainText("Provider event payment.confirmed");
    await expect(timeline).toContainText("recorded");
    await expect(page.locator("#payments-title")).toHaveText("Payments");
  });

  test("gives access by hand with a reason", async ({ page }) => {
    await signIn(page, "owner", "/users?query=grace");
    await page.getByRole("link", { name: "Grace Lee" }).click();
    await settle(page);
    await page.getByRole("link", { name: /^Product access/ }).click();
    await settle(page);
    await page.getByRole("button", { name: "Give access" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Give access without a payment",
    });
    await dialog.getByLabel("Feature").selectOption("battleship:premium");
    await dialog
      .getByLabel("Reason")
      .fill("Beta tester reward for the bot league");
    await dialog.getByRole("button", { name: "Give access" }).click();
    await expect(
      page.getByRole("status").getByText("Access granted."),
    ).toBeVisible();
    const ledger = page.locator("#payments-grants");
    await expect(ledger).toContainText(
      "“Beta tester reward for the bot league”",
    );
  });
});

test.describe("grants say where they stand now", () => {
  // Payments records Artem's three Education grants as active: one opens
  // books now, one is booked for later, one ran out three days ago.
  test("on the user's product access, with a revoke only while it matters", async ({
    page,
  }) => {
    await signIn(page, "owner", "/users?query=artem.k");
    await page.getByRole("link", { name: "Artem Kuznetsov" }).click();
    await settle(page);
    await openUserTab(page, "Product access");
    const ledger = page.locator("#payments-grants");

    const library = grantRow(ledger, "library");
    await expect(library.status).toHaveText("In force");
    await expect(library.status).toHaveAttribute("data-tone", "ok");
    await expect(library.revoke).toBeVisible();

    const scheduled = grantRow(ledger, "book.sql-internals");
    await expect(scheduled.status).toHaveText("Scheduled");
    await expect(scheduled.status).toHaveAttribute("data-tone", "info");
    await expect(scheduled.row).toContainText("Starts");
    await expect(scheduled.revoke).toBeVisible();

    const expired = grantRow(ledger, "book.nodejs-internals");
    await expect(expired.status).toHaveText("Expired");
    await expect(expired.status).toHaveAttribute("data-tone", "neutral");
    await expect(expired.revoke).toHaveCount(0);

    await expect(ledger.getByText("Active", { exact: true })).toHaveCount(0);
  });

  test("on the grants page, whatever the recorded state", async ({ page }) => {
    await signIn(page, "owner", "/users?query=artem.k");
    await page.getByRole("link", { name: "Artem Kuznetsov" }).click();
    await page.waitForURL(/\/users\/[0-9a-f-]{36}$/);
    const userId = new URL(page.url()).pathname.split("/").at(-1);
    // The filter is Payments' record: "active" holds all three.
    await visit(page, `/payments/grants?userId=${userId}&state=active`);
    const list = page.locator("#grants");
    await expect(grantRow(list, "library").status).toHaveText("In force");
    await expect(grantRow(list, "book.sql-internals").status).toHaveText(
      "Scheduled",
    );
    const expired = grantRow(list, "book.nodejs-internals");
    await expect(expired.status).toHaveText("Expired");
    await expect(expired.revoke).toHaveCount(0);

    await visit(page, "/payments/grants?state=revoked");
    await expect(list.locator("tbody tr").first()).toBeVisible();
    for (const status of await list.locator(".status").all())
      await expect(status).toHaveText("Revoked");
    await expect(list.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });

  test("on an order and a player", async ({ page }) => {
    await signIn(page, "owner", "/payments/orders?status=paid");
    await openFirstRow(page);
    const access = page.locator("#grants");
    await expect(access.locator(".status").first()).toHaveText("In force");
    await expect(access.getByText("Active", { exact: true })).toHaveCount(0);

    // Mira's first order is paid: the game sees her access in force.
    await visit(page, "/users?query=mira");
    await page.getByRole("link", { name: "Mira Levina" }).click();
    await page.waitForURL(/\/users\/[0-9a-f-]{36}$/);
    const userId = new URL(page.url()).pathname.split("/").at(-1);
    await visit(page, `/battleship/players/${userId}`);
    await expect(page.locator("#grants .status").first()).toHaveText(
      "In force",
    );
    // The account link keeps its place in the row of statuses, by the
    // stylesheet, not an inline style.
    const account = page.getByRole("link", { name: "Account", exact: true });
    await expect(account).not.toHaveAttribute("style");
    await expect(account).toHaveCSS("margin-top", "0px");
    await expect(account).toHaveCSS("margin-right", "0px");
  });
});

test.describe("not connected", () => {
  test.use({ userAgent: withFailure("fake-down=payments") });

  test("reads as 'not connected yet', never as an error loop", async ({
    page,
  }) => {
    await signIn(page, "owner", "/payments");
    // One calm panel for the whole overview, not one per section.
    await expect(page.getByText("Payments is not connected yet")).toHaveCount(
      1,
    );
    await expect(
      page.getByRole("button", { name: "Check again" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Period" })).toHaveCount(
      0,
    );
    await expect(page.getByText(/Could not load/)).toHaveCount(0);
    await visit(page, "/payments/orders");
    await expect(page.getByText("Payments is not connected yet")).toBeVisible();

    // The dashboard keeps working; payments shows the same calm state.
    await visit(page, "/");
    const panel = page.getByRole("region", {
      name: "Revenue and subscriptions",
    });
    await expect(panel).toContainText("Payments is not connected yet");
    await expect(
      page.getByRole("region", { name: "Accounts and sessions" }),
    ).toContainText("Accounts");
  });
});
