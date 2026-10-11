import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import en from "../apps/landing-web/src/messages/en.json";
import ru from "../apps/landing-web/src/messages/ru.json";

/*
 * The landing as a zine: the cover, the contents, the Battleship report, the
 * platform diagram, the classifieds, the paper cartoon, price tags and the
 * receipt, letters to the editor and the coupon; the /stack menu with its
 * trading cards, and /privacy. The run serves the standalone build without
 * SSO or GTM env (see playwright.config.ts): no account control, no consent
 * note, no Google hosts. Copy comes from the site's own messages, so both
 * languages are checked against what the pages are meant to say.
 */

const BASE = "http://localhost:3100";
const CALENDLY = "https://calendly.com/nick-lukashik/30min";
const TELEGRAM = "https://t.me/coping_barrel";
const GAME = "https://battleship.outegro.dev";
const messages = { en, ru } as const;
type Locale = keyof typeof messages;
const locales = ["en", "ru"] as const;
const SECTIONS = [
  "top",
  "projects",
  "platform",
  "services",
  "process",
  "engagement",
  "faq",
  "contact",
];

// The gates play on every page load until skipped; every test but the
// gates' own starts with the session cookie a skip sets.
test.use({
  storageState: {
    cookies: [
      {
        name: "og_gate",
        value: "1",
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ],
    origins: [],
  },
});

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

async function useLocale(context: BrowserContext, locale: Locale) {
  await context.addCookies([{ name: "og_locale", value: locale, url: BASE }]);
}

/** Hydrated: the reveal observer (on / and /stack) marks the root. */
async function hydrated(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-reveal-ready");
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

async function hrefs(locator: Locator) {
  return locator.evaluateAll((els) => els.map((a) => a.getAttribute("href")));
}

const literally = (text: string) =>
  new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/** Instantly, so the element sits still in the middle of the viewport. */
async function centre(locator: Locator) {
  await locator.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
}

/** The link a pointer opens at the middle of an element (a hit test). */
async function linkAt(locator: Locator) {
  await centre(locator);
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return hit?.closest("a")?.getAttribute("href") ?? null;
  });
}

async function expectLoaded(image: Locator) {
  await centre(image);
  await expect
    .poll(() =>
      image.evaluate(
        (el) =>
          (el as HTMLImageElement).complete &&
          (el as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
}

async function expectNewTab(link: Locator) {
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
}

// ─── Languages ───────────────────────────────────────────────

test("English by default even for a Russian browser; the language lives in a cookie, not the URL", async ({
  page,
  context,
}) => {
  await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    en.zine.headline,
  );
  await hydrated(page);

  await page
    .getByRole("button", { name: /Русский/ })
    .first()
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    ru.zine.headline,
  );
  expect(new URL(page.url()).pathname).toBe("/");
  const cookie = (await context.cookies()).find((c) => c.name === "og_locale");
  expect(cookie?.value).toBe("ru");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await hydrated(page);
  await page
    .getByRole("button", { name: /English/ })
    .first()
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(new URL(page.url()).pathname).toBe("/");
});

test("/ru is not a route", async ({ request }) => {
  expect((await request.get("/ru")).status()).toBe(404);
});

// ─── The cover and the contents ──────────────────────────────

for (const locale of locales) {
  const t = messages[locale];

  test(`${locale}: the cover has the headline, the cover lines and the Calendly call`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const cover = page.locator("#top");
    // The ransom-note headline reads as plain text to assistive tech.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(cover.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      t.zine.headline,
    );
    await expect(cover.locator(".cover-tagline")).toHaveText(t.zine.tagline);
    await expect(cover.locator(".cover-lead")).toHaveText(t.zine.lead);
    await expect(
      cover.getByRole("img", { name: t.zine.coverAlt }),
    ).toBeVisible();

    // Every cover line points at the page of the issue it is about.
    const lines = cover.locator(".coverlines a");
    await expect(lines).toHaveCount(t.zine.coverlines.length);
    const pageHref = (no: string) =>
      t.zine.toc.find((item) => item.page === no)?.href;
    expect(await hrefs(lines)).toEqual(
      t.zine.coverlines.map((line) => pageHref(line.page)),
    );
    for (const [i, line] of t.zine.coverlines.entries()) {
      await expect(lines.nth(i)).toContainText(line.kicker);
      await expect(lines.nth(i)).toContainText(line.text);
    }

    // The main action: a 30-minute Calendly slot, in a new tab.
    const book = cover.getByRole("link", { name: t.nav.book });
    await expect(book).toBeVisible();
    await expect(book).toHaveAttribute("href", CALENDLY);
    await expectNewTab(book);
    await expect(book).toHaveAccessibleDescription(t.nav.bookHint);
    await expect(
      cover.getByRole("link", { name: t.zine.read }),
    ).toHaveAttribute("href", "#projects");
    // The same call closes the FAQ and sits on the coupon.
    for (const section of ["#faq", "#contact"]) {
      const call = page
        .locator(section)
        .getByRole("link", { name: t.nav.book })
        .first();
      await expect(call).toHaveAttribute("href", CALENDLY);
      await expectNewTab(call);
    }
  });

  test(`${locale}: the contents link every section, #faq included, and the anchors land`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    // Instant scrolling: a smooth one is still moving when the check runs.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const ids = await page
      .locator("main > section[id]")
      .evaluateAll((els) => els.map((el) => el.id));
    expect(ids).toEqual(SECTIONS);

    const toc = page.getByRole("navigation", { name: t.zine.tocTitle });
    const targets = t.zine.toc.map((item) => item.href);
    expect(targets).toContain("#faq");
    expect(await hrefs(toc.getByRole("link"))).toEqual(targets);
    for (const item of t.zine.toc) {
      await expect(page.locator(item.href)).toHaveCount(1);
      await expect(
        toc.getByRole("link", { name: literally(item.title) }),
      ).toContainText(item.page);
    }
    // The paper strip at the bottom has a buoy for every page of the issue.
    const buoys = page
      .getByRole("navigation", { name: t.zine.boatLabel })
      .getByRole("link");
    expect(await hrefs(buoys)).toEqual(targets);

    await hydrated(page);
    const faq = t.zine.toc.find((item) => item.href === "#faq");
    await toc.getByRole("link", { name: literally(faq?.title ?? "") }).click();
    await expect(page).toHaveURL(/#faq$/);
    await expect(page.locator("#faq")).toBeInViewport();
  });
}

test("header navigation covers the sections, FAQ and the Stack page, from either page", async ({
  page,
}) => {
  // The section strip fits the bar from 2xl; narrower, it is in the menu.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const nav = page.locator(".desktop-nav a");
  expect(await hrefs(nav)).toEqual([
    "#projects",
    "#platform",
    "#services",
    "#process",
    "/stack",
    "#faq",
    "#contact",
  ]);
  await expect(page.locator(".wordmark")).toHaveAttribute("href", "#top");
  // The call to book is in the header too; next to the section strip it
  // wears the short label, and its name is the visible one.
  const book = page.locator(".site-header .header-book");
  await expect(book).toHaveAccessibleName(en.nav.bookShort);
  await expect(book).toHaveAttribute("href", CALENDLY);
  await expectNewTab(book);

  await page.locator(".desktop-nav a", { hasText: "Stack" }).click();
  await expect(page).toHaveURL(/\/stack$/);
  await expect(
    page.locator(".desktop-nav a", { hasText: "Stack" }),
  ).toHaveAttribute("aria-current", "page");
  expect(await hrefs(nav)).toEqual([
    "/#projects",
    "/#platform",
    "/#services",
    "/#process",
    "/stack",
    "/#faq",
    "/#contact",
  ]);
  await expect(page.locator(".wordmark")).toHaveAttribute("href", "/");
  await page.locator(".desktop-nav a", { hasText: "FAQ" }).click();
  await expect(page).toHaveURL(/\/#faq$/);
  await expect(page.locator("#faq")).toBeInViewport();
});

test("keyboard: the skip link comes first and the navigation follows in order", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Safari only tabs to links with Option+Tab by default.",
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await hydrated(page);
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
    "Stack",
    "FAQ",
    "Contact",
  ]) {
    await page.keyboard.press("Tab");
    await expect(
      page.locator(".desktop-nav").getByRole("link", { name }),
    ).toBeFocused();
  }
});

test("the phone menu lists every section and the Stack page, offers the call and closes after a jump", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await hydrated(page);
  await page.getByRole("button", { name: en.nav.menu }).click();
  const menu = page.getByRole("dialog");
  // seven places and the call; no account link while the site has no accounts
  await expect(menu.getByRole("link")).toHaveCount(8);
  await expect(menu.getByRole("link", { name: /Stack/ })).toHaveAttribute(
    "href",
    "/stack",
  );
  const book = menu.getByRole("link", { name: en.nav.book });
  await expect(book).toHaveAttribute("href", CALENDLY);
  await expectNewTab(book);
  await menu.getByRole("link", { name: /FAQ/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#faq")).toBeInViewport();
});

test("header stays reachable after scrolling and hides while reading down", async ({
  page,
}) => {
  await page.goto("/");
  await hydrated(page);
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

test("the contact dialog lists every channel, is keyboard accessible and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  await hydrated(page);
  const trigger = page
    .locator("#top")
    .getByRole("button", { name: en.zine.write });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const href of [
    CALENDLY,
    "mailto:coping.barrel@gmail.com",
    TELEGRAM,
    "https://www.linkedin.com/in/nick-lukashick/",
    "https://github.com/coping-barrel",
  ])
    await expect(dialog.locator(`a[href="${href}"]`)).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

// ─── The issue ───────────────────────────────────────────────

for (const locale of locales) {
  const t = messages[locale];

  test(`${locale}: Battleship is shown with localized screenshots, alt text and a Play link`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.goto("/");
    const project = page.locator("#projects .project");
    await expect(
      project.getByRole("heading", { level: 3, name: t.projects.name }),
    ).toBeVisible();
    await expect(
      project.locator(`a[href="${GAME}"]`).filter({ hasText: t.projects.play }),
    ).toBeVisible();
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
      // Below the cover: nothing is fetched before it is needed.
      await expect(shot).toHaveAttribute("loading", "lazy");
      await expect(shot).toHaveAttribute("src", new RegExp(`-${locale}\\.`));
    }
    expect(alts.size).toBe(5);
    for (const shot of await shots.all()) await expectLoaded(shot);
  });

  test(`${locale}: the platform shows what runs today, not a roadmap`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const platform = page.locator("#platform");
    await expect(platform.locator(".platform-node")).toHaveCount(
      t.platform.layers.reduce((n, layer) => n + layer.items.length, 0),
    );
    await expect(platform.locator(".live-status")).toHaveText(t.platform.live);
    // The tested restore is a result, stated with its number.
    await expect(platform).toContainText("81");
    await expect(page.locator("body")).not.toContainText(
      /in development|coming soon|roadmap|в разработке|скоро появ/i,
    );
  });

  test(`${locale}: classifieds are whole-card Telegram links; the proof links still work`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const services = page.locator("#services");
    await expect(
      services.getByRole("heading", { level: 2, name: t.services.title }),
    ).toBeVisible();
    await expect(services.locator(".ads-note")).toHaveText(t.zine.adsNote);
    const ads = services.locator(".ads > li");
    await expect(ads).toHaveCount(t.services.items.length);

    for (const [i, item] of t.services.items.entries()) {
      const ad = ads.nth(i);
      // One link per ad, named for what it does, opening Telegram.
      const link = ad.getByRole("link", {
        name: t.zine.adWrite.replace("{title}", item.title),
        exact: true,
      });
      await expect(link).toHaveText(item.title);
      await expect(link).toHaveAttribute("href", TELEGRAM);
      await expectNewTab(link);
      // The whole card takes the click: its text and badges hit the link.
      expect(await linkAt(ad.locator(".ad-body"))).toBe(TELEGRAM);
      expect(await linkAt(ad.locator(".badge-list"))).toBe(TELEGRAM);
      // The tear-off tabs are paper for assistive tech, out of the tab order.
      await expect(ad.locator(".tear-offs")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      for (const tab of await ad.locator(".tear-offs a").all())
        await expect(tab).toHaveAttribute("tabindex", "-1");

      // A proof link sits above the card's link and opens its own page.
      const proof = ad.locator(".ad-proof a");
      if (item.href) {
        await expect(proof).toHaveText(item.proof);
        await expect(proof).toHaveAttribute("href", item.href);
        expect(await linkAt(proof)).toBe(item.href);
      } else {
        await expect(proof).toHaveCount(0);
        await expect(ad.locator(".ad-proof")).toHaveText(item.proof);
      }
    }
    // Keyboard: the ad links and the proof links, nothing nested, no tabs.
    await expect(services.locator('a:not([tabindex="-1"])')).toHaveCount(
      t.services.items.length +
        t.services.items.filter((item) => item.href).length,
    );
    await expect(services.locator("a a")).toHaveCount(0);
  });

  test(`${locale}: the paper cartoon walks through every step and says what you see`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.goto("/");
    const steps = page.locator("#process .pj-step");
    await expect(steps).toHaveCount(t.process.steps.length);
    for (const [i, step] of t.process.steps.entries()) {
      await expect(steps.nth(i).locator(".pj-title")).toHaveText(step.title);
      await expect(steps.nth(i).locator(".pj-see")).toContainText(
        t.process.youSee,
      );
    }
  });

  test(`${locale}: price tags and the receipt render every format and deliverable`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const section = page.locator("#engagement");
    const tags = section.locator(".price-tags > li");
    await expect(tags).toHaveCount(t.engagement.formats.length);
    for (const [i, format] of t.engagement.formats.entries()) {
      const tag = tags.nth(i);
      await expect(
        tag.getByRole("heading", { level: 4, name: format.title }),
      ).toBeVisible();
      await expect(tag.locator(".price-value")).toHaveText(t.zine.tags[i]);
      await expect(tag.locator(".price-was")).toHaveText(t.zine.tagWas);
    }
    await expect(section.locator(".tags-note")).toHaveText(t.zine.tagsNote);

    const receipt = section.locator(".receipt");
    await centre(receipt);
    await expect(receipt).toBeVisible();
    await expect(receipt.locator(".receipt-head")).toContainText(
      t.zine.receiptNumber,
    );
    const lines = receipt.locator(".receipt-lines > li");
    await expect(lines).toHaveCount(t.engagement.deliverables.length);
    for (const [i, item] of t.engagement.deliverables.entries()) {
      await expect(lines.nth(i)).toContainText(item.title);
      await expect(lines.nth(i)).toContainText(t.zine.receiptIncluded);
    }
    await expect(receipt.locator(".receipt-total")).toContainText(
      t.zine.receiptTotalValue,
    );
    await expect(receipt.locator(".stamp-mark")).toHaveText(t.zine.stampPaid);

    const cta = section.locator(".engagement-cta");
    await expect(cta.getByRole("link", { name: t.nav.book })).toHaveAttribute(
      "href",
      CALENDLY,
    );
    await expect(
      cta.getByRole("button", { name: t.engagement.cta }),
    ).toBeVisible();
  });

  test(`${locale}: letters to the editor answer the usual questions`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.goto("/");
    const faq = page.locator("#faq");
    await expect(
      faq.getByRole("heading", {
        level: 2,
        name: `${t.faq.title} ${t.faq.titleAccent}`,
      }),
    ).toBeVisible();
    const letters = faq.locator(".letter");
    await expect(letters).toHaveCount(t.faq.items.length);
    // Every answer is in the markup: no toggles to open.
    for (const [i, letter] of t.faq.items.entries()) {
      await expect(
        letters.nth(i).getByRole("heading", { level: 3 }),
      ).toHaveText(letter.q);
      await expect(letters.nth(i).locator(".letter-a")).toHaveText(letter.a);
    }
    await expect(faq.locator(".faq-more")).toContainText(t.faq.more);
  });
}

test("cutting the coupon out says so; the call and the contacts are always there", async ({
  page,
}) => {
  await page.goto("/");
  await hydrated(page);
  const contact = page.locator("#contact");
  const coupon = contact.locator(".coupon");
  await expect(coupon).toContainText(en.zine.couponOffer);
  await expect(coupon.getByRole("link", { name: en.nav.book })).toHaveAttribute(
    "href",
    CALENDLY,
  );
  // The contacts are in the markup before and after the show.
  const channels = contact.locator(".coupon-under .contact-links a");
  expect(await hrefs(channels)).toEqual([
    CALENDLY,
    "mailto:coping.barrel@gmail.com",
    TELEGRAM,
    "https://www.linkedin.com/in/nick-lukashick/",
    "https://github.com/coping-barrel",
  ]);
  for (const link of await channels.all()) {
    if ((await link.getAttribute("href"))?.startsWith("mailto:")) continue;
    await expectNewTab(link);
  }

  const cut = contact.getByRole("button", { name: en.zine.couponCut });
  await centre(cut);
  await cut.click();
  await expect(cut).toBeDisabled();
  await expect(contact.getByRole("status")).toHaveText(en.zine.couponCut2);
  await expect(contact.locator(".coupon-wrap")).toHaveAttribute(
    "data-state",
    "cut",
  );
  for (const link of await channels.all()) {
    await centre(link);
    await expect(link).toBeVisible();
  }
});

test("reduced motion cuts the coupon at once, from the keyboard", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await hydrated(page);
  const contact = page.locator("#contact");
  const cut = contact.getByRole("button", { name: en.zine.couponCut });
  await cut.focus();
  await page.keyboard.press("Enter");
  await expect(contact.locator(".coupon-wrap")).toHaveAttribute(
    "data-state",
    "cut",
  );
  await expect(contact.getByRole("status")).toHaveText(en.zine.couponCut2);
});

test("reduced motion: the paper cartoon is a sticker layout and the strip is flat paper", async ({
  page,
}) => {
  const errors = await collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await hydrated(page);

  // The cartoon: paper notes with stickers, no stage, no WebGL.
  const cartoon = page.locator("#process .pj");
  await expect(cartoon).toHaveAttribute("data-mode", "static");
  await expect(cartoon.locator(".pj-stage")).toHaveCount(0);
  await expect(cartoon.locator(".pj-dots")).toHaveCount(0);
  const steps = cartoon.locator(".pj-step");
  await expect(steps).toHaveCount(en.process.steps.length);
  for (const step of await steps.all()) {
    await centre(step);
    await expect(step.locator(".pj-note")).toBeVisible();
    const stickers = step.locator(".pj-sticker");
    expect(await stickers.count()).toBeGreaterThan(0);
    for (const sticker of await stickers.all()) {
      await expect(sticker).toBeVisible();
      await expectLoaded(sticker);
    }
  }

  // The strip: every kind of input, and still no sea; flat paper in the
  // colour of the section's set.
  await page.mouse.move(400, 300);
  await page.mouse.move(600, 400, { steps: 4 });
  await page.keyboard.press("Shift");
  const strip = page.locator(".boat-bar");
  for (const [section, backdrop] of [
    ["#platform", "deep"],
    ["#services", "road"],
    ["#faq", "sky"],
  ] as const) {
    await page.locator(section).evaluate((el) => {
      el.scrollIntoView({ block: "start", behavior: "instant" });
      window.scrollBy({ top: 40, behavior: "instant" });
    });
    await expect(strip, section).toHaveAttribute("data-shown", "");
    await expect(strip, section).toHaveAttribute("data-backdrop", backdrop);
  }
  await expect(strip).not.toHaveAttribute("data-sea");
  await expect(strip.locator(".boat-sea")).toHaveCSS("height", "30px");
  await expect(page.locator("canvas")).toHaveCount(0);
  // The buoys are plain links: one jumps to its page.
  const platform = en.zine.toc.find((item) => item.href === "#platform");
  await strip
    .getByRole("link", { name: literally(platform?.title ?? "") })
    .click();
  await expect(page).toHaveURL(/#platform$/);
  expect(errors).toEqual([]);
});

// ─── /stack and /privacy ─────────────────────────────────────

for (const locale of locales) {
  const t = messages[locale];

  test(`${locale}: the /stack menu lists the platform's technologies, is linked and indexable`, async ({
    page,
    context,
    request,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: t.footer.stack, exact: true })
      .click();
    await expect(page).toHaveURL(/\/stack$/);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText(t.stackPage.titleAccent);

    // The menu's contents: one link per section, each to its own section.
    const sections = Object.entries(t.stackPage.sections);
    const toc = page.getByRole("navigation", {
      name: t.stackPage.sectionsLabel,
    });
    expect(await hrefs(toc.getByRole("link"))).toEqual(
      sections.map(([id]) => `#${id}`),
    );
    for (const [id, section] of sections)
      await expect(
        page.locator(`#${id}`).getByRole("heading", { level: 2 }),
      ).toContainText(section.title);
    const menu = page.locator(".menu-card");
    for (const dish of [
      "Next.js 16",
      "NestJS 12",
      "PostgreSQL 18 · CloudNativePG",
      "RabbitMQ 4",
      "Argo CD",
      "Prometheus",
      "Playwright",
      "Claude Code · Codex",
    ])
      await expect(
        menu.getByRole("heading", { level: 3, name: dish, exact: true }),
      ).toBeVisible();
    // Where it makes sense, a dish links to the app it runs in.
    await expect(
      page.locator(`#frontend .dish-live a[href="${GAME}"]`).first(),
    ).toBeVisible();
    await expect(
      page.locator('#backend a[href="https://id.outegro.dev"]').first(),
    ).toBeVisible();
    const book = page
      .locator(".menu-cta")
      .getByRole("link", { name: t.nav.book });
    await expect(book).toHaveAttribute("href", CALENDLY);
    await expectNewTab(book);

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://outegro.dev/stack",
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      "https://outegro.dev/stack",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("https://outegro.dev/stack");
  });

  test(`${locale}: the trading cards flip with the keyboard, both sides in the markup`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.goto("/stack");
    await hydrated(page);
    const cards = page.locator("#trumps .trump");
    await expect(cards).toHaveCount(8);
    const card = cards.first();
    // Both faces are in the page, for screen readers and without scripts.
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(
      "Next.js 16",
    );
    await expect(card.locator(".trump-fact")).toHaveText(
      t.stackPage.trumps.cards.next.does,
    );

    const flip = card.getByRole("button", {
      // the sr-only ": name" may or may not be joined with a space
      name: new RegExp(`^${t.stackPage.trumps.flip} ?: Next\\.js 16$`),
    });
    await expect(flip).toHaveAttribute("aria-pressed", "false");
    await flip.focus();
    await page.keyboard.press("Enter");
    await expect(flip).toHaveAttribute("aria-pressed", "true");
    await expect(card).toHaveAttribute("data-flipped", "true");
    await page.keyboard.press("Space");
    await expect(flip).toHaveAttribute("aria-pressed", "false");
    await expect(card).not.toHaveAttribute("data-flipped");
    // Each card has its own button; turning one leaves the others.
    const second = cards.nth(1).getByRole("button");
    await second.focus();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(1)).toHaveAttribute("data-flipped", "true");
    await expect(flip).toHaveAttribute("aria-pressed", "false");
  });

  test(`${locale}: /privacy lists every cookie and has the statistics settings`, async ({
    page,
    context,
    request,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: t.footer.privacy, exact: true })
      .click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      t.privacy.title,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://outegro.dev/privacy",
    );

    const cookieSection = t.privacy.sections[1];
    const cookies = page.locator(".legal-section").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: cookieSection.title,
        exact: true,
      }),
    });
    await expect(cookies.getByRole("listitem")).toHaveCount(
      cookieSection.items.length,
    );
    for (const name of [
      "og_locale",
      "og_at",
      "og_rt",
      "og_hint",
      "og_silent",
      "og_sso",
      "og_gate",
      "og_consent",
      "_ga",
      "__cf_bm",
    ])
      await expect(cookies).toContainText(name);

    // Statistics settings: nothing to choose while GTM_ID is unset.
    const analytics = page.locator("#analytics");
    await expect(
      analytics.getByRole("heading", {
        level: 2,
        name: t.privacy.analytics.title,
      }),
    ).toBeVisible();
    await expect(analytics).toContainText(t.privacy.analytics.off);
    await expect(analytics.getByRole("button")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "coping.barrel@gmail.com" }),
    ).toHaveAttribute("href", "mailto:coping.barrel@gmail.com");

    // The footer's statistics link lands on the settings.
    await expect(
      page
        .getByRole("contentinfo")
        .getByRole("link", { name: t.footer.analytics }),
    ).toHaveAttribute("href", "/privacy#analytics");
    await page.goto("/privacy#analytics");
    await expect(analytics).toBeInViewport();

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("https://outegro.dev/privacy");
  });
}

test("the footer links the platform's sites and this site's pages on every page", async ({
  page,
}) => {
  for (const path of ["/", "/stack", "/privacy"]) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    const platform = footer.getByRole("navigation", {
      name: en.footer.platform,
    });
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
    const site = footer.getByRole("navigation", { name: en.footer.site });
    expect(await hrefs(site.getByRole("link"))).toEqual([
      "/stack",
      "/privacy",
      "/privacy#analytics",
    ]);
  }
});

// ─── The gates ───────────────────────────────────────────────

/**
 * Holds the gates shut: their CSS show stays paused until they are skipped,
 * so a check never races the 2.3-second show or a slow hydration.
 */
async function holdTheGates(page: Page) {
  await page.addInitScript(() => {
    const css =
      ".gate:not([data-state]), .gate:not([data-state]) * { animation-play-state: paused !important; }";
    const add = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
    };
    if (document.head) add();
    else
      new MutationObserver((_, observer) => {
        if (!document.head) return;
        observer.disconnect();
        add();
      }).observe(document, { childList: true, subtree: true });
  });
}

/** A skip is remembered for the session in the loader's cookie. */
async function gateNoted(context: BrowserContext) {
  await expect
    .poll(async () =>
      (await context.cookies()).find((c) => c.name === "og_gate"),
    )
    .toMatchObject({ value: "1", expires: -1 });
}

test.describe("the gate loader", () => {
  // A fresh browser session: the gates have not played yet.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the server shuts the gates for a person, not for Googlebot, not after og_gate=1, not on the kit specimen", async ({
    request,
  }) => {
    const html = async (path: string, headers: Record<string, string>) =>
      (await request.get(path, { headers })).text();
    for (const path of ["/", "/stack", "/privacy"])
      expect(await html(path, { "user-agent": CHROME_UA }), path).toContain(
        'class="gate"',
      );
    expect(await html("/", { "user-agent": GOOGLEBOT_UA })).not.toContain(
      'class="gate"',
    );
    expect(
      await html("/", { "user-agent": CHROME_UA, cookie: "og_gate=1" }),
    ).not.toContain('class="gate"');
    expect(
      await html("/design-system", { "user-agent": CHROME_UA }),
    ).not.toContain('class="gate"');
  });

  test("every page load opens through the gates, a reload too", async ({
    page,
    context,
  }) => {
    await holdTheGates(page);
    const first = await page.goto("/");
    expect(await first?.text()).toContain('class="gate"');
    const gate = page.locator(".gate");
    await expect(gate).toBeVisible();
    // decoration only: nothing in it reaches assistive tech
    await expect(gate).toHaveAttribute("aria-hidden", "true");
    await expect(gate.locator(".gate-sign-name")).toHaveText(en.loader.pier);
    // playing is not skipping: nothing is remembered
    expect(
      (await context.cookies()).find((c) => c.name === "og_gate"),
    ).toBeUndefined();

    const again = await page.reload();
    expect(await again?.text()).toContain('class="gate"');
    const next = await page.goto("/stack");
    expect(await next?.text()).toContain('class="gate"');
  });

  test("Esc opens the gates at once and keeps them open for the session", async ({
    page,
    context,
  }) => {
    await holdTheGates(page);
    await page.goto("/");
    const gate = page.locator(".gate");
    await expect(gate).toBeVisible();
    // Held shut, the gates can only go because Esc skipped the show.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(gate).toHaveCount(0, { timeout: 500 });
    }).toPass();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await gateNoted(context);

    const next = await page.goto("/stack");
    expect(await next?.text()).not.toContain('class="gate"');
    await expect(page.locator(".gate")).toHaveCount(0);
  });

  test("Googlebot gets the page without gates", async ({ browser }) => {
    const context = await browser.newContext({ userAgent: GOOGLEBOT_UA });
    const page = await context.newPage();
    const response = await page.goto(`${BASE}/`);
    expect(await response?.text()).not.toContain('class="gate"');
    await expect(page.locator(".gate")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.close();
  });

  test("the kit specimen opens straight away", async ({ page }) => {
    const response = await page.goto("/design-system");
    expect(await response?.text()).not.toContain('class="gate"');
    await expect(page.locator(".gate")).toHaveCount(0);
  });

  test("reduced motion never shows the gates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await holdTheGates(page);
    await page.goto("/");
    await expect(page.locator(".gate")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

// ─── Without SSO and GTM ─────────────────────────────────────

test("no consent note, no Google tag and no Google hosts while GTM_ID is unset", async ({
  page,
  request,
}) => {
  const google: string[] = [];
  page.on("request", (r) => {
    if (/google/i.test(new URL(r.url()).hostname)) google.push(r.url());
  });
  for (const path of ["/", "/stack", "/privacy"]) {
    const csp = (await request.get(path)).headers()["content-security-policy"];
    expect(csp, path).not.toMatch(/google/i);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".consent")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: en.consent.accept }),
    ).toHaveCount(0);
    await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => "dataLayer" in window), path).toBe(false);
  }
  expect(google).toEqual([]);
});

test("SSO off: no account control in the header and no failing requests", async ({
  page,
  request,
}) => {
  // Three long pages with lazy images; WebKit needs the time.
  test.setTimeout(90_000);
  const errors = await collectErrors(page);
  const failed: string[] = [];
  const asked: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText ?? "";
    // leaving a page cancels what is still loading; that is not a failure
    if (!/abort|cancel/i.test(reason)) failed.push(`${reason} ${r.url()}`);
  });
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/") || path.startsWith("/auth/"))
      asked.push(r.url());
  });

  await page.goto("/");
  await hydrated(page);
  await expect(
    page.locator('.site-header [data-slot^="account-menu"]'),
  ).toHaveCount(0);
  for (const id of SECTIONS)
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");

  await page.goto("/stack");
  await hydrated(page);
  await expect(
    page.locator('.site-header [data-slot^="account-menu"]'),
  ).toHaveCount(0);
  for (const section of await page.locator(".menu-section, #trumps").all())
    await section.scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");

  await page.goto("/privacy");
  await page.waitForLoadState("networkidle");

  expect(asked).toEqual([]);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
  // The account API and the sign-in round trip answer as if they were not there.
  for (const path of ["/api/account", "/auth/sign-in", "/auth/callback"])
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(
      404,
    );
  expect((await request.post("/auth/sign-out")).status()).toBe(404);
});

// ─── Accessibility and layout ────────────────────────────────

for (const locale of locales) {
  for (const path of ["/", "/stack", "/privacy"]) {
    test(`${locale} ${path}: axe finds nothing serious at desktop and phone sizes`, async ({
      page,
      context,
    }) => {
      test.setTimeout(90_000);
      await useLocale(context, locale);
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        const serious = scan.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => ({
            id: v.id,
            impact: v.impact,
            targets: v.nodes.slice(0, 5).map((node) => node.target.join(" ")),
          }));
        expect(serious, `${path} at ${viewport.width}px`).toEqual([]);
      }
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expectHeadingsInOrder(page);
    });
  }

  test(`${locale}: no horizontal overflow at any width`, async ({
    page,
    context,
  }) => {
    await useLocale(context, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/stack", "/privacy"]) {
      await page.goto(path);
      for (const width of [320, 390, 768, 1100, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(
            () =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ),
            { message: `${path} overflows at ${width}` },
          )
          .toBe(true);
      }
    }
  });
}

test("the open contact dialog passes axe", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await hydrated(page);
  await page
    .locator("#top")
    .getByRole("button", { name: en.zine.write })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const scan = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    scan.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => v.id),
  ).toEqual([]);
});

test("server-rendered content remains readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.addCookies([{ name: "og_gate", value: "1", url: BASE }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const battle = page.locator("#projects .project img").first();
  await battle.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      battle.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0),
    )
    .toBe(true);
  for (const step of en.process.steps)
    await expect(
      page.locator("#process .pj-title", { hasText: step.title }),
    ).toBeAttached();
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await expect(page.locator("#faq .letter-a").first()).toBeVisible();
  await page.locator("#contact").scrollIntoViewIfNeeded();
  await expect(
    page.locator('#contact a[href^="mailto:"]').first(),
  ).toBeVisible();
  await page.goto(`${BASE}/stack`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator("#ai").scrollIntoViewIfNeeded();
  await expect(page.locator("#ai h2")).toBeVisible();
  await context.close();
});

// ─── Headers, probes, metadata ───────────────────────────────

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
  for (const path of ["/stack", "/privacy"])
    expect(
      (await request.get(path)).headers()["content-security-policy"],
    ).toMatch(/'nonce-[^']+'/);

  const errors = await collectErrors(page);
  await page.goto("/");
  // Next.js stamps the nonce on every inline script it renders.
  const inline = await page
    .locator("script:not([src])")
    .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).nonce));
  expect(inline.length).toBeGreaterThan(0);
  expect(inline.every(Boolean)).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});

test("the cover and the screenshots are served as WebP even to browsers that accept AVIF", async ({
  page,
  request,
}) => {
  // AVIF encoding of the widest images pushed the server past its memory
  // limit in production; WebP is all the site serves.
  await page.goto("/");
  for (const image of [
    page.locator("#top .cover-art img"),
    page.locator("#projects .project img").first(),
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

test("SEO metadata, social image, sitemap, robots and the noindex kit specimen", async ({
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
    en.meta.description,
  );
  const og = await request.get("/og");
  expect(og.headers()["content-type"]).toContain("image/png");
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const urls = await sitemap.text();
  for (const url of [
    "https://outegro.dev/",
    "https://outegro.dev/stack",
    "https://outegro.dev/privacy",
  ])
    expect(urls).toContain(url);
  const robots = await (await request.get("/robots.txt")).text();
  for (const path of ["/design-system", "/auth/", "/api/"])
    expect(robots).toContain(`Disallow: ${path}`);
  await page.goto("/design-system");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Kit specimen",
  );
});

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 720 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  for (const [path, locale] of [
    ["/", "en"],
    ["/", "ru"],
    ["/stack", "en"],
    ["/stack", "ru"],
  ] as const) {
    test(`${device} ${path} (${locale}): first load does not shift the layout (CLS < 0.02, cache disabled)`, async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== "chromium",
        "Layout-shift entries and network emulation are Chromium APIs.",
      );
      // The zine faces arrive after the first paint, so the covers are first
      // set in their metric-matched local fallbacks (zine.css, per script)
      // and the swap moves next to nothing: CLS under 0.002 on 11 October
      // 2026, against 0.03 to 0.24 when the swap re-wrapped the headlines.
      test.setTimeout(90_000);
      await useLocale(page.context(), locale);
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

test("reading down the issue shifts nothing once the fonts are in", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Layout-shift entries are a Chromium API.",
  );
  test.setTimeout(90_000);
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
  await hydrated(page);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    (window as unknown as { __cls: number }).__cls = 0;
  });
  // Lazy screenshots, stickers and the pieces that arm below the fold.
  for (const shot of await page.locator("#projects .project img").all())
    await expectLoaded(shot);
  for (const id of SECTIONS.slice(2))
    await page
      .locator(`#${id}`)
      .evaluate((el) =>
        el.scrollIntoView({ block: "start", behavior: "instant" }),
      );
  await page.waitForLoadState("networkidle");
  const cls = await page.evaluate(
    () => (window as unknown as { __cls: number }).__cls,
  );
  expect(cls).toBeLessThan(0.02);
});
