import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./support";

/*
 * Passkeys (ID-05) in a real Chromium against the local stack. The
 * authenticator is Chromium's virtual one (CDP WebAuthn domain): a platform
 * passkey with user verification that answers without a person. It also
 * answers a pending autofill request at once, as if the user picked the
 * passkey from the email field's suggestions.
 */

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`,
  });
});

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return {
    credentials: async () =>
      (await cdp.send("WebAuthn.getCredentials", { authenticatorId }))
        .credentials,
    /** The fingerprint or PIN check fails from now on. */
    failVerification: () =>
      cdp.send("WebAuthn.setUserVerified", {
        authenticatorId,
        isUserVerified: false,
      }),
  };
}

/**
 * A browser without passkey autofill (conditional mediation): only the
 * button signs in, so the virtual authenticator cannot answer before it.
 */
const withoutAutofill = (page: Page) =>
  page.addInitScript(() => {
    Object.defineProperty(
      PublicKeyCredential,
      "isConditionalMediationAvailable",
      { value: async () => false },
    );
  });

const menuButton = (page: Page) =>
  page.getByRole("button", { name: /(and apps|и приложения)$/i });

async function signOut(page: Page, label = "Sign out") {
  await menuButton(page).click();
  await page.getByRole("menu").getByRole("menuitem", { name: label }).click();
}

/** Signs in with an email code and adds one passkey on the Security page. */
async function withPasskey(page: Page, name: string) {
  await page.goto("/login?continue=%2Faccount%2Fsecurity");
  const email = await signIn(page);
  await expect(page).toHaveURL("/account/security");
  const panel = page.getByTestId("passkeys");
  await expect(panel.getByText("No passkeys yet.")).toBeVisible();
  // The name starts from this browser and system; the user may change it.
  await expect(panel.getByLabel("Passkey name")).not.toHaveValue("");
  await panel.getByLabel("Passkey name").fill(name);
  await panel.getByRole("button", { name: "Add passkey" }).click();
  await expect(panel.getByRole("status")).toHaveText(
    "Passkey added. You can sign in with it now.",
  );
  return { email, panel };
}

test("TC-ID-05-01: add a passkey, sign out, sign in with it, rename it and remove it", async ({
  page,
}) => {
  await withoutAutofill(page);
  const key = await virtualAuthenticator(page);
  const { panel } = await withPasskey(page, "E2E laptop");
  const row = panel.getByRole("listitem").filter({ hasText: "E2E laptop" });
  await expect(row).toContainText("not used yet");
  const [credential] = await key.credentials();
  expect(credential).toMatchObject({
    isResidentCredential: true,
    rpId: "localhost",
  });
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map((v) => `${v.id} × ${v.nodes.length}`)).toEqual([]);

  // Signed out, the passkey alone signs in again: no email, no code.
  await signOut(page);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL("/account");
  await page.goto("/account/sessions");
  await expect(
    page.getByRole("listitem").filter({ hasText: "This device" }),
  ).toContainText("Passkey");

  await page.goto("/account/security");
  await expect(row).toContainText("last used");
  await row.getByRole("button", { name: /^Rename/ }).click();
  const rename = page.getByRole("dialog");
  await expect(rename.getByLabel("Passkey name")).toHaveValue("E2E laptop");
  await rename.getByLabel("Passkey name").fill("Work laptop");
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(rename).toBeHidden();
  await expect(page.getByText("Passkey renamed.")).toBeVisible();
  const renamed = panel
    .getByRole("listitem")
    .filter({ hasText: "Work laptop" });
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: /^Remove/ }).click();
  const remove = page.getByRole("dialog");
  await expect(remove).toContainText("“Work laptop”");
  // Keeping it changes nothing.
  await remove.getByRole("button", { name: "Keep it" }).click();
  await expect(remove).toBeHidden();
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: /^Remove/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove passkey" })
    .click();
  await expect(page.getByText("Passkey removed.")).toBeVisible();
  await expect(panel.getByText("No passkeys yet.")).toBeVisible();

  // The device may still hold it; the account no longer takes it.
  await signOut(page);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(
    page.getByText(
      "This passkey is not linked to any account. It may have been removed: sign in with an email code.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("the email field's autofill signs in with a passkey (conditional mediation)", async ({
  page,
}) => {
  await virtualAuthenticator(page);
  await withPasskey(page, "Autofill laptop");
  // On the sign-in page the pending autofill request is answered by the
  // passkey, as when the user picks it under the email field.
  await signOut(page);
  await expect(page).toHaveURL("/account");
  await page.goto("/account/sessions");
  await expect(
    page.getByRole("listitem").filter({ hasText: "This device" }),
  ).toContainText("Passkey");
});

test("a passkey without its fingerprint or PIN check signs nobody in", async ({
  page,
}) => {
  await withoutAutofill(page);
  const key = await virtualAuthenticator(page);
  await withPasskey(page, "Shared tablet");
  await key.failVerification();
  await signOut(page);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(
    page.getByText(
      "The passkey request was cancelled or timed out. Try again.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?continue=%2Faccount$/);
});

test("signing in again to confirm it is you replaces the session", async ({
  page,
}) => {
  await withoutAutofill(page);
  await virtualAuthenticator(page);
  const { email } = await withPasskey(page, "Laptop");
  await page.goto("/account/sessions");
  const sessions = page.getByRole("main").getByRole("listitem");
  await expect(sessions).toHaveCount(1);

  // A signed-in user is let back to the sign-in page when asked to confirm.
  await page.goto("/login?reauth=1&continue=%2Faccount%2Fsessions");
  await expect(page).toHaveURL(/reauth=1/);
  await expect(page.getByText("Confirm it's you to continue")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL("/account/sessions");
  // Still one session: the new one replaced the old instead of joining it.
  await expect(sessions).toHaveCount(1);
  await expect(sessions.first()).toContainText("This device");
  await expect(sessions.first()).toContainText("Passkey");

  // Without reauth=1 the sign-in page still sends a signed-in user on.
  await page.goto("/login?continue=%2Faccount%2Fsecurity");
  await expect(page).toHaveURL("/account/security");
});

test("the pages allow WebAuthn for this origin only and keep a strict CSP", async ({
  page,
}) => {
  const response = await page.goto("/login");
  const headers = response?.headers() ?? {};
  const policy = headers["permissions-policy"] ?? "";
  expect(policy).toContain("publickey-credentials-get=(self)");
  expect(policy).toContain("publickey-credentials-create=(self)");
  expect(policy).toContain("camera=()");
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-eval");
  // The email field offers passkeys in its autofill.
  await expect(page.getByLabel("Email")).toHaveAttribute(
    "autocomplete",
    "email webauthn",
  );
});

test.describe("on a phone, in Russian", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the passkeys section fits and speaks Russian", async ({
    page,
    context,
  }) => {
    await withoutAutofill(page);
    await virtualAuthenticator(page);
    await withPasskey(page, "Телефон");
    await context.addCookies([
      { name: "og_locale", value: "ru", url: "http://localhost:3002" },
    ]);
    await page.reload();
    const panel = page.getByTestId("passkeys");
    await expect(
      panel.getByRole("heading", { name: "Ключи доступа" }),
    ).toBeVisible();
    const row = panel.getByRole("listitem").filter({ hasText: "Телефон" });
    await expect(row).toContainText("ещё не использовался");
    await expect(
      row.getByRole("button", { name: /^Удалить/ }),
    ).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await signOut(page, "Выйти");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("button", { name: "Войти с ключом доступа" }),
    ).toBeVisible();
  });
});
