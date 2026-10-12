import {
  expect,
  settle,
  signIn,
  test,
  tracedRequests,
  useRussian,
  withFailure,
} from "./fixtures";

test("everything on one page", async ({ page }) => {
  await signIn(page, "owner", "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /Good (morning|afternoon|evening|night), Nick/,
  );
  const health = page.getByRole("region", { name: "All services at a glance" });
  for (const service of [
    "Identity",
    "Notifications",
    "Battleship",
    "Payments",
    "Education",
  ])
    await expect(health.getByText(service, { exact: true })).toBeVisible();
  await expect(health.getByText("Healthy")).toHaveCount(5);
  const attention = page.getByRole("region", { name: "What to look at now" });
  await expect(attention).toContainText("deliveries failed");
  // Education's AI assistant answers today (37 of its 500 calls).
  await expect(attention).not.toContainText("AI assistant");
  await expect(
    page.getByRole("region", { name: "Recent audit" }),
  ).toBeVisible();
  for (const panel of [
    "Accounts and sessions",
    "Deliveries",
    "The game right now",
    "Revenue and subscriptions",
    "Readers and books",
  ])
    await expect(page.getByRole("region", { name: panel })).toBeVisible();
  // Charts carry their numbers for assistive technology too.
  await expect(page.locator("figure.chart table caption").first()).toHaveText(
    "New accounts per day, last 7 days",
  );
});

test.describe("one service failing", () => {
  test.use({ userAgent: withFailure("fake-fail=notifications") });

  test("fails only its own panels, with a retry, never zeros", async ({
    page,
  }) => {
    await signIn(page, "owner", "/");
    const deliveries = page.getByRole("region", { name: "Deliveries" });
    await expect(deliveries.getByRole("alert")).toContainText(
      "Could not load delivery numbers",
    );
    await expect(
      deliveries.getByRole("button", { name: "Retry" }),
    ).toBeVisible();
    await expect(deliveries.getByText("Delivered in 24 h")).toHaveCount(0);

    await expect(
      page.getByRole("region", { name: "Accounts and sessions" }),
    ).toContainText("Active sessions");
    await expect(
      page.getByRole("region", { name: "The game right now" }),
    ).toContainText("Players online");
    await expect(
      page.getByRole("region", { name: "Revenue and subscriptions" }),
    ).toContainText("Sales open");

    const health = page.getByRole("region", {
      name: /service is down|at a glance/,
    });
    await expect(health.getByText("Degraded")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "What to look at now" }),
    ).toContainText("Notifications is degraded");

    // Retry asks again; the service is still failing, and the page says so.
    await deliveries.getByRole("button", { name: "Retry" }).click();
    await settle(page);
    await expect(deliveries.getByRole("alert")).toBeVisible();
  });
});

test.describe("Education's AI assistant paused by the spending cap", () => {
  test.use({ userAgent: withFailure("fake-assist=paused") });

  test("needs attention, with today's calls and a link to the assistant", async ({
    page,
  }) => {
    await signIn(page, "owner", "/");
    const attention = page.getByRole("region", { name: "What to look at now" });
    const item = attention
      .locator(".attention-item")
      .filter({ hasText: "Education's AI assistant is paused" });
    await expect(item).toHaveAttribute("data-tone", "warn");
    await expect(item).toContainText(
      "Spending cap reached: 1,000 of 1,000 calls today. Back at 00:00 UTC",
    );
    await item
      .getByRole("link", {
        name: "Open: Education's AI assistant is paused",
      })
      .click();
    await expect(page).toHaveURL(/\/education#assist$/);
    await expect(
      page.getByRole("region", { name: "AI assistant" }).locator(".status"),
    ).toHaveText("Paused");
  });

  test("says so in Russian", async ({ page, context }) => {
    await useRussian(context);
    await signIn(page, "owner", "/");
    const attention = page.getByRole("region", {
      name: "На что посмотреть сейчас",
    });
    await expect(attention).toContainText(
      "ИИ-помощник «Обучения» приостановлен",
    );
    await expect(attention).toContainText(
      /Общий лимит исчерпан: 1\s000 из 1\s000 запросов сегодня\. Снова в 00:00 UTC/,
    );
  });

  test("an editor of the books sees it too", async ({ page }) => {
    await signIn(page, "editor", "/");
    await expect(
      page.getByRole("region", { name: "What to look at now" }),
    ).toContainText("Education's AI assistant is paused");
  });
});

test.describe("Education's overview for an operator without edu.read", () => {
  const tag = `dashboard-billing-${Date.now().toString(36)}`;
  test.use({ userAgent: withFailure(`fake-assist=paused fake-trace=${tag}`) });

  test("is never asked for, so the pause is not shown", async ({ page }) => {
    await signIn(page, "billing", "/");
    await expect(
      page.getByRole("region", { name: "What to look at now" }),
    ).not.toContainText("AI assistant");
    const calls = await tracedRequests(page, tag);
    expect(calls).toContain("GET /payments/v1/admin/issues");
    expect(calls).not.toContain("GET /edu/v1/admin/overview");
  });
});

test.describe("Education failing", () => {
  test.use({ userAgent: withFailure("fake-error=edu") });

  test("leaves the list incomplete, and it says so", async ({ page }) => {
    await signIn(page, "owner", "/");
    const attention = page.getByRole("region", { name: "What to look at now" });
    await expect(attention).toContainText("Could not check Education");
    await expect(
      attention.getByRole("button", { name: "Retry" }),
    ).toBeVisible();
  });
});
