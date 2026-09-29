import { expect, phone, settle, signIn, test } from "./fixtures";

test("switches to Russian and keeps it", async ({ page, context }) => {
  await signIn(page, "owner", "/");
  await page.getByRole("button", { name: "RU — Русский" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Разделы консоли" })
      .getByRole("link", { name: "Пользователи" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === "og_locale")?.value).toBe(
    "ru",
  );
  await page.reload();
  await settle(page);
  await expect(
    page.getByRole("region", { name: "Все сервисы одним взглядом" }),
  ).toBeVisible();
  await expect(page.getByText("Продажи открыты").first()).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("navigates through the menu sheet", async ({ page }) => {
    await signIn(page, "owner", "/");
    await expect(
      page.getByRole("complementary", { name: "Console" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    const sheet = page.getByRole("dialog", { name: "Navigation" });
    await sheet.getByRole("link", { name: "Users" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL("/users");
    await settle(page);
    // Tables become labelled cards: no sideways scrolling on a phone.
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(390);
  });
});
