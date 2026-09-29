import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn } from "./support";

// Local services run without Google and Telegram credentials: these tests
// cover the pages, the guards and the unavailable states; the provider flows
// are covered by auth-backend and notifications-backend integration tests.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`,
  });
});

test("security lists the sign-in methods of the account", async ({ page }) => {
  await page.goto("/account/security");
  await expect(page).toHaveURL(/\/login\?continue=%2Faccount%2Fsecurity$/);
  const email = await signIn(page);
  await expect(page).toHaveURL("/account/security");
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  await expect(page.getByText(`${email} · always available`)).toBeVisible();
  await expect(page.getByText("Not available right now")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect" })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});

test("Google sign-in explains itself when it is not configured", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: "Continue with Google" }),
  ).toHaveCount(0);
  await page.goto("/login/google/start?continue=%2Faccount%2Fsessions");
  await expect(page).toHaveURL(
    /\/login\?error=google_unavailable&continue=%2Faccount%2Fsessions$/,
  );
  // Next.js keeps its own (empty) route announcer as an alert region.
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Google sign-in is unavailable right now. Use the email code instead.",
    }),
  ).toBeVisible();
});

test("a Google callback without a matching request is refused", async ({
  page,
}) => {
  await page.goto("/login/google/callback?state=forged-state&code=fake-code");
  await expect(page).toHaveURL(/\/login\?error=google_failed$/);
  await expect(
    page.getByRole("alert").filter({
      hasText: "Google sign-in did not complete. Please try again.",
    }),
  ).toBeVisible();
});

test("TC-ID-10-02: a link callback with a forged state never reaches Identity", async ({
  page,
  context,
}) => {
  await page.goto("/login?continue=%2Faccount%2Fsecurity");
  await signIn(page);
  await expect(page).toHaveURL("/account/security");
  // This browser's pending link request, as /login/google/start leaves it.
  const pending = () =>
    context.addCookies([
      {
        name: "og_google",
        value: Buffer.from(
          JSON.stringify({
            state: "state-of-this-browser-000000",
            nonce: "n".repeat(32),
            verifier: "v".repeat(64),
            continueTo: "/account/security",
            intent: "link",
          }),
        ).toString("base64url"),
        url: "http://localhost:3002",
      },
    ]);
  const pendingLeft = async () =>
    (await context.cookies()).some((cookie) => cookie.name === "og_google");

  // Someone else's code with their state: refused on the state, request dropped.
  await pending();
  await page.goto(
    "/login/google/callback?state=state-of-the-attacker-00000&code=their-google-code",
  );
  await expect(page).toHaveURL("/account");
  expect(await pendingLeft()).toBe(false);

  // Only the matching state goes on to Identity (which has no Google locally).
  await pending();
  await page.goto(
    "/login/google/callback?state=state-of-this-browser-000000&code=our-google-code",
  );
  await expect(page).toHaveURL("/account/security?error=google_unavailable");
  await expect(
    page.getByRole("status").filter({
      hasText:
        "Google sign-in is unavailable right now. Use the email code instead.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Not available right now")).toBeVisible();
  expect(await pendingLeft()).toBe(false);
});

test("the Telegram card never hides the notification settings", async ({
  page,
}) => {
  await page.goto("/login?continue=%2Faccount%2Fnotifications");
  await signIn(page);
  await expect(page).toHaveURL("/account/notifications");
  await expect(
    page.getByText("Telegram notifications are not available yet."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
});

test("all five account sections stay reachable on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login?continue=%2Faccount");
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Account sections" });
  for (const name of [
    "Profile",
    "Security",
    "Sessions",
    "Inbox",
    "Notifications",
  ]) {
    await expect(nav.getByRole("link", { name })).toBeInViewport();
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
