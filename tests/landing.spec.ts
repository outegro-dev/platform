import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const BASE = "http://localhost:3100";

async function useLocale(context: BrowserContext, locale: "en" | "ru") {
  await context.addCookies([{ name: "og_locale", value: locale, url: BASE }]);
}

async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

test("English by default even for a Russian browser; language lives in a cookie, not the URL", async ({
  page,
  context,
}) => {
  await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Depth in every detail.",
  );

  await page
    .getByRole("button", { name: /Русский/ })
    .first()
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Глубина в каждой детали.",
  );
  expect(new URL(page.url()).pathname).toBe("/");
  const cookie = (await context.cookies()).find((c) => c.name === "og_locale");
  expect(cookie?.value).toBe("ru");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page
    .getByRole("button", { name: /English/ })
    .first()
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(new URL(page.url()).pathname).toBe("/");
});

test("/ru is not a route any more", async ({ request }) => {
  expect((await request.get("/ru")).status()).toBe(404);
});

test("contact dialog lists real channels, is keyboard accessible and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Get in touch" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('a[href="mailto:coping.barrel@gmail.com"]'),
  ).toBeVisible();
  await expect(
    dialog.locator('a[href="https://t.me/coping_barrel"]'),
  ).toBeVisible();
  await expect(
    dialog.locator('a[href="https://www.linkedin.com/in/nick-lukashick/"]'),
  ).toBeVisible();
  await expect(
    dialog.locator('a[href="https://github.com/coping-barrel"]'),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("contact section shows every channel; external links open safely", async ({
  page,
}) => {
  await page.goto("/");
  const links = page.locator("#contact .contact-links a");
  await expect(links).toHaveCount(4);
  for (const link of await links.all()) {
    const href = await link.getAttribute("href");
    if (href?.startsWith("mailto:")) continue;
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
});

test("expertise shows the stack without hidden disclosures", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#expertise").scrollIntoViewIfNeeded();
  for (const tech of ["NestJS", "PostgreSQL", "Kubernetes", "Claude Code"])
    await expect(
      page.locator("#expertise").getByText(tech, { exact: true }),
    ).toBeVisible();
});

for (const locale of ["en", "ru"] as const) {
  test(`${locale}: no horizontal overflow and a visible hero action at every width`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    for (const width of [320, 390, 768, 1100, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          { message: `Overflow at ${width}` },
        )
        .toBe(true);
      await expect(page.locator(".hero-cta")).toBeInViewport();
    }
  });

  test(`${locale}: accessibility scan and real page structure`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("#projects a")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("outegro.com");
    await page.locator(".desktop-contact button").click();
    const modal = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(modal.violations).toEqual([]);
  });
}

test("header stays reachable after scrolling and hides while reading down", async ({
  page,
}) => {
  await page.goto("/");
  // Wait for hydration so the scroll listener sees the scroll happen.
  await expect(page.locator("html")).toHaveAttribute("data-reveal-ready");
  const header = page.locator(".site-header");
  await page.evaluate(() =>
    window.scrollTo({ top: 2400, behavior: "instant" }),
  );
  await expect(header).toHaveAttribute("data-hidden");
  await page.evaluate(() =>
    window.scrollBy({ top: -300, behavior: "instant" }),
  );
  await expect(header).not.toHaveAttribute("data-hidden");
  await expect(page.locator(".wordmark")).toBeInViewport();
});

test("mobile menu is always available and closes after anchor navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#platform").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -200);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /Projects/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#projects")).toBeInViewport();
});

test("reduced motion shows the rendered posters and creates no WebGL context", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const id of ["expertise", "projects"])
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await expect(page.locator("canvas")).toHaveCount(0);
  for (const stage of await page.locator(".silver-stage").all()) {
    await expect(stage).toHaveAttribute("data-scene-state", "poster");
    const poster = stage.locator(".silver-poster");
    await poster.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        poster.evaluate(
          (el) =>
            (el as HTMLImageElement).complete &&
            (el as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
});

test("software WebGL gets the poster instead of a slow scene", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (p: number) {
      if (p === 0x9246) return "Google SwiftShader";
      return Reflect.apply(original, this, [p]);
    };
  });
  await page.goto("/");
  // Scenes start on the first interaction; give them the chance to.
  await page.mouse.move(900, 400);
  await page.mouse.move(950, 420, { steps: 5 });
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".hero-art")).toHaveAttribute(
    "data-scene-state",
    "poster",
  );
});

test("WebGL unavailable keeps the portfolio usable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl2" || type === "webgl") return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator(".hero-art")).toHaveAttribute(
    "data-scene-state",
    "poster",
  );
  await expect(page.locator(".hero-cta")).toBeVisible();
});

test("3D runs without a pause control, stops offscreen and falls back on context loss", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "WebGL lifecycle is exercised in Chromium.",
  );
  await page.goto("/");
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  });
  test.skip(
    /swiftshader|llvmpipe|software/i.test(renderer),
    `Software WebGL (${renderer}) intentionally gets the poster.`,
  );
  const hero = page.locator(".hero-art");
  await expect(hero).toHaveAttribute("data-scene-state", "running", {
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /pause|play/i })).toHaveCount(
    0,
  );
  await page.locator("#contact").scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-scene-state", "offscreen");
  await page.locator("#top").scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-scene-state", "running");
  await hero
    .locator("canvas")
    .evaluate((el) =>
      (el as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext(),
    );
  await expect(hero).toHaveAttribute("data-scene-state", "poster");
  await expect(page.locator(".hero-cta")).toBeVisible();
});

test("server-rendered content remains visible without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator("#contact").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("heading", { name: /with a conversation/ }),
  ).toBeVisible();
  await expect(page.locator('#contact a[href^="mailto:"]')).toBeVisible();
  await context.close();
});

test("security headers and a nonce-based CSP are sent; no CSP violations", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  const headers = response.headers();
  const csp = headers["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-eval");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  const errors = await collectErrors(page);
  await page.goto("/");
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  // Next.js stamps the nonce on every inline script it renders.
  const inline = await page
    .locator("script:not([src])")
    .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).nonce));
  expect(inline.length).toBeGreaterThan(0);
  expect(inline.every(Boolean)).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});

test("health probes answer for Kubernetes", async ({ request }) => {
  for (const path of ["/health", "/health/deep"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("SEO metadata, social image, sitemap and noindex gallery", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://outegro.dev",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/og/,
  );
  const og = await request.get("/og");
  expect(og.headers()["content-type"]).toContain("image/png");
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  await page.goto("/design-system");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.getByLabel("Email address")).toBeVisible();
});

test("no uncaught errors or failed local assets while scrolling the page", async ({
  page,
}) => {
  const errors = await collectErrors(page);
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400)
      failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/");
  for (const section of [
    "expertise",
    "approach",
    "platform",
    "projects",
    "contact",
  ])
    await page.locator(`#${section}`).scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});
