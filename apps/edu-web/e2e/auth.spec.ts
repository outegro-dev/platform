import { APP, expect, PLATFORM, test } from "./support/fixtures.ts";

test.describe("sign-in through id.outegro.dev", () => {
  test("authorization code with PKCE, a session in httpOnly cookies, sign-out", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "e2e_persona", value: "reader", domain: "localhost", path: "/" },
    ]);
    await page.goto("/books/nodejs-internals");
    const authorize = page.waitForRequest((request) =>
      request.url().startsWith(`${PLATFORM}/authorize`),
    );
    await page
      .getByRole("banner")
      .getByRole("link", { name: "Sign in", exact: true })
      .click();
    const url = new URL((await authorize).url());
    expect(url.searchParams.get("client_id")).toBe("edu-web");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/auth/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    // Back where sign-in started, signed in.
    await page.waitForURL(`${APP}/books/nodejs-internals`);
    const menu = page.getByRole("button", { name: /account and apps$/ });
    await expect(menu).toHaveAccessibleName("Anna Reader, account and apps");
    const cookies = Object.fromEntries(
      (await context.cookies(APP)).map((cookie) => [cookie.name, cookie]),
    );
    expect(cookies.og_at?.httpOnly).toBe(true);
    expect(cookies.og_rt?.httpOnly).toBe(true);
    expect(cookies.og_sso).toBeUndefined();

    // The menu knows this app as Education.
    await menu.click();
    await expect(
      page.getByRole("menuitem", { name: /^Education, .*, you are here$/ }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    const after = (await context.cookies(APP)).map((cookie) => cookie.name);
    expect(after).not.toContain("og_at");
    expect(after).not.toContain("og_rt");
  });

  test("a closed chapter signs the reader in and comes back to it", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "e2e_persona", value: "reader", domain: "localhost", path: "/" },
    ]);
    await page.goto("/books/nodejs-internals/1");
    const gate = page.getByTestId("chapter-gate");
    await expect(gate.getByRole("heading", { level: 2 })).toHaveText(
      "Sign in to read this chapter",
    );
    await expect(gate.getByRole("heading", { level: 1 })).toHaveText(
      "Что такое Node.js и из чего он состоит",
    );
    await gate.getByTestId("access-sign-in").click();
    await page.waitForURL(`${APP}/books/nodejs-internals/1`);
    await expect(page.getByTestId("chapter-gate")).toHaveCount(0);
    await expect(
      page.locator("article.book-article .figure").first(),
    ).toBeVisible();
  });

  test("a failed callback explains itself", async ({ page }) => {
    await page.goto("/auth/callback?code=x&state=forged");
    await expect(page.getByTestId("auth-error")).toContainText(
      "The sign-in link expired or was opened in another browser.",
    );
  });
});
