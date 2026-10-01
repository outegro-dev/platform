import type { Page } from "@playwright/test";
import {
  expect,
  openFirstRow,
  openUserTab,
  phone,
  settle,
  signIn,
  test,
} from "./fixtures";

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

test("support removes a lost device's passkey with a reason; the last way in stays", async ({
  page,
}) => {
  await signIn(page, "support", "/users?query=mira");
  await page.getByRole("link", { name: "Mira Levina" }).click();
  await settle(page);
  await openUserTab(page, "Sessions");
  const panel = page.locator("#passkeys");
  await expect(panel.getByRole("heading", { name: "Passkeys" })).toBeVisible();
  await expect(panel.getByRole("row")).toHaveCount(3);
  await expect(panel).toContainText("MacBook Air");
  await expect(panel).toContainText("Synced");
  await expect(panel).toContainText("YubiKey 5C");
  await expect(panel).toContainText("Not used yet");

  await panel
    .getByRole("row", { name: /YubiKey 5C/ })
    .getByRole("button", { name: "Remove" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Remove the passkey “YubiKey 5C”?",
  });
  await expect(
    dialog.getByRole("list", { name: "What happens" }),
  ).toContainText("Open sessions stay; for a lost device, end them too.");
  await dialog.getByLabel("Reason").fill("Lost the key, confirmed by email");
  await dialog.getByRole("button", { name: "Remove passkey" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("status")
      .getByText("Passkey removed. The user has been notified."),
  ).toBeVisible();
  await expect(panel).not.toContainText("YubiKey 5C");
  await expect(panel).toContainText("MacBook Air");

  // Priya's only passkey is her last way to sign in: refused, it stays.
  await page.goto("/users?query=priya");
  await page.getByRole("link", { name: "Priya Nair" }).click();
  await settle(page);
  await openUserTab(page, "Sessions");
  await page
    .locator("#passkeys")
    .getByRole("button", { name: "Remove" })
    .click();
  const last = page.getByRole("dialog", {
    name: "Remove the passkey “Pixel 9”?",
  });
  await last.getByLabel("Reason").fill("User says the phone was stolen");
  await last.getByRole("button", { name: "Remove passkey" }).click();
  await expect(last).toContainText("This is the user's last way to sign in");
  await last.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#passkeys")).toContainText("Pixel 9");
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

/**
 * An empty state starts where its card's content starts (the title's left
 * edge) and keeps the card's padding below it, in flush cards (tables edge
 * to edge) and padded ones alike.
 */
async function expectInsideCard(page: Page, card: string) {
  const panel = page.locator(card);
  await expect(panel.locator(".state")).toBeVisible();
  const [box, title, icon, text, last] = await Promise.all([
    panel.boundingBox(),
    panel.locator(".panel-title").boundingBox(),
    panel.locator(".state-icon").boundingBox(),
    panel.locator(".state-title").boundingBox(),
    panel.locator(".state > :last-child").boundingBox(),
  ]);
  if (!box || !title || !icon || !text || !last) throw new Error(card);
  expect(Math.abs(icon.x - title.x), `${card}: icon`).toBeLessThanOrEqual(1);
  expect(Math.abs(text.x - title.x), `${card}: text`).toBeLessThanOrEqual(1);
  expect(title.x - box.x, `${card}: left padding`).toBeGreaterThanOrEqual(18);
  expect(
    box.y + box.height - (last.y + last.height),
    `${card}: bottom padding`,
  ).toBeGreaterThanOrEqual(18);
}

for (const [device, options] of [
  ["desktop", {}],
  ["phone", phone],
] as const) {
  test.describe(`empty states in the user card (${device})`, () => {
    test.use(options);
    test("sit inside their card, aligned with its title", async ({ page }) => {
      // Hana Kim has bought nothing, received nothing and changed nothing.
      await signIn(page, "owner", "/users?query=hana");
      await openFirstRow(page);
      for (const [tab, cards] of [
        ["Product access", ["#access", "#payments-grants"]],
        ["Roles", ["#roles"]],
        ["Notifications", ["#recent-deliveries"]],
        ["Battleship", ["#player"]],
        ["Payments", ["#user-orders", "#user-subscriptions"]],
        ["Activity", ["#activity-about", "#activity-by"]],
      ] as const) {
        await openUserTab(page, tab);
        for (const card of cards) await expectInsideCard(page, card);
      }
    });
  });
}
