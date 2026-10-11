import type { Page } from "@playwright/test";
import {
  expect,
  expectAccessible,
  signIn,
  test,
  useRussian,
  visit,
} from "./fixtures";

const REQUEST = "3f1d2a9c-5b7e-4c21-9a0d-6e8f4b2c1d70";

/** The action filter's suggestions, as the browser's list offers them. */
const suggestions = (page: Page) =>
  page.locator("#filter-action").evaluate((input) =>
    [...((input as HTMLInputElement).list?.options ?? [])].map((option) => ({
      value: option.value,
      label: option.label,
    })),
  );

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

test("the action filter suggests every known action by name and still takes any code", async ({
  page,
}) => {
  await signIn(page, "owner", "/audit");
  // A text field with a list of known codes: a combobox named by its label.
  const field = page.getByRole("combobox", { name: "Action" });
  await expect(field).toBeEditable();
  const offered = await suggestions(page);
  const codes = offered.map((option) => option.value);
  // Every feed's actions, each once, named in words with the feed.
  expect(new Set(codes).size).toBe(codes.length);
  expect(offered).toEqual(
    expect.arrayContaining([
      { value: "role.granted", label: "Role granted · Identity" },
      {
        value: "passkey.revoked",
        label: "Passkey removed by an operator · Identity",
      },
      { value: "delivery.retry", label: "Delivery retried · Notifications" },
      { value: "match.aborted", label: "Match aborted · Battleship" },
      { value: "grant.created", label: "Access granted · Payments" },
      { value: "book.status.changed", label: "Status changed · Education" },
    ]),
  );
  for (const option of offered)
    expect(option.label, option.value).not.toContain(option.value);
  await expectAccessible(page);

  // A suggested code filters like a typed one.
  await field.fill("passkey.revoked");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/action=passkey.revoked/);
  await expect(page.locator(".feed-title").first()).toContainText(
    "Passkey removed by an operator",
  );
  // Free text still goes: a code no feed has written yet finds nothing.
  await field.fill("made.up.action");
  await field.press("Enter");
  await expect(page).toHaveURL(/action=made.up.action/);
  await expect(field).toHaveValue("made.up.action");
  await expect(page.getByText("No actions recorded yet")).toBeVisible();
  await expect(page.locator(".feed-item")).toHaveCount(0);
});

test("the action suggestions are named in Russian too", async ({
  page,
  context,
}) => {
  await useRussian(context);
  await signIn(page, "owner", "/audit");
  await expect(page.getByRole("combobox", { name: "Действие" })).toBeEditable();
  expect(await suggestions(page)).toEqual(
    expect.arrayContaining([
      {
        value: "passkey.revoked",
        label: "Ключ доступа снят оператором · Identity",
      },
      { value: "match.aborted", label: "Матч прерван · Морской бой" },
    ]),
  );
});
