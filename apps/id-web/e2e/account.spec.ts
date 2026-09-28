import { randomBytes, randomInt } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const PAY_CALLBACK = "http://localhost:3003/auth/callback";

const uniqueEmail = () => `e2e-${randomBytes(6).toString("hex")}@outegro.test`;

/** Waits for the newest sign-in email to this address and returns its code. */
async function codeFor(email: string, since: number) {
  const query = encodeURIComponent(`to:${email}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${query}&limit=1`,
    );
    const { messages } = (await response.json()) as {
      messages: { Subject: string; Created: string }[];
    };
    const latest = messages[0];
    const code = latest?.Subject.match(/\d{6}/)?.[0];
    if (code && Date.parse(latest.Created) >= since) return code;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in email for ${email}`);
}

/** Signs in on the current /login page. */
async function signIn(page: Page, email = uniqueEmail()) {
  const since = Date.now() - 1000;
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Six-digit code").fill(await codeFor(email, since));
  await page.getByRole("button", { name: "Sign in" }).click();
  return email;
}

// Each test looks like a different client address to Identity, the way
// Traefik would report it; this also keeps the per-IP sign-in limit apart.
let clientIp: string;
test.beforeEach(async ({ page }) => {
  clientIp = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.9, ${clientIp}`,
  });
});

test("TC-ID-09-01: sign in with an email code and see this device", async ({
  page,
}) => {
  await page.goto("/account/sessions");
  await expect(page).toHaveURL(/\/login\?continue=%2Faccount%2Fsessions$/);
  await signIn(page);
  await expect(page).toHaveURL("/account/sessions");
  const current = page.getByRole("listitem").filter({ hasText: "This device" });
  await expect(current).toContainText("Chrome");
  // Only the proxy-appended address is trusted, not what the client sent first.
  await expect(current).toContainText(clientIp);
  await expect(current).not.toContainText("198.51.100.9");
});

test("TC-ID-09-02: the profile language becomes the account language", async ({
  page,
}) => {
  await page.goto("/login");
  const email = await signIn(page);
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel("Display name").fill("E2E Person");
  await page.getByRole("radio", { name: "Русский" }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Сохранено.");
  await page.reload();
  await expect(page.getByLabel("Отображаемое имя")).toHaveValue("E2E Person");
});

test("TC-ID-09-03: required notification channels cannot be switched off", async ({
  page,
}) => {
  await page.goto("/account/notifications");
  await signIn(page);
  await expect(page.getByLabel("Security: Email")).toBeDisabled();
  await expect(page.getByLabel("Security: Email")).toBeChecked();
  const serviceEmail = page.getByLabel("Service news: Email");
  await serviceEmail.uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Service news: Email")).not.toBeChecked();
});

test.describe("SSO entry (ID-04)", () => {
  const authorizeUrl = (redirectUri: string) =>
    `/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "pay-web",
      redirect_uri: redirectUri,
      state: "e2e-state-0123456789",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    })}`;

  test("TC-ID-04-01: a signed-out user signs in and returns to the app with a code", async ({
    page,
  }) => {
    await page.route(`${PAY_CALLBACK}**`, (route) =>
      route.fulfill({ status: 200, body: "pay-web callback" }),
    );
    await page.goto(authorizeUrl(PAY_CALLBACK));
    await expect(page.getByText("You will continue to Payments")).toBeVisible();
    await signIn(page);
    await page.waitForURL(`${PAY_CALLBACK}**`);
    const url = new URL(page.url());
    expect(url.searchParams.get("state")).toBe("e2e-state-0123456789");
    expect(url.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("TC-ID-04-04: an unregistered redirect never leaves id-web", async ({
    page,
  }) => {
    await page.goto(
      authorizeUrl("https://pay.outegro.dev.evil.test/auth/callback"),
    );
    await expect(page).toHaveURL(/\/authorize\?/);
    await expect(
      page.getByRole("heading", { name: "This link is not valid" }),
    ).toBeVisible();
  });
});

test("TC-ID-10-02: server actions refuse cross-site posts", async ({
  page,
}) => {
  await page.goto("/login");
  await signIn(page);
  await expect(page).toHaveURL("/account");
  // The sign-out form works without JavaScript, so a server-rendered page carries
  // its action id in the markup (the only plain action form on the profile page).
  await page.reload();
  const field = await page.evaluate(
    () =>
      document.querySelector<HTMLInputElement>('input[name^="$ACTION_ID_"]')
        ?.name,
  );
  expect(field).toBeTruthy();
  const post = (origin: string) =>
    page.request.post("/account", {
      headers: { origin },
      multipart: { [field as string]: "" },
      maxRedirects: 0,
    });

  const forged = await post("https://evil.test");
  expect(forged.status()).toBeGreaterThanOrEqual(400);
  await page.goto("/account/sessions");
  await expect(page).toHaveURL("/account/sessions");

  // The same request from our own origin does sign out: the check is the only difference.
  const genuine = await post("http://localhost:3002");
  expect(genuine.status()).toBeLessThan(400);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
});
