import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const BASE = "http://localhost:3100";
const GAME = "https://battleship.outegro.dev";
// Sections of the main page, in order: Projects right after the hero strip.
const SECTIONS = [
  "top",
  "turnkey",
  "projects",
  "platform",
  "services",
  "process",
  "engagement",
  "contact",
];

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

/** Heading levels in document order; a level never skips on the way down. */
async function expectHeadingsInOrder(page: Page) {
  const levels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i++)
    expect(
      levels[i] - levels[i - 1],
      `heading ${i + 1} jumps from h${levels[i - 1]} to h${levels[i]}`,
    ).toBeLessThanOrEqual(1);
}

async function hrefs(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluateAll((els) => els.map((a) => a.getAttribute("href")));
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

test("sections come in order: hero, turnkey strip, Projects, then the rest", async ({
  page,
}) => {
  await page.goto("/");
  const ids = await page
    .locator("main > section")
    .evaluateAll((els) => els.map((el) => el.id));
  expect(ids).toEqual(SECTIONS);
  // Projects starts right after the strip, before the platform and services.
  const top = (id: string) =>
    page
      .locator(`#${id}`)
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(await top("projects")).toBeLessThan(await top("platform"));
  expect(await top("projects")).toBeLessThan(await top("services"));
});

test("the turnkey promise is concrete: every stage from idea to support", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".hero-description")).toContainText("turnkey");
  const stages = page.locator("#turnkey li");
  await expect(stages).toHaveCount(10);
  await expect(stages.first()).toHaveText("Idea");
  await expect(stages.last()).toHaveText("Support");
  for (const stage of ["Interface design", "Backend", "CI/CD", "Monitoring"])
    await expect(page.locator("#turnkey")).toContainText(stage);
});

for (const locale of ["en", "ru"] as const) {
  test(`${locale}: the platform shows what runs today, not a roadmap`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.goto("/");
    const platform = page.locator("#platform");
    await expect(platform.locator(".platform-node")).toHaveCount(9);
    await expect(platform.locator(".live-status")).toHaveText(
      locale === "en" ? "Running in production" : "Работает в продакшене",
    );
    // The tested restore is a result, stated with its number.
    await expect(platform).toContainText("81");
    await expect(page.locator("[data-status]")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      /in development|coming soon|roadmap|в разработке|скоро появ/i,
    );
  });
}

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

test("working together: deliverables, formats and a clear call to action", async ({
  page,
}) => {
  // Instant scrolling: with smooth scrolling Firefox and WebKit are still
  // moving the page when the click lands deep below the fold.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // The dialog is interactive only after hydration.
  await expect(page.locator("html")).toHaveAttribute("data-reveal-ready");
  const section = page.locator("#engagement");
  await expect(section.locator(".deliverables li")).toHaveCount(6);
  for (const item of [
    "Source code in your repository",
    "Tests",
    "Documentation",
    "CI/CD",
    "Monitoring",
    "Handover",
  ])
    await expect(section.getByRole("heading", { name: item })).toBeVisible();
  for (const format of ["A project", "Long-term work", "Audit or rescue"])
    await expect(section.getByRole("heading", { name: format })).toBeVisible();
  await section.getByRole("button", { name: "Discuss your project" }).click();
  await expect(
    page.getByRole("dialog").locator('a[href^="mailto:"]'),
  ).toBeVisible();
});

test("process: every step says what the client sees", async ({ page }) => {
  await page.goto("/");
  const steps = page.locator("#process .process-step");
  await expect(steps).toHaveCount(5);
  for (const step of await steps.all())
    await expect(step.locator(".process-see")).toContainText("You see");
  await expect(steps.first()).toContainText("Discovery");
  await expect(steps.last()).toContainText("Support");
});

test("services show the stack and where each one runs, without hidden disclosures", async ({
  page,
}) => {
  await page.goto("/");
  const services = page.locator("#services");
  await services.scrollIntoViewIfNeeded();
  await expect(services.locator(".service")).toHaveCount(6);
  for (const tech of ["NestJS", "PostgreSQL", "K3s", "Argo CD", "Lava"])
    await expect(
      services.getByText(tech, { exact: true }).first(),
    ).toBeVisible();
  await expect(
    services.locator('a[href="https://id.outegro.dev"]'),
  ).toBeVisible();
});

for (const locale of ["en", "ru"] as const) {
  test(`${locale}: Battleship is shown with localized screenshots, alt text and a Play link`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.goto("/");
    const project = page.locator("#projects");
    await expect(
      project.getByRole("heading", {
        level: 3,
        name: locale === "en" ? "Battleship" : "Морской бой",
      }),
    ).toBeVisible();
    await expect(
      project.locator(`a[href="${GAME}"]`).filter({
        hasText: locale === "en" ? "Play Battleship" : "Играть",
      }),
    ).toBeVisible();
    // One account and the purchases site are named and linked.
    await expect(
      project.locator('.project-account a[href="https://id.outegro.dev"]'),
    ).toHaveText("id.outegro.dev");
    await expect(
      project.locator('.project-account a[href="https://pay.outegro.dev"]'),
    ).toHaveText("pay.outegro.dev");

    const shots = project.locator("img");
    await expect(shots).toHaveCount(5);
    const alts = new Set<string>();
    for (const shot of await shots.all()) {
      const alt = (await shot.getAttribute("alt")) ?? "";
      expect(alt.length).toBeGreaterThan(40);
      alts.add(alt);
      // Below the hero: nothing is fetched before it is needed.
      await expect(shot).toHaveAttribute("loading", "lazy");
      await expect(shot).toHaveAttribute("src", new RegExp(`-${locale}\\.`));
    }
    expect(alts.size).toBe(5);
    for (const shot of await shots.all()) {
      await shot.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          shot.evaluate(
            (el) =>
              (el as HTMLImageElement).complete &&
              (el as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
  });
}

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
    await expectHeadingsInOrder(page);
    // The published project is the game on the platform.
    await expect(page.locator(`#projects a[href="${GAME}"]`)).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText("outegro.com");
    await page.locator(".desktop-contact button").click();
    const modal = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(modal.violations).toEqual([]);
  });
}

test("header navigation links every section in page order", async ({
  page,
}) => {
  await page.goto("/");
  expect(await hrefs(page, ".desktop-nav a")).toEqual([
    "#projects",
    "#platform",
    "#services",
    "#process",
    "#contact",
  ]);
  await page.locator(".desktop-nav a", { hasText: "Projects" }).click();
  await expect(page.locator("#projects")).toBeInViewport();
});

test("footer links the platform's sites on every page", async ({ page }) => {
  for (const path of ["/", "/privacy"]) {
    await page.goto(path);
    const platform = page
      .getByRole("contentinfo")
      .getByRole("navigation", { name: "Platform" });
    await expect(platform.getByRole("link")).toHaveCount(3);
    await expect(
      platform.getByRole("link", { name: /Battleship/ }),
    ).toHaveAttribute("href", GAME);
    await expect(
      platform.getByRole("link", { name: /Account/ }),
    ).toHaveAttribute("href", "https://id.outegro.dev");
    await expect(
      platform.getByRole("link", { name: /Purchases & subscriptions/ }),
    ).toHaveAttribute("href", "https://pay.outegro.dev/subscriptions");
  }
});

test("keyboard: the skip link comes first and the navigation follows in order", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Safari only tabs to links with Option+Tab by default.",
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-reveal-ready");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await expect(page.locator(".skip-link")).toBeInViewport();
  await page.keyboard.press("Tab");
  await expect(page.locator(".wordmark")).toBeFocused();
  for (const name of [
    "Projects",
    "Platform",
    "Services",
    "Process",
    "Contact",
  ]) {
    await page.keyboard.press("Tab");
    await expect(
      page.locator(".desktop-nav").getByRole("link", { name }),
    ).toBeFocused();
  }
  await page
    .locator(".desktop-nav")
    .getByRole("link", { name: "Projects" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#projects")).toBeInViewport();
});

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
  const menu = page.getByRole("dialog");
  await menu.getByRole("link", { name: /Process/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#process")).toBeInViewport();
});

test("reduced motion shows the rendered posters and creates no WebGL context", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [path, stages] of [["/", 2]] as const) {
    await page.goto(path);
    await expect(page.locator(".silver-stage")).toHaveCount(stages);
    for (const stage of await page.locator(".silver-stage").all())
      await stage.scrollIntoViewIfNeeded();
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
  const battle = page.locator("#projects img").first();
  await battle.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      battle.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0),
    )
    .toBe(true);
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
  // Every page gets its own nonce, not only the main one.
  for (const path of ["/privacy"])
    expect(
      (await request.get(path)).headers()["content-security-policy"],
    ).toMatch(/'nonce-[^']+'/);

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

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 720 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  for (const path of ["/"]) {
    test(`${device} ${path}: first load does not shift the layout (CLS < 0.02, cache disabled)`, async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== "chromium",
        "Layout-shift entries and network emulation are Chromium APIs.",
      );
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      // Chrome's "Slow 4G": the fonts arrive after the first paint.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
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
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1000);
      const cls = await page.evaluate(
        () => (window as unknown as { __cls: number }).__cls,
      );
      expect(cls).toBeLessThan(0.02);
    });
  }
}

test("loading the screenshots while scrolling does not shift the layout", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Layout-shift entries are a Chromium API.",
  );
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
  await page.goto("/");
  for (const shot of await page.locator("#projects img").all()) {
    await shot.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        shot.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0),
      )
      .toBe(true);
  }
  const cls = await page.evaluate(
    () => (window as unknown as { __cls: number }).__cls,
  );
  expect(cls).toBeLessThan(0.02);
});

test("posters and screenshots are served as WebP even to browsers that accept AVIF", async ({
  page,
  request,
}) => {
  // AVIF encoding of the widest poster pushed the server past its memory
  // limit in production; WebP was smaller for these posters anyway.
  await page.goto("/");
  for (const image of [
    page.locator("#services .silver-poster"),
    page.locator("#projects img").first(),
  ]) {
    const src = await image.evaluate(
      (img: HTMLImageElement) => img.currentSrc || img.src,
    );
    const widest = new URL(src);
    widest.searchParams.set("w", "3840");
    const response = await request.get(widest.pathname + widest.search, {
      headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");
  }
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
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /turnkey/,
  );
  const og = await request.get("/og");
  expect(og.headers()["content-type"]).toContain("image/png");
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const urls = await sitemap.text();
  for (const url of ["https://outegro.dev/", "https://outegro.dev/privacy"])
    expect(urls).toContain(url);
  await page.goto("/design-system");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.getByLabel("Email address")).toBeVisible();
});

test("no uncaught errors or failed local assets while scrolling the pages", async ({
  page,
}) => {
  // Two long pages with lazy images and 3D scenes; WebKit needs the time.
  test.setTimeout(90_000);
  const errors = await collectErrors(page);
  const failed: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400)
      failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/");
  for (const section of SECTIONS)
    await page.locator(`#${section}`).scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});

for (const locale of ["en", "ru"] as const) {
  test(`${locale}: privacy policy is linked from the footer and indexable`, async ({
    page,
    context,
    request,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("contentinfo")
      .getByRole("link", {
        name: locale === "en" ? "Privacy" : "Конфиденциальность",
      })
      .click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      locale === "en" ? "Your data" : "Ваши данные",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://outegro.dev/privacy",
    );
    await expect(
      page.getByRole("link", { name: "coping.barrel@gmail.com" }),
    ).toHaveAttribute("href", "mailto:coping.barrel@gmail.com");
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("https://outegro.dev/privacy");
  });
}
