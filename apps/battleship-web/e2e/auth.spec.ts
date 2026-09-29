import { APP, expect, PLATFORM, signIn, test } from "./support/fixtures.ts";

test.describe("sign-in through id.outegro.dev", () => {
  test("signed-out visitors see the game, the leaderboard and a clear way in", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Sink the fleet.",
    );
    await expect(page.getByTestId("sign-in-cta")).toHaveAttribute(
      "href",
      "/auth/sign-in?returnTo=%2F",
    );
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await page.goto("/leaderboard");
    await expect(page.getByTestId("leaderboard-table")).toContainText("Nemo");
    await expect(page.getByTestId("your-place")).toContainText(
      "Sign in to see your place",
    );
  });

  test("sign-in uses the authorization code with PKCE and lands signed in; sign-out ends it", async ({
    page,
    context,
    game,
  }) => {
    await context.addCookies([
      { name: "e2e_persona", value: "free", domain: "localhost", path: "/" },
    ]);
    await page.goto("/");
    const authorize = page.waitForRequest((request) =>
      request.url().startsWith(`${PLATFORM}/authorize`),
    );
    await page.getByTestId("sign-in-cta").click();
    const url = new URL((await authorize).url());
    expect(url.searchParams.get("client_id")).toBe("battleship-web");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/auth/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    await page.waitForURL(`${APP}/`);
    await expect(page.getByTestId("player-chip")).toContainText("Sailor 4821");
    await game.current();
    const cookies = await context.cookies(APP);
    const byName = Object.fromEntries(
      cookies.map((cookie) => [cookie.name, cookie]),
    );
    expect(byName.og_at?.httpOnly).toBe(true);
    expect(byName.og_rt?.httpOnly).toBe(true);
    expect(byName.og_sso).toBeUndefined();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("sign-in-cta")).toBeVisible();
    const after = (await context.cookies(APP)).map((cookie) => cookie.name);
    expect(after).not.toContain("og_at");
    expect(after).not.toContain("og_rt");
  });

  test("every game page asks for sign-in and returns there afterwards", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "e2e_persona", value: "premium", domain: "localhost", path: "/" },
    ]);
    for (const path of ["/profile", "/play", "/room/K7M2QX"]) {
      await context.clearCookies({ name: "og_at" });
      await context.clearCookies({ name: "og_rt" });
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain(
        `/auth/sign-in?returnTo=${encodeURIComponent(path)}`,
      );
    }
    await page.goto("/profile");
    await page.waitForURL(`${APP}/profile`);
    await expect(page.getByTestId("profile-nickname")).toHaveText(
      "Admiral Nelson",
    );
  });

  test("a callback that does not match the pending sign-in shows why and clears it", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "og_sso", value: "tampered", domain: "localhost", path: "/" },
    ]);
    await page.goto("/auth/callback?code=forged&state=forged-state-000000");
    await expect(page).toHaveURL(/\/auth\/error\?reason=state_mismatch$/);
    await expect(page.getByTestId("auth-error")).toContainText(
      "The sign-in link expired or was opened in another browser.",
    );
    expect(
      (await context.cookies(APP)).map((cookie) => cookie.name),
    ).not.toContain("og_sso");
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/auth/sign-in?returnTo=%2F",
    );
  });

  test("a signed-in visitor going to sign-in is sent straight back", async ({
    page,
  }) => {
    await signIn(page, "free", "/leaderboard");
    await page.goto("/auth/sign-in?returnTo=%2Fshop");
    await expect(page).toHaveURL(`${APP}/shop`);
  });

  test("sign-out refuses cross-site posts", async ({ page }) => {
    await signIn(page, "free");
    const forged = await page.request.post("/auth/sign-out", {
      headers: { origin: "https://evil.test" },
      maxRedirects: 0,
    });
    expect(forged.status()).toBe(403);
    await page.goto("/profile");
    await expect(page).toHaveURL(`${APP}/profile`);
  });
});
