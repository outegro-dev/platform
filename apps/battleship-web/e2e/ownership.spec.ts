import {
  APP,
  CHECKOUT,
  expect,
  expectAccessible,
  PAY,
  PLATFORM,
  signInAndConnect,
  test,
} from "./support/fixtures.ts";

/*
 * What the player owns, as payments and the game report it, and the way to
 * manage it on pay.outegro.dev (PAY_URL) with a way back to the game.
 */

const back = (path: string) => encodeURIComponent(`${APP}${path}`);

/** Payments' state of the user's Premium subscription (null: none). */
async function setSubscription(
  uid: string,
  subscription: { state: string; autoRenew: boolean } | null,
) {
  const response = await fetch(`${PLATFORM}/__test/users/${uid}/subscription`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription ?? {}),
  });
  expect(response.ok).toBe(true);
}

test.describe("what the player owns", () => {
  test("right after subscribing, the shop shows the renewal and the way back to play", async ({
    page,
    game,
  }) => {
    // The provider's page sends the buyer back with the result appended.
    await page.route(`${CHECKOUT}/**`, async (route) => {
      const url = new URL(route.request().url());
      const to = `${url.searchParams.get("return")}?orderId=${url.searchParams.get("order")}&amp;result=success`;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><title>Checkout</title><a href="${to}">Pay</a></html>`,
      });
    });
    const fake = await signInAndConnect(page, game, "free", "/shop");
    await page.getByTestId("buy-premium").click();
    await page.waitForURL(`${CHECKOUT}/**`);
    await page.getByRole("link", { name: "Pay" }).click();
    await page.waitForURL(/\/shop\?orderId=[0-9a-f-]{36}&result=success$/);
    const banner = page.getByTestId("shop-banner");
    await expect(
      banner.getByRole("link", { name: "Back to the game" }),
    ).toHaveAttribute("href", "/");

    // Payments grants Premium from the new subscription; the game says so.
    const grant = await fetch(`${PLATFORM}/__test/users/${fake.uid}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "premium" }),
    });
    expect(grant.ok).toBe(true);
    (await game.current()).playerUpdated({ premium: true });
    await expect(banner).toContainText("Payment received");
    await expect(page.getByTestId("owned-premium")).toHaveText(
      "Active · renews Oct 29, 2026",
    );
    await expect(page.getByTestId("manage-subscription")).toBeVisible();
    await banner.getByRole("link", { name: "Play now" }).click();
    await expect(page).toHaveURL(`${APP}/`);
  });

  test("Premium shows renewal as payments reports it, managed on pay", async ({
    page,
    game,
  }) => {
    const fake = await signInAndConnect(page, game, "premium", "/shop");
    const owned = page.getByTestId("owned-premium");
    await expect(owned).toHaveText("Active · renews Oct 29, 2026");
    const manage = page.getByTestId("manage-subscription");
    await expect(manage).toHaveText("Manage subscription");
    await expect(manage).toHaveAttribute(
      "href",
      `${PAY}/subscriptions?return=${back("/shop")}`,
    );

    const states = [
      [
        { state: "cancel_requested", autoRenew: true },
        "Active until Nov 1, 2026 · cancellation pending",
      ],
      [
        { state: "cancelling", autoRenew: false },
        "Active until Nov 1, 2026 · won't renew",
      ],
      [
        { state: "active", autoRenew: false },
        "Active until Nov 1, 2026 · won't renew",
      ],
      [
        { state: "past_due", autoRenew: true },
        "Active until Nov 1, 2026 · renewal not confirmed yet",
      ],
    ] as const;
    for (const [subscription, text] of states) {
      await setSubscription(fake.uid, subscription);
      await page.reload();
      await expect(owned, subscription.state).toHaveText(text);
    }
    // Payments has nothing to add: the game's own grant says until when.
    await setSubscription(fake.uid, null);
    await page.reload();
    await expect(owned).toHaveText("Active until Oct 29, 2026");
    await expect(manage).toBeVisible();
  });

  test("the Silver Fleet is owned for good, receipts are on pay", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "silver", "/shop");
    await expect(page.getByTestId("owned-silver")).toHaveText("Owned");
    await expect(page.getByTestId("your-purchases")).toHaveAttribute(
      "href",
      `${PAY}/orders?return=${back("/shop")}`,
    );
    await expect(page.getByTestId("buy-premium")).toBeVisible();
  });

  test("the shop says where payments, renewal and cancellation happen", async ({
    page,
    context,
  }) => {
    await page.goto("/shop");
    const note = page.getByTestId("payments-note");
    await expect(note).toHaveText(
      "Payments go through pay.fake.test with Lava. Renewal and cancellation are managed there too.",
    );
    await expect(
      note.getByRole("link", { name: "pay.fake.test" }),
    ).toHaveAttribute("href", `${PAY}/orders?return=${back("/shop")}`);

    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await page.reload();
    await expect(note).toHaveText(
      "Оплата проходит на pay.fake.test через Lava. Там же продлевают и отменяют подписку.",
    );
  });

  test("Russian players read renewal in Russian", async ({
    page,
    game,
    context,
  }) => {
    await context.addCookies([
      { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
    ]);
    await signInAndConnect(page, game, "premium", "/shop");
    await expect(page.getByTestId("owned-premium")).toHaveText(
      "Активна · продлится 29 окт. 2026 г.",
    );
    await expect(page.getByTestId("manage-subscription")).toHaveText(
      "Управлять подпиской",
    );
  });

  test("the profile lists what the account owns and where to manage it", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "premium", "/profile");
    const card = page.getByTestId("purchases-card");
    await expect(card.getByTestId("profile-premium")).toHaveText(
      "Active · renews Oct 29, 2026",
    );
    await expect(
      card.getByTestId("profile-manage-subscription"),
    ).toHaveAttribute(
      "href",
      `${PAY}/subscriptions?return=${back("/profile")}`,
    );
    await expect(card.getByTestId("profile-silver")).toHaveText(
      "Not bought yet",
    );
    await expect(
      card.getByRole("link", { name: "See the shop" }),
    ).toHaveAttribute("href", "/shop");
    await expect(card.getByTestId("profile-your-purchases")).toHaveAttribute(
      "href",
      `${PAY}/orders?return=${back("/profile")}`,
    );
    await expect(card).toContainText("pay.fake.test");
    await expect(page.getByTestId("manage-account")).toHaveAttribute(
      "href",
      `${PLATFORM}/account`,
    );
    await expectAccessible(page, "profile with purchases");
  });

  test("a free player's profile says so and points to the shop", async ({
    page,
    game,
  }) => {
    await signInAndConnect(page, game, "silver", "/profile");
    const card = page.getByTestId("purchases-card");
    await expect(card.getByTestId("profile-premium")).toHaveText("Not active");
    await expect(card.getByTestId("profile-silver")).toHaveText(
      "Owned, yours forever",
    );
    await expect(card.getByTestId("profile-manage-subscription")).toHaveCount(
      0,
    );
  });
});
