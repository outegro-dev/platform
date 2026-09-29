import type { Page } from "@playwright/test";
import {
  APP,
  control,
  expect,
  expectAccessible,
  expectNoHorizontalScroll,
  layoutShift,
  persona,
  preferRussian,
  readPersona,
  settle,
  test,
  updatePersona,
  watchLayoutShift,
} from "./support";

/** A link in the header's section switcher. */
const section = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Payments sections" })
    .getByRole("link", { name });

/** The page's outage panel (not Next.js' route announcer). */
const outage = (page: Page) =>
  page.getByRole("alert").filter({ hasText: "temporarily unavailable" });

const pendingOrder = (p: { orders: { id: string; status: string }[] }) =>
  p.orders.find((o) => o.status === "pending")?.id as string;
const orderOf = (
  p: { orders: { id: string; productKey: string; status: string }[] },
  productKey: string,
  status: string,
) =>
  p.orders.find((o) => o.productKey === productKey && o.status === status)
    ?.id as string;

test.describe("sign-in", () => {
  test("every page needs a session; SSO brings the buyer back to it", async ({
    page,
  }) => {
    const buyer = await persona(page, { email: "nick@outegro.test" });
    await page.goto("/subscriptions");
    await expect(page).toHaveURL(`${APP}/subscriptions`);
    await expect(
      page.getByRole("heading", { name: "Your subscriptions." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /nick@outegro\.test/ }),
    ).toBeVisible();

    const cookies = await page.context().cookies(APP);
    const session = cookies.find((c) => c.name === "og_at");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(cookies.find((c) => c.name === "og_sso")).toBeUndefined();
    expect((await readPersona(buyer.id)).log.logouts).toBe(0);
  });

  test("a refresh keeps the session alive before it expires", async ({
    page,
  }) => {
    const buyer = await persona(page, { accessTtlSec: 32 });
    await page.goto("/orders");
    await expect(
      page.getByRole("heading", { name: "Your purchases." }),
    ).toBeVisible();
    await page.waitForTimeout(2500);
    await page.goto("/subscriptions");
    await expect(page).toHaveURL(`${APP}/subscriptions`);
    await expect(page.getByText("Battleship Premium").first()).toBeVisible();
    expect((await readPersona(buyer.id)).log.refreshes).toBeGreaterThanOrEqual(
      1,
    );
  });

  test("signing out ends the session and does not sign straight back in", async ({
    page,
  }) => {
    const buyer = await persona(page);
    await page.goto("/orders");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${APP}/signed-out`);
    await expect(
      page.getByRole("heading", { name: "You're signed out" }),
    ).toBeVisible();
    expect(
      (await page.context().cookies(APP)).some((c) => c.name === "og_at"),
    ).toBe(false);
    expect((await readPersona(buyer.id)).log.logouts).toBe(1);
    await expectAccessible(page, "signed out");

    await page.getByRole("link", { name: "Sign in again" }).click();
    await expect(page).toHaveURL(`${APP}/orders`);
  });

  test("a broken sign-in explains itself and offers a new start", async ({
    page,
  }) => {
    await persona(page);
    await page.goto("/auth/callback?code=x&state=forged-state-0123456789");
    await expect(page).toHaveURL(/\/auth\/error\?reason=state_mismatch$/);
    await expect(
      page.getByRole("heading", { name: "Sign-in didn't finish" }),
    ).toBeVisible();
    await expect(
      page.getByText("expired or was opened in another browser"),
    ).toBeVisible();
    await expectAccessible(page, "sign-in error");
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page).toHaveURL(`${APP}/orders`);
  });

  test("pages carry a nonce CSP and no-store caching", async ({ page }) => {
    await persona(page);
    await page.goto("/orders");
    const response = await page.request.get("/orders");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toMatch(
      /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
    );
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["cache-control"]).toContain("no-store");
  });
});

test.describe("purchases", () => {
  test("lists products, apps, amounts, dates and plain statuses", async ({
    page,
  }) => {
    await persona(page);
    await page.goto("/orders");
    const rows = page.locator("article.order-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("Silver Fleet");
    await expect(rows.nth(0)).toContainText("Battleship · One-time purchase");
    await expect(rows.nth(0)).toContainText("$0.59");
    await expect(rows.nth(0)).toContainText("Paid");
    await expect(rows.nth(1)).toContainText("Failed");
    await expect(rows.nth(2)).toContainText("Battleship Premium");
    await expect(rows.nth(2)).toContainText("₽50");
    await expect(rows.nth(3)).toContainText("€0.52");
    await expect(rows.nth(3)).toContainText("Refunded");
    await expectAccessible(page, "purchases");
  });

  test("an order shows its progress, what it gives and a summary", async ({
    page,
  }) => {
    const buyer = await persona(page);
    await page.goto(`/orders/${orderOf(buyer, "battleship-premium", "paid")}`);
    await expect(
      page.getByRole("heading", { name: "Access is active in Battleship" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open Battleship" }).first(),
    ).toHaveAttribute("href", "https://battleship.outegro.dev/shop");
    const steps = page.locator(".timeline-step");
    await expect(steps).toHaveText([
      /Order created/,
      /Payment confirmed/,
      /Access opened/,
    ]);
    const summary = page.getByRole("region", { name: "Order summary" });
    await expect(summary).toContainText("Subscription · Monthly");
    await expect(summary).toContainText("₽50.00");
    await expect(summary).toContainText("Lava.top");
    await expect(page.getByText(/Hard and expert bots/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Manage subscription" }),
    ).toBeVisible();
    await expectAccessible(page, "order detail");
  });

  test("shows older purchases page by page", async ({ page }) => {
    await persona(page, { scenario: "many" });
    await page.goto("/orders");
    await expect(page.locator("article.order-row")).toHaveCount(20);
    await page.getByRole("link", { name: "Older purchases" }).click();
    await expect(page.locator("article.order-row")).toHaveCount(6);
    await page.getByRole("link", { name: "Latest purchases" }).click();
    await expect(page.locator("article.order-row")).toHaveCount(20);
  });

  test("someone else's order is a plain 404 without their data (TC-PAY-11-03)", async ({
    page,
    browser,
    expectedConsole,
  }) => {
    expectedConsole.push(/status of 404/);
    const other = await browser.newContext();
    const owner = await persona(await other.newPage());
    await other.close();
    await persona(page, { scenario: "empty" });
    const foreign = orderOf(owner, "battleship-premium", "paid");
    await page.goto(`/orders/${foreign}`);
    await expect(
      page.getByRole("heading", { name: "We couldn't find this order" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("₽50");
    const api = await page.request.get(`/api/orders/${foreign}`);
    expect(api.status()).toBe(404);
    expect(await api.json()).toEqual({ status: "not-found" });
    await expectAccessible(page, "order not found");
  });
});

test.describe("return from Lava", () => {
  test("a success hint alone grants nothing; the page waits for the server, then shows access (TC-PAY-11-01)", async ({
    page,
  }) => {
    const buyer = await persona(page, { scenario: "returning" });
    const orderId = pendingOrder(buyer);
    await watchLayoutShift(page);
    await page.goto(`/orders?orderId=${orderId}&result=success`);
    await expect(page).toHaveURL(`${APP}/orders/${orderId}`);
    await expect(
      page.getByRole("heading", { name: "Confirming your payment" }),
    ).toBeVisible();
    await expect(page.locator(".order-head-meta")).toContainText("Processing");
    await expect(page.getByText("Checking every 3 seconds")).toBeVisible();
    await expect(page.getByText("Access is active")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /Continue to payment/ }),
    ).toHaveAttribute("href", /^https:\/\/app\.lava\.top\/pay\//);
    await expectAccessible(page, "processing payment");
    // Several polls see "pending" before the provider confirms.
    await page.waitForTimeout(3500);
    expect((await readPersona(buyer.id)).log.orderPolls).toBeGreaterThanOrEqual(
      2,
    );

    await settle(orderId, "paid", { afterMs: 1000 });
    await expect(
      page.getByRole("heading", { name: "Access is active in Battleship" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".order-head-meta")).toContainText("Paid");
    await expect(page.locator(".timeline-step").last()).toContainText(
      "Access opened",
    );
    await expect(
      page.getByRole("region", { name: "Order summary" }),
    ).not.toContainText("Not paid");
    await expect(page.getByText("Checking every 3 seconds")).toHaveCount(0);
    expect(await layoutShift(page)).toBeLessThan(0.02);
    await expectAccessible(page, "payment confirmed");
  });

  test("a failed payment ends in retry guidance", async ({ page }) => {
    const buyer = await persona(page, { scenario: "returning" });
    const orderId = pendingOrder(buyer);
    await watchLayoutShift(page);
    await page.goto(`/?order=${orderId}`);
    await expect(page).toHaveURL(`${APP}/orders/${orderId}`);
    await settle(orderId, "failed", { afterMs: 500 });
    await expect(
      page.getByRole("heading", { name: "The payment didn't go through" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/Check your card or choose another payment method/),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/catalog#battleship-premium",
    );
    await expect(page.locator(".timeline-step").nth(1)).toContainText(
      "Payment failed",
    );
    expect(await layoutShift(page)).toBeLessThan(0.02);
    await expectAccessible(page, "payment failed");
  });

  test("coming back cancelled reads 'not completed'; the server still decides", async ({
    page,
  }) => {
    const buyer = await persona(page, { scenario: "returning" });
    const orderId = pendingOrder(buyer);
    await watchLayoutShift(page);
    await page.goto(`/checkout/result?orderId=${orderId}&result=cancel`);
    await expect(page).toHaveURL(`${APP}/orders/${orderId}?result=cancel`);
    await expect(
      page.getByRole("heading", { name: "Payment not completed" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continue to payment" }),
    ).toHaveAttribute("href", /^https:\/\/app\.lava\.top\/pay\//);
    await expect(page.getByText("Checking every 3 seconds")).toBeVisible();
    await expectAccessible(page, "payment not completed");
    // The buyer did pay after all: the server's answer wins over the hint.
    await settle(orderId, "paid", { afterMs: 500 });
    await expect(
      page.getByRole("heading", { name: "Access is active in Battleship" }),
    ).toBeVisible({ timeout: 15_000 });
    expect(await layoutShift(page)).toBeLessThan(0.02);
  });

  test("paid before the access grant shows activation, then access (TC-PAY-11-04)", async ({
    page,
  }) => {
    const buyer = await persona(page, { scenario: "returning" });
    const orderId = pendingOrder(buyer);
    await settle(orderId, "paid", { afterMs: 0, accessAfterMs: 5000 });
    await page.goto(`/checkout/result?orderId=${orderId}&result=success`);
    await expect(page).toHaveURL(`${APP}/orders/${orderId}`);
    await expect(
      page.getByRole("heading", { name: "Payment received, opening access" }),
    ).toBeVisible();
    await expect(page.locator(".order-head-meta")).toContainText("Activating");
    await expect(
      page.getByRole("heading", { name: "Access is active in Battleship" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("keeps watching through a payments outage", async ({
    page,
    expectedConsole,
  }) => {
    expectedConsole.push(/status of 503/);
    const buyer = await persona(page, { scenario: "returning" });
    const orderId = pendingOrder(buyer);
    await page.goto(`/orders/${orderId}`);
    await expect(
      page.getByRole("heading", { name: "Confirming your payment" }),
    ).toBeVisible();
    await updatePersona(buyer.id, { payments: "down" });
    await expect(page.getByText("Connection hiccup, retrying…")).toBeVisible({
      timeout: 10_000,
    });
    await updatePersona(buyer.id, { payments: "up" });
    await settle(orderId, "paid");
    await expect(
      page.getByRole("heading", { name: "Access is active in Battleship" }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("subscriptions", () => {
  test("cancel renewal asks first and keeps access until the paid end (TC-PAY-08-01)", async ({
    page,
  }) => {
    const buyer = await persona(page);
    await watchLayoutShift(page);
    await page.goto("/subscriptions");
    const current = page.getByRole("region", { name: /Current/ });
    const card = current.getByRole("article");
    await expect(card).toContainText("Active");
    await expect(card).toContainText("includes 3 grace days");
    await expect(card).toContainText(/Renews automatically on/);

    // Keyboard: open, look, keep.
    await card.getByRole("button", { name: "Cancel renewal" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Cancel renewal?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("You keep access until");
    await expect(dialog).toContainText("This isn't a refund");
    await expectAccessible(page, "cancel dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      card.getByRole("button", { name: "Cancel renewal" }),
    ).toBeFocused();
    expect((await readPersona(buyer.id)).log.cancels).toHaveLength(0);

    await card.getByRole("button", { name: "Cancel renewal" }).click();
    await dialog.getByRole("button", { name: "Cancel renewal" }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText("Renewal off");
    await expect(card).toContainText(/Renewal is off\. You keep access until/);
    await expect(
      card.getByRole("button", { name: "Cancel renewal" }),
    ).toHaveCount(0);
    expect((await readPersona(buyer.id)).log.cancels).toHaveLength(1);
    expect(await layoutShift(page)).toBeLessThan(0.02);

    await page.reload();
    await expect(
      page.getByRole("region", { name: /Current/ }).getByRole("article"),
    ).toContainText(/Renewal is off\. Access stays until/);
  });

  test("an unconfirmed cancellation shows as pending, not as done", async ({
    page,
  }) => {
    await persona(page, { cancelMode: "pending" });
    await page.goto("/subscriptions");
    const card = page
      .getByRole("region", { name: /Current/ })
      .getByRole("article");
    await card.getByRole("button", { name: "Cancel renewal" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel renewal" })
      .click();
    await expect(card).toContainText("Cancelling");
    await expect(card).toContainText(/awaiting confirmation/);
    await expect(card).toContainText("Turning off…");
  });

  test("an outage during cancel keeps the old state and allows a retry", async ({
    page,
  }) => {
    const buyer = await persona(page);
    await page.goto("/subscriptions");
    const card = page
      .getByRole("region", { name: /Current/ })
      .getByRole("article");
    await card.getByRole("button", { name: "Cancel renewal" }).click();
    await updatePersona(buyer.id, { payments: "down" });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel renewal" }).click();
    await expect(dialog).toContainText("We couldn't confirm the result");
    await expect(card).toContainText("Active");
    await updatePersona(buyer.id, { payments: "up" });
    await dialog.getByRole("button", { name: "Cancel renewal" }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText("Renewal off");
  });

  test("words every subscription state", async ({ page }) => {
    await persona(page, { scenario: "states" });
    await page.goto("/subscriptions");
    const current = page.getByRole("region", { name: /Current/ });
    await expect(current.getByRole("article")).toHaveCount(4);
    await expect(current).toContainText("Renewal overdue");
    await expect(current).toContainText("Cancelling");
    await expect(current).toContainText("Renewal off");
    await expect(current).toContainText("Active");
    await expect(page.getByRole("region", { name: /Past/ })).toContainText(
      "Ended",
    );
    await expectAccessible(page, "subscription states");
  });
});

test.describe("catalog", () => {
  test("buying goes to Lava with a key, comes back, and waits for the server", async ({
    page,
  }) => {
    const buyer = await persona(page, { scenario: "empty" });
    await page.route("https://app.lava.top/**", async (route) => {
      const invoice = new URL(route.request().url()).pathname.split("/").pop();
      const info = await control<{ orderId: string; success: string }>(
        `/__control/invoices/${invoice}`,
      );
      await settle(info.orderId, "paid", { afterMs: 4000 });
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Lava</title><a href="${info.success}">Back to the shop</a>`,
      });
    });
    await page.goto("/catalog");
    const card = page.getByRole("article", { name: "Battleship Premium" });
    // English preselects dollars; the buyer picks, nothing is converted.
    await expect(card.getByRole("radio", { name: "USD" })).toBeChecked();
    await expect(card).toContainText("$0.59");
    await card.getByRole("radio", { name: "RUB" }).check();
    await expect(card).toContainText("₽50");
    await expectAccessible(page, "catalog");
    await card.getByRole("button", { name: "Subscribe" }).click();
    await expect(page).toHaveURL(/^https:\/\/app\.lava\.top\/pay\//);

    const [checkout] = (await readPersona(buyer.id)).log.checkouts;
    expect(checkout?.productKey).toBe("battleship-premium");
    expect(checkout?.currency).toBe("RUB");
    expect(checkout?.key).toMatch(/^pw-[0-9a-f-]{36}$/);
    // No returnUrl: the buyer comes back to /checkout/result?orderId=….
    expect(checkout?.returnUrl).toBeNull();

    await page.getByRole("link", { name: "Back to the shop" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "Confirming your payment" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Access is active in Battleship" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("a payment page outside CHECKOUT_ORIGINS is never opened", async ({
    page,
  }) => {
    await persona(page, { scenario: "empty", checkoutMode: "offsite" });
    await page.goto("/catalog");
    const card = page.getByRole("article", { name: "Silver Fleet" });
    await card.getByRole("button", { name: "Buy" }).click();
    await expect(card).toContainText("isn't one we trust");
    await expect(page).toHaveURL(`${APP}/catalog`);
  });

  test("owned products link to the purchase instead of selling again", async ({
    page,
  }) => {
    await persona(page);
    await page.goto("/catalog");
    await expect(
      page.getByRole("article", { name: "Silver Fleet" }),
    ).toContainText("Yours");
    await expect(
      page.getByRole("article", { name: "Battleship Premium" }),
    ).toContainText("Subscribed");
    await expect(
      page.getByRole("button", { name: /Buy|Subscribe/ }),
    ).toHaveCount(0);
  });

  test("closed sales say so and disable buying", async ({ page }) => {
    await persona(page, { scenario: "empty", catalog: "closed" });
    await page.goto("/catalog");
    await expect(page.getByText("Sales haven't opened yet")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Subscribe" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Buy" })).toBeDisabled();
  });
});

test.describe("honest states", () => {
  test("an empty account says so plainly (TC-PAY-11-02)", async ({ page }) => {
    await persona(page, { scenario: "empty", catalog: "empty" });
    await page.goto("/orders");
    await expect(
      page.getByRole("heading", { name: "No purchases yet" }),
    ).toBeVisible();
    await expectAccessible(page, "no purchases");
    await section(page, "Subscriptions").click();
    await expect(
      page.getByRole("heading", { name: "No subscriptions" }),
    ).toBeVisible();
    await section(page, "Catalog").click();
    await expect(
      page.getByRole("heading", { name: "Nothing for sale yet" }),
    ).toBeVisible();
  });

  test("a payments outage is an error with retry, never 'no purchases'", async ({
    page,
  }) => {
    const buyer = await persona(page, { payments: "down" });
    for (const [path, heading] of [
      ["/orders", "No purchases yet"],
      ["/subscriptions", "No subscriptions"],
      ["/catalog", "Nothing for sale yet"],
    ] as const) {
      await page.goto(path);
      await expect(outage(page)).toContainText(
        "Payments are temporarily unavailable",
      );
      await expect(
        page.getByRole("button", { name: "Try again" }),
      ).toBeVisible();
      await expect(page.getByText(heading)).toHaveCount(0);
    }
    await expectAccessible(page, "payments unavailable");

    // Back up: "Try again" loads the data in place.
    await page.goto("/orders");
    await expect(outage(page)).toBeVisible();
    await updatePersona(buyer.id, { payments: "up" });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("article.order-row")).toHaveCount(4);
  });

  test("loading is visible, described in text, and moves nothing", async ({
    page,
  }) => {
    const buyer = await persona(page);
    await page.goto("/orders");
    await updatePersona(buyer.id, { latencyMs: 1500 });
    await watchLayoutShift(page);
    await page.goto("/orders");
    await expect(page.locator("article.order-row")).toHaveCount(4);
    expect(await layoutShift(page)).toBeLessThan(0.02);

    await section(page, "Subscriptions").click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Loading your subscriptions…" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /Current/ }).getByRole("article"),
    ).toHaveCount(1);
    await section(page, "Catalog").click();
    await expect(
      page.getByRole("status").filter({ hasText: "Loading the catalog…" }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Silver Fleet" }),
    ).toBeVisible();
  });
});

test.describe("Russian", () => {
  test("the whole flow reads in Russian with local money and dates", async ({
    page,
  }) => {
    const buyer = await persona(page);
    await preferRussian(page);
    await page.goto("/orders");
    await expect(
      page.getByRole("heading", { name: "Ваши покупки." }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    const rows = page.locator("article.order-row");
    await expect(rows.nth(0)).toContainText("Серебряный флот");
    await expect(rows.nth(0)).toContainText("Оплачено");
    await expect(rows.nth(2)).toContainText(/50\s₽/);
    await expect(rows.nth(3)).toContainText("Возвращено");
    await expectAccessible(page, "purchases (ru)");

    await page.goto(`/orders/${orderOf(buyer, "battleship-premium", "paid")}`);
    await expect(
      page.getByRole("heading", {
        name: "Доступ открыт в приложении Морской бой",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Сводка заказа" }),
    ).toContainText(/50,00\s₽/);

    await page.goto("/subscriptions");
    await page.getByRole("button", { name: "Отменить продление" }).click();
    const dialog = page.getByRole("dialog", { name: "Отменить продление?" });
    await expect(dialog).toContainText("Доступ сохранится до");
    await expectAccessible(page, "cancel dialog (ru)");
  });

  test("switching the language keeps the page and stores the choice", async ({
    page,
  }) => {
    await persona(page);
    await page.goto("/subscriptions");
    await page.getByRole("button", { name: /RU/ }).click();
    await expect(
      page.getByRole("heading", { name: "Ваши подписки." }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${APP}/subscriptions`);
    const locale = (await page.context().cookies(APP)).find(
      (c) => c.name === "og_locale",
    );
    expect(locale?.value).toBe("ru");
  });
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
  });

  test("every screen fits 360 px with 44 px targets", async ({ page }) => {
    const buyer = await persona(page);
    for (const path of [
      "/orders",
      `/orders/${orderOf(buyer, "battleship-premium", "paid")}`,
      "/subscriptions",
      "/catalog",
    ]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalScroll(page);
      for (const link of await page
        .getByRole("navigation", { name: "Payments sections" })
        .getByRole("link")
        .all()) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await expectAccessible(page, `${path} on a phone`);
    }
    const cancel = page.getByRole("button", { name: "Cancel renewal" });
    await page.goto("/subscriptions");
    expect((await cancel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
      44,
    );
  });

  test("the return page settles without shifting the layout", async ({
    page,
  }) => {
    const buyer = await persona(page, { scenario: "returning" });
    const orderId = pendingOrder(buyer);
    await watchLayoutShift(page);
    await page.goto(`/orders/${orderId}`);
    await expect(
      page.getByRole("heading", { name: "Confirming your payment" }),
    ).toBeVisible();
    await settle(orderId, "failed", { afterMs: 500 });
    await expect(
      page.getByRole("heading", { name: "The payment didn't go through" }),
    ).toBeVisible({ timeout: 15_000 });
    expect(await layoutShift(page)).toBeLessThan(0.02);
    await expectNoHorizontalScroll(page);
  });
});
