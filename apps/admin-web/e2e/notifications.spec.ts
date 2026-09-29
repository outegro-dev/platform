import { expect, settle, signIn, test, visit } from "./fixtures";

test("filters deliveries in the URL and retries a failed one", async ({
  page,
}) => {
  await signIn(page, "owner", "/notifications/deliveries");
  await page.getByLabel("State").selectOption("failed");
  await page.getByLabel("Channel").selectOption("email");
  await page.getByLabel("Template").selectOption("billing.payment-confirmed");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(
    /\/notifications\/deliveries\?state=failed&channel=email&template=billing\.payment-confirmed/,
  );
  await settle(page);
  // The filtered address can be shared: a fresh load shows the same list.
  await page.reload();
  await settle(page);
  await expect(page.getByLabel("State")).toHaveValue("failed");

  await page.locator("table .row-link").first().click();
  await settle(page);
  await expect(page.locator(".panel .status").first()).toHaveText("Failed");
  await page.getByRole("button", { name: "Retry delivery" }).click();
  const dialog = page.getByRole("dialog", { name: "Retry this delivery?" });
  await dialog
    .getByLabel("Reason")
    .fill("SMTP provider is back after the outage");
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Delivery queued again."),
  ).toBeVisible();
  await expect(page.locator(".panel .status").first()).toHaveText("Pending");
});

test("retrying an unknown delivery needs an explicit confirmation", async ({
  page,
}) => {
  await signIn(
    page,
    "owner",
    "/notifications/deliveries?state=unknown&channel=telegram",
  );
  await page.locator("table .row-link").first().click();
  await settle(page);
  await page.getByRole("button", { name: "Retry delivery" }).click();
  const dialog = page.getByRole("dialog", { name: "Retry this delivery?" });
  await expect(dialog).toContainText("the recipient could get it twice");
  await dialog.getByLabel("Reason").fill("User confirmed nothing arrived");
  const confirm = dialog.getByRole("button", { name: "Retry" });
  await expect(confirm).toBeDisabled();
  await dialog
    .getByLabel("I understand the recipient may receive this message twice.")
    .check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByRole("status").getByText("Delivery queued again."),
  ).toBeVisible();
});

test("previews a template in a sandboxed frame, in both languages", async ({
  page,
}) => {
  await signIn(page, "owner", "/notifications/templates");
  await page.getByRole("link", { name: "billing.payment-confirmed" }).click();
  await settle(page);
  const frame = page.locator("iframe.preview-frame");
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(
    page.frameLocator("iframe.preview-frame").getByText("Payment received"),
  ).toBeVisible();
  await expect(
    page.getByText("Payment received: Battleship Premium"),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Preview language" })
    .getByRole("link", { name: "RU" })
    .click();
  await settle(page);
  await expect(page).toHaveURL(/locale=ru/);
  await expect(
    page.frameLocator("iframe.preview-frame").getByText("Оплата получена"),
  ).toBeVisible();
});

test("pauses a channel with a reason and handles a stale page", async ({
  page,
  context,
}) => {
  await signIn(page, "owner", "/notifications/channels");
  const stale = await context.newPage();
  await visit(stale, "/notifications/channels");

  const telegram = page.getByRole("region", { name: "Telegram", exact: true });
  await telegram.getByRole("button", { name: "Pause Telegram" }).click();
  const dialog = page.getByRole("dialog", { name: "Pause Telegram?" });
  await expect(dialog).toContainText(
    "New and pending deliveries wait; nothing is dropped.",
  );
  await dialog.getByLabel("Reason").fill("Bot token rotation in progress");
  await dialog.getByRole("button", { name: "Pause channel" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").getByText("Channel telegram paused."),
  ).toBeVisible();
  await expect(telegram).toContainText("Paused");

  // The second tab still shows the old version: Notifications refuses it,
  // the tab says so and shows the current state instead.
  const staleTelegram = stale.getByRole("region", {
    name: "Telegram",
    exact: true,
  });
  await staleTelegram.getByRole("button", { name: "Pause Telegram" }).click();
  const staleDialog = stale.getByRole("dialog", { name: "Pause Telegram?" });
  await staleDialog.getByLabel("Reason").fill("Same change from an old tab");
  await staleDialog.getByRole("button", { name: "Pause channel" }).click();
  await expect(
    stale
      .getByRole("status")
      .getByText("Someone changed these settings a moment ago.", {
        exact: false,
      }),
  ).toBeVisible();
  await expect(staleTelegram).toContainText("Paused");
  await expect(
    staleTelegram.getByRole("button", { name: "Resume Telegram" }),
  ).toBeVisible();
  await stale.close();

  // Resume, so other scenarios see the channel running.
  await telegram.getByRole("button", { name: "Resume Telegram" }).click();
  const resume = page.getByRole("dialog", { name: "Resume Telegram?" });
  await resume.getByLabel("Reason").fill("Rotation finished");
  await resume.getByRole("button", { name: "Resume channel" }).click();
  await expect(telegram).toContainText("Running");
});

test("sends a test message to the operator", async ({ page }) => {
  await signIn(page, "owner", "/notifications/channels");
  await page.getByRole("button", { name: "Send a test via Email" }).click();
  await expect(
    page
      .getByRole("status")
      .getByText("Test message for email queued to your own address."),
  ).toBeVisible();
});
