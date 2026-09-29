import { expect, settle, signIn, test, visit, withFailure } from "./fixtures";

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
