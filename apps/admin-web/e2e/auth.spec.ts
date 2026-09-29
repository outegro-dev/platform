import type { BrowserContext, Page } from "@playwright/test";
import { expect, settle, signIn, test } from "./fixtures";

test.describe("sign-in through id.outegro.dev", () => {
  test("goes through /authorize with PKCE and returns where it started", async ({
    page,
    context,
  }) => {
    await page.goto("/users?query=mira");
    await page.waitForURL(/localhost:4196\/authorize\?/);
    const authorize = new URL(page.url());
    expect(authorize.searchParams.get("client_id")).toBe("admin-web");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3196/auth/callback",
    );
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    await page.getByRole("link", { name: /Nick Lukashik/ }).click();
    await expect(page).toHaveURL("/users?query=mira");
    await settle(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Users" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Mira Levina" })).toBeVisible();

    // The browser never sees a token: session cookies are HttpOnly.
    const cookies = await context.cookies();
    for (const name of ["og_at", "og_rt", "og_admin_seen"]) {
      expect(cookies.find((cookie) => cookie.name === name)?.httpOnly).toBe(
        true,
      );
    }
    expect(cookies.some((cookie) => cookie.name === "og_sso")).toBe(false);
  });

  test("a signed-in user without an admin role sees no access", async ({
    page,
  }) => {
    await signIn(page, "nobody", "/");
    await expect(
      page.getByRole("heading", { level: 1, name: "No access to the console" }),
    ).toBeVisible();
    await expect(page.getByText("noah.fields@example.com")).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/sign-in?signedOut=1");
    await expect(page.getByText("You have signed out.")).toBeVisible();
  });

  test("signing out ends the session", async ({ page, context }) => {
    await signIn(page, "owner", "/");
    await page
      .getByRole("complementary", { name: "Console" })
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(page).toHaveURL("/sign-in?signedOut=1");
    const cookies = await context.cookies();
    expect(cookies.some((cookie) => cookie.name === "og_at")).toBe(false);
    await page.goto("/");
    await page.waitForURL(/localhost:4196\/authorize/);
  });

  test.describe("a session ended elsewhere while its access token is valid", () => {
    /** Ends the console's session in Identity (another tab, an operator, a suspension). */
    async function endSessionElsewhere(page: Page, context: BrowserContext) {
      const refresh = (await context.cookies()).find(
        (cookie) => cookie.name === "og_rt",
      )?.value;
      const ended = await page.request.post(
        "http://localhost:4196/auth/v1/sessions/logout",
        { data: { refreshToken: refresh } },
      );
      expect(ended.status()).toBe(204);
    }

    /** Every document the tab loads on this origin, in order. */
    function consoleHops(page: Page) {
      const hops: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          url.origin === "http://localhost:3196"
        )
          hops.push(url.pathname);
      });
      return hops;
    }

    async function expectSignedOut(context: BrowserContext) {
      const names = (await context.cookies()).map((cookie) => cookie.name);
      for (const name of ["og_at", "og_rt", "og_admin_seen"])
        expect(names, name).not.toContain(name);
    }

    test("opening a page goes to sign-in once and drops the cookies", async ({
      page,
      context,
    }) => {
      await signIn(page, "owner", "/");
      await endSessionElsewhere(page, context);
      const hops = consoleHops(page);

      await page.goto("/users?query=mira");
      await page.waitForURL(/localhost:4196\/authorize\?/);
      expect(hops).toEqual(["/users", "/auth/sign-in"]);
      await expectSignedOut(context);

      // Signing in again returns to the page that was asked for.
      await page.getByRole("link", { name: /Nick Lukashik/ }).click();
      await expect(page).toHaveURL("/users?query=mira");
      await settle(page);
      await expect(
        page.getByRole("heading", { level: 1, name: "Users" }),
      ).toBeVisible();
    });

    test("following a link inside the console does the same", async ({
      page,
      context,
    }) => {
      await signIn(page, "owner", "/");
      await endSessionElsewhere(page, context);
      const hops = consoleHops(page);

      await page
        .getByRole("navigation", { name: "Console sections" })
        .getByRole("link", { name: "Users" })
        .click();
      await page.waitForURL(/localhost:4196\/authorize\?/);
      // The router fetches /users and then sign-in; the browser loads sign-in once.
      expect(hops).toEqual(["/auth/sign-in"]);
      await expectSignedOut(context);

      await page.getByRole("link", { name: /Nick Lukashik/ }).click();
      await expect(page).toHaveURL("/users");
    });
  });

  test("a failed round trip lands on the sign-in page with a reason", async ({
    page,
  }) => {
    await page.goto("/auth/callback?code=forged&state=forged");
    await expect(page).toHaveURL("/sign-in?error=state_mismatch");
    await expect(
      page.getByText("The sign-in link expired or was opened in another tab."),
    ).toBeVisible();
  });

  test("every page is noindex and carries a nonce CSP", async ({ page }) => {
    const response = await page.goto("/sign-in");
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["content-security-policy"]).toMatch(
      /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
    );
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });
});

test.describe("idle sign-out", () => {
  test("warns with a countdown, can be extended, then signs out", async ({
    page,
  }) => {
    await page.clock.install();
    await signIn(page, "owner", "/");
    await page.clock.fastForward("28:05");
    const warning = page.getByRole("alertdialog", { name: "Still there?" });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/signed out in 1:5\d/);
    await warning.getByRole("button", { name: "Stay signed in" }).click();
    await expect(warning).toBeHidden();

    await page.clock.fastForward("30:30");
    await expect(page).toHaveURL("/sign-in?reason=idle");
    await expect(
      page.getByText("You were signed out after 30 minutes without activity."),
    ).toBeVisible();
  });
});
