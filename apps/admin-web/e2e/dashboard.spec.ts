import { expect, settle, signIn, test, withFailure } from "./fixtures";

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
  await expect(
    page.getByRole("region", { name: "What to look at now" }),
  ).toContainText("deliveries failed");
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
