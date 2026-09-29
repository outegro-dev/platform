import { expect, signIn, test, visit } from "./fixtures";

const sidebarLinks = async (page: import("@playwright/test").Page) =>
  page
    .getByRole("navigation", { name: "Console sections" })
    .getByRole("link")
    .allTextContents();

test("an owner sees every section", async ({ page }) => {
  await signIn(page, "owner", "/");
  expect(await sidebarLinks(page)).toEqual([
    "Dashboard",
    "Users",
    "Notifications",
    "Payments",
    "Battleship",
    "Audit",
  ]);
  await expect(page.locator(".operator-roles")).toHaveText("Owner");
});

test("support sees only what support may read, and the server agrees", async ({
  page,
}) => {
  await signIn(page, "support", "/");
  expect(await sidebarLinks(page)).toEqual([
    "Dashboard",
    "Users",
    "Notifications",
    "Battleship",
  ]);
  // Panels follow the same permissions.
  await expect(
    page.getByRole("heading", { name: "Revenue and subscriptions" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Recent audit" }),
  ).toBeVisible();

  // Typing the address does not help: the page is refused on the server.
  await visit(page, "/payments");
  await expect(
    page.getByRole("heading", {
      name: "This section is not part of your role",
    }),
  ).toBeVisible();
  await expect(page.getByText("Needs permission: billing.read")).toBeVisible();
  await visit(page, "/audit");
  await expect(page.getByText("Needs permission: audit.read")).toBeVisible();
});

test("support sees masked emails and only the commands of its role", async ({
  page,
}) => {
  await signIn(page, "support", "/users?query=oleg");
  await expect(page.getByText("o***@example.com")).toBeVisible();
  await expect(page.getByText("oleg.petrov@example.com")).toHaveCount(0);
  await page.getByRole("link", { name: "Oleg Petrov" }).click();
  await expect(
    page.getByRole("button", { name: "End all sessions" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await page.getByRole("link", { name: /^Roles/ }).click();
  await expect(page.getByRole("button", { name: "Grant role" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Payments/ })).toHaveCount(0);
});

test("billing lands on payments without people tools", async ({ page }) => {
  await signIn(page, "billing", "/");
  expect(await sidebarLinks(page)).toEqual(["Dashboard", "Payments"]);
  await visit(page, "/users");
  await expect(page.getByText("Needs permission: users.read")).toBeVisible();
});
