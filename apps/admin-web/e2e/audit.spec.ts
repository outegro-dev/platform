import { expect, signIn, test, useRussian, visit } from "./fixtures";

const REQUEST = "3f1d2a9c-5b7e-4c21-9a0d-6e8f4b2c1d70";

test("names a passkey an operator removed, with the request to look up", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "owner", "/audit?action=passkey.revoked");
  const entry = page
    .locator(".feed-item")
    .filter({ hasText: "Lost phone, confirmed by email" });
  await expect(entry.locator(".feed-title")).toContainText(
    "Passkey removed by an operator",
  );
  // The request behind it, short on screen and whole on the clipboard: the
  // id its log lines carry.
  const request = entry.locator(".feed-request");
  await expect(request).toContainText("Request");
  await expect(request.locator(".mono")).toHaveText(REQUEST.slice(0, 8));
  await expect(request.locator(".mono")).toHaveAttribute("title", REQUEST);
  await request.getByRole("button", { name: "Copy request ID" }).click();
  await expect(request.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    REQUEST,
  );
});

test("shows a request only where the service records one", async ({ page }) => {
  // Education's and Battleship's audit logs keep no request id.
  await signIn(page, "owner", "/audit?source=education");
  await expect(page.locator(".feed-item").first()).toBeVisible();
  await expect(page.locator(".feed-request")).toHaveCount(0);
  await visit(page, "/audit?source=battleship");
  await expect(page.locator(".feed-item").first()).toBeVisible();
  await expect(page.locator(".feed-request")).toHaveCount(0);
});

test("names it in Russian too", async ({ page, context }) => {
  await useRussian(context);
  await signIn(page, "owner", "/audit?action=passkey.revoked");
  const entry = page.locator(".feed-item").first();
  await expect(entry.locator(".feed-title")).toContainText(
    "Ключ доступа снят оператором",
  );
  await expect(entry.locator(".feed-request")).toContainText("Запрос");
  await expect(
    entry.getByRole("button", { name: "Скопировать ID запроса" }),
  ).toBeVisible();
});
