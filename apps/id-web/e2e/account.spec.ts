import { randomBytes, randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

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

  // A foreign site, a sandboxed frame (opaque origin) and a sibling app on the
  // same site, whose requests do carry the SameSite=Lax session cookies.
  for (const origin of ["https://evil.test", "null", "http://localhost:3003"]) {
    const forged = await post(origin);
    expect(forged.status(), origin).toBeGreaterThanOrEqual(400);
  }
  await page.goto("/account/sessions");
  await expect(page).toHaveURL("/account/sessions");

  // The same request from our own origin does sign out: the check is the only difference.
  const genuine = await post("http://localhost:3002");
  expect(genuine.status()).toBeLessThan(400);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);
});

test("the resend timer counts down from the server's cooldown", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByRole("button", { name: "Send code" }).click();
  const timer = page.getByRole("button", { name: /New code available in/ });
  await expect(timer).toBeVisible();
  const seconds = Number((await timer.textContent())?.match(/\d+/)?.[0]);
  expect(seconds).toBeGreaterThan(50);
  expect(seconds).toBeLessThanOrEqual(60);
});

test("unknown pages get the branded 404", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    /\/privacy$/,
  );
});

test("account pages pass an accessibility scan", async ({ page }) => {
  const scan = async (where: string) => {
    // Scan the page itself, not its loading skeleton.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      violations.map((v) => `${where}: ${v.id} × ${v.nodes.length}`),
    ).toEqual([]);
  };
  await page.goto("/login");
  await scan("login");
  await signIn(page);
  await expect(page).toHaveURL("/account");
  for (const path of [
    "/account",
    "/account/sessions",
    "/account/inbox",
    "/account/notifications",
  ]) {
    await page.goto(path);
    await scan(path);
  }
  await page.goto("/no-such-page");
  await scan("404");
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("every section and every channel fits on screen", async ({ page }) => {
    await page.goto("/account/notifications");
    await signIn(page);
    await expect(page).toHaveURL("/account/notifications");
    const width = page.viewportSize()?.width ?? 0;
    for (const name of ["Profile", "Sessions", "Inbox", "Notifications"]) {
      const box = await page
        .getByRole("navigation")
        .getByRole("link", { name })
        .boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    }
    for (const label of ["Security: Telegram", "Service news: Telegram"]) {
      const box = await page.getByLabel(label).boundingBox();
      expect(box && box.x + box.width <= width).toBe(true);
    }
  });
});

test("pages are never stored, build assets stay cached", async ({
  page,
  request,
}) => {
  const response = await page.goto("/login");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  const css = await page
    .locator('link[rel="stylesheet"]')
    .first()
    .getAttribute("href");
  expect(css).toMatch(/^\/_next\/static\//);
  // Refetching CSS and fonts on every reload was the cause of layout jumps.
  const asset = await request.get(css as string);
  expect(asset.headers()["cache-control"]).toContain("immutable");
});

// ─── Layout stability and visible states ────────────────────────────────

const ACCOUNT_PAGES = [
  "/account",
  "/account/sessions",
  "/account/inbox",
  "/account/notifications",
];

type Box = { x: number; y: number; width: number; height: number } | null;

/** Rounded boxes of named elements, to compare before and after an interaction. */
async function layoutOf(elements: Record<string, Locator>) {
  const result: Record<string, Box> = {};
  for (const [name, element] of Object.entries(elements)) {
    const box = await element.boundingBox();
    result[name] = box && {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  }
  return result;
}

/** Every layout shift of each new document is summed into `window.__cls`. */
async function recordLayoutShifts(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __cls: number };
    state.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) state.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** A cold first visit: no HTTP cache, and a phone-grade network if asked. */
async function network(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  return (slow: boolean) =>
    cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      // Chrome's "Slow 4G": fonts arrive after the first paint.
      latency: slow ? 150 : 0,
      downloadThroughput: slow ? (1.6 * 1024 * 1024) / 8 : -1,
      uploadThroughput: slow ? (750 * 1024) / 8 : -1,
    });
}

/** CLS of one first load, once the content and the fonts are in. */
async function firstLoadShift(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

/** Holds this page's server-action responses until released. */
async function holdServerActions(page: Page, path: string) {
  const url = new URL(path, page.url()).href;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue().catch(() => {});
  });
  return async () => {
    release();
    await page.unroute(url);
  };
}

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 720 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`${device}: first load does not shift the layout (CLS < 0.02, cache disabled)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const throttle = await network(page);
    await recordLayoutShifts(page);
    const shifts: Record<string, number> = {};
    await throttle(true);
    shifts["/login"] = await firstLoadShift(page, "/login");
    await throttle(false);
    await signIn(page);
    await expect(page).toHaveURL("/account");
    await throttle(true);
    for (const path of ACCOUNT_PAGES)
      shifts[path] = await firstLoadShift(page, path);
    for (const [path, cls] of Object.entries(shifts))
      expect.soft(cls, `CLS of ${path}`).toBeLessThan(0.02);
  });
}

test("brand fonts: Latin is preloaded, Cyrillic is fetched only for Russian text", async ({
  page,
  context,
}) => {
  const response = await page.goto("/login");
  const preloads = (response?.headers().link ?? "")
    .split(/,\s*(?=<)/)
    .filter((link) => /rel=preload/.test(link) && /as="font"/.test(link));
  expect(preloads.length).toBeGreaterThan(0);
  expect(preloads.every((link) => /latin/.test(link))).toBe(true);
  const fonts = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.endsWith(".woff2")),
    );
  await page.evaluate(() => document.fonts.ready);
  expect((await fonts()).some((name) => /cyrillic/.test(name))).toBe(false);

  await context.addCookies([
    { name: "og_locale", value: "ru", url: "http://localhost:3002" },
  ]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Вход");
  await page.evaluate(() => document.fonts.ready);
  expect((await fonts()).some((name) => /cyrillic/.test(name))).toBe(true);
});

test("the sign-in form keeps its layout while focusing, typing and failing", async ({
  page,
}) => {
  // Hover lifts and press scales are transforms, not layout: leave them out.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const email = page.getByLabel("Email");
  const around = () =>
    layoutOf({
      heading: page.getByRole("heading", { level: 1 }),
      label: page.locator('label[for="email"]'),
      input: email,
      message: page.locator("#email-message"),
      button: page.locator('form button[type="submit"]'),
      footer: page.getByRole("contentinfo"),
    });
  const initial = await around();

  await email.focus();
  expect(await around(), "focus").toEqual(initial);
  await email.pressSequentially("someone@", { delay: 20 });
  expect(await around(), "typing").toEqual(initial);

  // Refused in the browser, then by the server: the message fills the slot.
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("#email-message")).toHaveText(
    "Enter a valid email address.",
  );
  await expect(email).toHaveAttribute("aria-invalid", "true");
  expect(await around(), "browser error").toEqual(initial);
  await email.fill("someone@localhost");
  const refused = page.waitForResponse(
    (response) => response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send code" }).click();
  await refused;
  await expect(page.locator("#email-message")).toHaveText(
    "Enter a valid email address.",
  );
  expect(await around(), "server error").toEqual(initial);
  await expect(email).toHaveValue("someone@localhost");

  // The code step.
  await email.fill(uniqueEmail());
  await page.getByRole("button", { name: "Send code" }).click();
  const code = page.getByLabel("Six-digit code");
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("inputmode", "numeric");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  const codeAround = () =>
    layoutOf({
      card: page.locator(".login-card"),
      input: code,
      message: page.locator("#code-message"),
      verify: page.locator('form button[type="submit"]').first(),
      another: page.getByRole("button", { name: "Use another email" }),
    });
  const step = await codeAround();
  await code.pressSequentially("123", { delay: 20 });
  expect(await codeAround(), "typing").toEqual(step);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#code-message")).toHaveText(
    "Enter all six digits of the code.",
  );
  expect(await codeAround(), "incomplete code").toEqual(step);
  // A pasted code keeps only its digits.
  await code.fill("000 000");
  await expect(code).toHaveValue("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#code-message")).toHaveText(
    "That code is not right. Check it and try again.",
  );
  await expect(code).toHaveValue("000000");
  await expect(code).toHaveAttribute("aria-describedby", "code-message");
  expect(await codeAround(), "wrong code").toEqual(step);
});

test("pending buttons keep their size, stay focusable and say what is happening", async ({
  page,
}) => {
  // Hover lifts and press scales are transforms, not layout: leave them out.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Email").fill(uniqueEmail());
  const send = page.locator('form button[type="submit"]');
  const idle = await send.boundingBox();
  const release = await holdServerActions(page, "/login");
  await send.click();
  await expect(send).toHaveAttribute("aria-busy", "true");
  await expect(send).toHaveAttribute("aria-disabled", "true");
  await expect(send).toHaveAccessibleName("Sending…");
  await expect(send).toBeFocused();
  expect(await send.boundingBox()).toEqual(idle);
  await release();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
});

test("saving the profile moves nothing around the form", async ({ page }) => {
  // Hover lifts and press scales are transforms, not layout: leave them out.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await signIn(page);
  await expect(page).toHaveURL("/account");
  const name = page.getByLabel("Display name");
  const save = page.locator('main form button[type="submit"]');
  const status = page.getByRole("status");
  const around = () =>
    layoutOf({
      name,
      english: page.getByRole("radio", { name: "English" }),
      save,
      status,
      footer: page.getByRole("contentinfo"),
    });
  const initial = await around();
  await name.focus();
  await name.fill("Steady Person");
  expect(await around(), "typing").toEqual(initial);

  const release = await holdServerActions(page, "/account");
  await save.click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save).toHaveAccessibleName("Saving…");
  await expect(status).toHaveText("Saving…");
  expect(await around(), "pending").toEqual(initial);
  await release();
  await expect(status).toHaveText("Saved.");
  expect(await around(), "saved").toEqual(initial);
  // Editing again clears the old result instead of leaving "Saved." behind.
  await name.fill("Steady Person 2");
  await expect(status).toHaveText("");
});

test("an offline submit is explained, not sent", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(uniqueEmail());
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await context.setOffline(true);
  await page.getByRole("button", { name: "Send code" }).click();
  const message = page.locator("#email-message");
  await expect(message).toHaveText(
    "You're offline. Check the connection and try again.",
  );
  expect(posts).toEqual([]);
  await context.setOffline(false);
  await expect(message).not.toContainText("offline");
});

test("navigation shows the page skeleton, never a blank area", async ({
  page,
}) => {
  await page.goto("/login");
  await signIn(page);
  await expect(page).toHaveURL("/account");
  // Prefetched loading states first, then hold the page's own data.
  await page.waitForLoadState("networkidle");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/account/sessions?_rsc=*", async (route) => {
    if (!route.request().headers()["next-router-prefetch"]) await held;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Sessions" })
    .click();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
  release();
  await expect(
    page.getByRole("listitem").filter({ hasText: "This device" }),
  ).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test("sign-in states pass an accessibility scan", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Six-digit code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#code-message")).toHaveText(
    "That code is not right. Check it and try again.",
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map((v) => `${v.id} × ${v.nodes.length}`)).toEqual([]);
});
