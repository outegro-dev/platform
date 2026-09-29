import { expect, openUserTab, settle, signIn, test } from "./fixtures";

test("finds a user and grants a role with a reason", async ({ page }) => {
  await signIn(page, "owner", "/users");
  await page.getByLabel("Email or user ID").fill("mira");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL("/users?query=mira");
  await page.getByRole("link", { name: "Mira Levina" }).click();
  await settle(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Mira Levina",
  );

  await page.getByRole("link", { name: /^Roles/ }).click();
  await settle(page);
  await page.getByRole("button", { name: "Grant role" }).click();
  const dialog = page.getByRole("dialog", { name: "Grant an admin role" });
  await dialog.getByLabel("Role").selectOption("support");
  const confirm = dialog.getByRole("button", { name: "Grant role" });
  // The reason is required: too short keeps the command disabled.
  await dialog.getByLabel("Reason").fill("ok");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Covers weekend support shifts");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Role support granted."),
  ).toBeVisible();
  const row = page.getByRole("row", { name: /Support/ }).first();
  await expect(row).toContainText("Active");
  await expect(row).toContainText("Covers weekend support shifts");

  // Granting the same role again is refused by Identity and explained.
  await page.getByRole("button", { name: "Grant role" }).click();
  await expect(
    dialog.getByLabel("Role").locator("option", { hasText: "Support" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("suspends a user after a preview and a typed reason", async ({ page }) => {
  await signIn(page, "owner", "/users?query=oleg");
  await page.getByRole("link", { name: "Oleg Petrov" }).click();
  await settle(page);
  await page.getByRole("button", { name: "Suspend" }).click();
  const dialog = page.getByRole("dialog", { name: "Suspend this account?" });
  const effects = dialog.getByRole("list", { name: "What happens" });
  await expect(effects).toContainText(
    "Sign-in is blocked in every outegro.dev app.",
  );
  await expect(effects).toContainText("active sessions end immediately.");
  await expect(effects).toContainText("Subscriptions keep running");
  await dialog.getByLabel("Reason").fill("Payment fraud reported by the bank");
  await dialog.getByRole("button", { name: "Suspend account" }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("status")
      .getByText("Account suspended. All sessions were ended."),
  ).toBeVisible();
  await expect(page.locator(".page-head .status")).toHaveText("Suspended");
  await expect(
    page.getByRole("button", { name: "Restore account" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^Activity/ }).click();
  await expect(
    page.getByText("“Payment fraud reported by the bank”").first(),
  ).toBeVisible();
});

test("the user card shows every service in its own tab", async ({ page }) => {
  await signIn(page, "owner", "/users?query=mira");
  await page.getByRole("link", { name: "Mira Levina" }).click();
  await settle(page);

  await openUserTab(page, "Notifications");
  await expect(page.getByRole("heading", { name: "Recipient" })).toBeVisible();
  await expect(page.getByText("m***@example.com")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent deliveries" }),
  ).toBeVisible();

  await openUserTab(page, "Battleship");
  await expect(page.getByText("Captain Mira")).toBeVisible();

  await openUserTab(page, "Payments");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(
    page.locator("#user-orders table .row-link").first(),
  ).toBeVisible();

  await page.getByRole("link", { name: /^Product access/ }).click();
  await settle(page);
  await expect(
    page.getByRole("heading", { name: "Grants in Payments" }),
  ).toBeVisible();
});
