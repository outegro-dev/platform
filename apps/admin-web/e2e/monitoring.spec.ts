import type { APIResponse, Page } from "@playwright/test";
import { expect, phone, signIn, test, useRussian } from "./fixtures";

/**
 * Monitoring is Grafana under /grafana/ on the console's host (not part of
 * this hermetic setup): the sidebar links there, and Traefik's ForwardAuth
 * asks /api/grafana/auth before every Grafana request. These tests play
 * Traefik: the browser's cookies plus X-Forwarded-Uri and -Method.
 */
const APP = "http://localhost:3196";
const FAKE = "http://localhost:4196";
const GRAFANA = "/grafana/d/abc?orgId=1";

const monitoring = (page: Page) =>
  page
    .getByRole("navigation", { name: "Console sections" })
    .getByRole("link", { name: "Monitoring" });

function forwardAuth(
  page: Page,
  {
    uri = GRAFANA,
    method = "GET",
    headers = {} as Record<string, string>,
  } = {},
) {
  return page.request.get("/api/grafana/auth", {
    headers: {
      "x-forwarded-uri": uri,
      "x-forwarded-method": method,
      "x-forwarded-proto": "http",
      "x-forwarded-host": "localhost:3196",
      ...headers,
    },
    maxRedirects: 0,
  });
}

const setCookies = (response: APIResponse) =>
  response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);

/** A JWT-shaped access token that expired a minute ago. */
const expiredToken = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}.y`;

test.describe("the Monitoring item", () => {
  test("opens Grafana on this host in the same tab for an owner", async ({
    page,
  }) => {
    await signIn(page, "owner", "/");
    const link = monitoring(page);
    await expect(link).toHaveAttribute("href", "/grafana/");
    expect(await link.getAttribute("target")).toBeNull();
    await expect(
      page.getByRole("list", { name: "Infrastructure" }).getByRole("link"),
    ).toHaveText(["Monitoring"]);
  });

  test("shows for an auditor, who views Grafana", async ({ page }) => {
    await signIn(page, "auditor", "/");
    await expect(monitoring(page)).toBeVisible();
  });

  for (const persona of ["support", "billing"] as const) {
    test(`stays hidden from ${persona}, without monitoring.read`, async ({
      page,
    }) => {
      await signIn(page, persona, "/");
      await expect(
        page
          .getByRole("navigation", { name: "Console sections" })
          .getByRole("link", { name: "Dashboard" }),
      ).toBeVisible();
      await expect(monitoring(page)).toHaveCount(0);
    });
  }

  test("speaks Russian", async ({ page, context }) => {
    await useRussian(context);
    await signIn(page, "owner", "/");
    await expect(
      page
        .getByRole("navigation", { name: "Разделы консоли" })
        .getByRole("link", { name: "Мониторинг" }),
    ).toHaveAttribute("href", "/grafana/");
  });

  test.describe("on a phone", () => {
    test.use(phone);
    test("is in the navigation sheet", async ({ page }) => {
      await signIn(page, "owner", "/");
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("dialog").getByRole("link", { name: "Monitoring" }),
      ).toHaveAttribute("href", "/grafana/");
    });
  });
});

test.describe("ForwardAuth for Grafana", () => {
  test("lets an owner in as Admin, whatever headers the request brings", async ({
    page,
  }) => {
    await signIn(page, "owner", "/");
    const response = await forwardAuth(page, {
      headers: {
        "x-webauth-user": "attacker@evil.test",
        "x-webauth-role": "Viewer",
      },
    });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("");
    const headers = response.headers();
    expect(headers["x-webauth-user"]).toBe("nick@outegro.dev");
    expect(headers["x-webauth-email"]).toBe("nick@outegro.dev");
    expect(headers["x-webauth-name"]).toBe("Nick Lukashik");
    expect(headers["x-webauth-role"]).toBe("Admin");
    expect(headers["cache-control"]).toContain("no-store");
    // Nothing is refreshed or stamped here: cookies of a 2xx would be lost.
    expect(setCookies(response)).toEqual([]);
  });

  test("lets an auditor in as Viewer", async ({ page }) => {
    await signIn(page, "auditor", "/");
    const response = await forwardAuth(page);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-webauth-user"]).toBe("ada.rossi@outegro.dev");
    expect(response.headers()["x-webauth-role"]).toBe("Viewer");
  });

  test("shows support a page without access, in their language", async ({
    page,
    context,
  }) => {
    await signIn(page, "support", "/");
    const english = await forwardAuth(page);
    expect(english.status()).toBe(403);
    expect(english.headers()["x-webauth-user"]).toBeUndefined();
    expect(await english.text()).toContain("No access to monitoring");
    await useRussian(context);
    const russian = await forwardAuth(page);
    expect(russian.status()).toBe(403);
    expect(await russian.text()).toContain("Нет доступа к мониторингу");
  });

  test("sends a visitor without a session to sign-in, returning to Grafana only", async ({
    request,
  }) => {
    for (const [uri, back] of [
      [GRAFANA, GRAFANA],
      ["//evil.test/grafana/", "/grafana/"],
      ["/grafana/../auth/sign-out", "/grafana/"],
    ]) {
      const response = await request.get("/api/grafana/auth", {
        headers: { "x-forwarded-uri": uri, "x-forwarded-method": "GET" },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe(
        `${APP}/auth/sign-in?returnTo=${encodeURIComponent(back)}`,
      );
    }
  });

  test("refreshes an expired session through /monitoring and returns", async ({
    page,
    context,
  }) => {
    await signIn(page, "owner", "/");
    await context.addCookies([
      { name: "og_at", value: expiredToken, url: APP },
    ]);

    const detour = await forwardAuth(page);
    expect(detour.status()).toBe(302);
    expect(detour.headers().location).toBe(
      `${APP}/monitoring?to=${encodeURIComponent(GRAFANA)}`,
    );
    expect(setCookies(detour)).toEqual([]);

    const back = await page.request.get(detour.headers().location, {
      maxRedirects: 0,
    });
    expect(back.status()).toBe(303);
    expect(back.headers().location).toBe(`${APP}${GRAFANA}`);
    expect(setCookies(back).some((cookie) => cookie.startsWith("og_at="))).toBe(
      true,
    );
    // The browser now holds the rotated session: Grafana lets it in.
    expect((await forwardAuth(page)).status()).toBe(200);
  });

  test("keeps the method of a Grafana API call through the refresh", async ({
    page,
    context,
  }) => {
    await signIn(page, "auditor", "/");
    await context.addCookies([
      { name: "og_at", value: expiredToken, url: APP },
    ]);
    const uri = "/grafana/api/ds/query?ds_type=prometheus";
    const detour = await forwardAuth(page, { uri, method: "POST" });
    expect(detour.status()).toBe(307);
    const back = await page.request.post(detour.headers().location, {
      data: { queries: [] },
      maxRedirects: 0,
    });
    expect(back.status()).toBe(307);
    expect(back.headers().location).toBe(`${APP}${uri}`);
  });

  test("drops a revoked session and signs in again", async ({
    page,
    context,
  }) => {
    await signIn(page, "owner", "/");
    const refresh = (await context.cookies()).find(
      (cookie) => cookie.name === "og_rt",
    )?.value;
    // Ended elsewhere (another tab, an operator): the access token has not expired.
    await page.request.post(`${FAKE}/auth/v1/sessions/logout`, {
      data: { refreshToken: refresh },
    });

    const detour = await forwardAuth(page);
    expect(detour.status()).toBe(302);
    const back = await page.request.get(detour.headers().location, {
      maxRedirects: 0,
    });
    expect(back.status()).toBe(303);
    expect(back.headers().location).toBe(
      `${APP}/auth/sign-in?returnTo=${encodeURIComponent(GRAFANA)}`,
    );
    const names = (await context.cookies()).map((cookie) => cookie.name);
    expect(names).not.toContain("og_at");
    expect(names).not.toContain("og_rt");
    const again = await forwardAuth(page);
    expect(again.status()).toBe(302);
    expect(again.headers().location).toBe(
      `${APP}/auth/sign-in?returnTo=${encodeURIComponent(GRAFANA)}`,
    );
  });

  test("lets the console end a session idle for too long", async ({
    page,
    context,
  }) => {
    await signIn(page, "owner", "/");
    const longAgo = String(Math.floor(Date.now() / 1000) - 3 * 60 * 60);
    await context.addCookies([
      { name: "og_admin_seen", value: longAgo, url: APP },
    ]);
    const detour = await forwardAuth(page);
    expect(detour.status()).toBe(302);
    const back = await page.request.get(detour.headers().location, {
      maxRedirects: 0,
    });
    // The proxy's own answer to the browser (not through ForwardAuth).
    expect(new URL(back.headers().location, APP).toString()).toBe(
      `${APP}/sign-in?reason=idle`,
    );
    expect((await forwardAuth(page)).status()).toBe(302);
  });
});
