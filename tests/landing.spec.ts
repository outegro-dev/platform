import type { Locator, Page } from "@playwright/test";
import { menu, trumpDeck } from "../apps/landing-web/src/lib/stack";
import {
  centre,
  contrastOnPaper,
  expect,
  expectNewTab,
  hrefs,
  hydrated,
  type Locale,
  literally,
  locales,
  messages,
  overflow,
  readAndReturn,
  readerCookies,
  scrollThrough,
  seriousViolations,
  settle,
  still,
  test,
  watch,
} from "./support";

/*
 * The landing as an old popular-science magazine: the cover with its
 * headline and the torn strip of the work's steps, the issue (the
 * contents, the Battleship report, a friends' questionnaire inside the
 * cover), the old desktop with what I can build and the whole stack, the
 * process as a paper game, the coupon and the contacts; then /stack,
 * /privacy and what browsers and crawlers ask the server for.
 *
 * Copy comes from the site's own messages, so both languages are checked
 * against what the pages are meant to say. Elements are found by role, id
 * and href, never by the layout, and nothing counts on how long an
 * animation takes: on wide screens with motion the issue and the desktop
 * are scroll stages that move their anchors about, so checks that need the
 * page to sit still ask for reduced motion, where everything lies in its
 * place.
 */

const CALENDLY = "https://calendly.com/nick-lukashik/30min";
const TELEGRAM = "https://t.me/coping_barrel";
const EMAIL = "coping.barrel@gmail.com";
const LINKEDIN = "https://www.linkedin.com/in/nick-lukashick/";
const GITHUB = "https://github.com/coping-barrel";
const GAME = "https://battleship.outegro.dev";
const ACCOUNT = "https://id.outegro.dev";
/**
 * The page's anchors: the cover, the issue's top, the report, the desktop,
 * the process, the contacts.
 */
const ANCHORS = ["top", "about", "projects", "services", "process", "contact"];
const desktop = { width: 1440, height: 900 };
const phone = { width: 375, height: 812 };

type Messages = (typeof messages)[Locale];

/** The headline as assistive tech reads it: the lead, then the cut-out end. */
const headline = (t: Messages) =>
  new RegExp(
    `^${literally(t.zine.headlineLead).source}\\s*${literally(t.zine.headlineCut).source}$`,
  );

/** The name of a heading set in two parts, as aria-labelledby reads it. */
const twoPart = (title: string, accent: string) => `${title} ${accent}`;

/**
 * Adds up, from the first paint on, the layout shifts no input caused
 * (Chromium's layout-shift entries); returns a reading of the sum.
 */
async function layoutShift(page: Page) {
  await page.addInitScript(() => {
    const total = { value: 0 };
    Object.defineProperty(window, "layoutShift", { value: total });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[])
        if (!entry.hadRecentInput) total.value += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { layoutShift: { value: number } }).layoutShift
          .value,
    );
}

/**
 * Text, controls and pictures the reader is given but cannot see: laid out,
 * outside the decorative layers, yet faded to nothing or hidden.
 */
function unseen(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "main :is(h1, h2, h3, h4, p, li, dt, dd, a, button, img[alt]:not([alt='']))",
      ),
    ]
      .filter((el) => {
        if (el.closest('[aria-hidden="true"]')) return false;
        const box = el.getBoundingClientRect();
        if (!box.width || !box.height) return false;
        let opacity = 1;
        for (let up: Element | null = el; up; up = up.parentElement)
          opacity *= Number(getComputedStyle(up).opacity);
        return opacity < 0.1 || getComputedStyle(el).visibility === "hidden";
      })
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} ${(el.textContent || el.getAttribute("alt") || "").trim().slice(0, 40)}`,
      ),
  );
}

/** The animations under way that never end, by name. */
function looping(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (a) =>
          a.playState === "running" &&
          a.effect?.getComputedTiming().iterations === Infinity,
      )
      .map((a) => (a as CSSAnimation).animationName),
  );
}

/**
 * Text, controls and pictures on screen that reach past a side of the
 * viewport outside any box of their own that clips or scrolls: html and
 * body clip the page sideways (so it never scrolls), and what pokes out is
 * simply cut off. The decorative layers (aria-hidden) may bleed.
 */
function cutAtTheSides(page: Page) {
  return page.evaluate(() => {
    const cut: [string, string][] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if (box.bottom <= 0 || box.top >= innerHeight) continue;
      if (box.left >= -1 && box.right <= innerWidth + 1) continue;
      if (el.closest('[aria-hidden="true"], [inert], svg, canvas')) continue;
      const own =
        el.matches("a, button, input, img[alt]:not([alt=''])") ||
        [...el.childNodes].some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
      if (!own || getComputedStyle(el).visibility === "hidden") continue;
      let opacity = 1;
      let clipped = false;
      for (let up: Element | null = el; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        opacity *= Number(style.opacity);
        if (
          up !== el &&
          up !== document.body &&
          up !== document.documentElement &&
          style.overflowX !== "visible"
        )
          clipped = true;
      }
      if (clipped || opacity < 0.1) continue;
      const name = `${el.tagName.toLowerCase()}${el.classList[0] ? `.${el.classList[0]}` : ""}`;
      const text = (el.textContent || el.getAttribute("alt") || "").trim();
      cut.push([
        `${name} "${text.slice(0, 32)}"`,
        `[${Math.round(box.left)}…${Math.round(box.right)}] of ${innerWidth}`,
      ]);
    }
    return cut;
  });
}

// ─── Each language ───────────────────────────────────────────

for (const lang of locales) {
  const t = messages[lang];

  test.describe(lang, () => {
    test.use({ lang });

    test("the cover: language, title, the one headline and the ways on", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page).toHaveTitle(t.meta.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        t.meta.description,
      );
      await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
        "content",
        lang === "ru" ? "ru_RU" : "en_US",
      );
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveAccessibleName(headline(t));

      const cover = page.locator("#top");
      await expect(
        cover.getByRole("img", { name: t.zine.coverAlt }),
      ).toBeVisible();
      for (const line of t.zine.lede) await expect(cover).toContainText(line);
      for (const step of t.zine.band.steps)
        await expect(cover).toContainText(step);
      // the way into the issue: an anchor further down the page
      const explore = cover.getByRole("link", { name: t.zine.explore });
      await expect(explore).toHaveAttribute("href", /^#\w/);
      await expect(
        page.locator((await explore.getAttribute("href")) ?? ""),
      ).toHaveCount(1);
      const discuss = cover.getByRole("link", { name: t.zine.discuss });
      await expect(discuss).toHaveAttribute("href", TELEGRAM);
      await expectNewTab(discuss);
    });

    test("the contents list the issue, each line to its anchor", async ({
      page,
    }) => {
      await page.goto("/");
      // the first frame lays out the cover alone: the issue comes in after
      const toc = page.getByRole("navigation", { name: t.zine.tocTitle });
      await expect
        .poll(() => hrefs(toc.getByRole("link")))
        .toEqual(t.zine.toc.map((item) => item.href));
      for (const item of t.zine.toc) {
        const line = toc.getByRole("link", { name: literally(item.title) });
        await expect(line).toContainText(item.page);
        await expect(page.locator(item.href)).toHaveCount(1);
      }
    });

    test("the Battleship report: the story, the way in and the screens of this language", async ({
      page,
    }) => {
      // everything in its place: a screenshot comes in once it is near
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await hydrated(page);
      const story = page.getByRole("region", {
        name: twoPart(t.projects.title, t.projects.titleAccent),
      });
      await expect(
        story.getByRole("heading", { level: 3, name: t.projects.name }),
      ).toBeAttached();
      await expect(story).toContainText(t.projects.summary);
      for (const rule of t.projects.rules)
        await expect(story).toContainText(rule.text);
      const play = page.getByRole("link", { name: t.projects.play });
      expect(await play.count()).toBeGreaterThan(0);
      for (const link of await play.all())
        await expect(link).toHaveAttribute("href", GAME);
      for (const shot of Object.values(t.projects.shots)) {
        const image = page.getByRole("img", { name: shot.alt, exact: true });
        await expect(image).toHaveCount(1);
        await centre(image);
        await expect(image).toHaveAttribute("src", new RegExp(`-${lang}\\.`));
      }
    });

    test("the questionnaire: the photo, the name, the job and the toys on the stack", async ({
      page,
    }) => {
      const form = t.zine.form;
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 2, name: literally(form.title) }),
      ).toHaveCount(1);
      await expect(page.getByRole("img", { name: form.photo })).toHaveCount(1);
      const rows = page.locator('dl[aria-labelledby="form-title"]');
      await expect(rows.getByRole("term")).toHaveText([
        form.name.q,
        form.job.q,
        form.toys.q,
      ]);
      const answers = rows.getByRole("definition");
      await expect(answers.nth(0)).toHaveText(form.name.a);
      await expect(answers.nth(1)).toHaveText(form.job.a);
      // Frontend, then Backend: each its own link to where it runs
      const toys = answers.nth(2).getByRole("link");
      await expect(toys).toHaveText(
        form.toys.items.map((toy) => `${toy.craft} — ${toy.a}`),
      );
      for (const toy of await toys.all())
        await expect(toy).toHaveAttribute("href", /^\/stack(#[\w-]+)?$/);
    });

    test("the old desktop: Notepad says what I can build, Explorer opens the whole stack", async ({
      page,
    }) => {
      const s = t.services;
      await page.goto("/");
      const desktop = page.getByRole("region", {
        name: twoPart(s.title, s.titleAccent),
      });
      const notepad = desktop
        .getByRole("article")
        .filter({ hasText: s.desktop.notepad.app });
      await expect(notepad).toContainText(
        `${s.desktop.notepad.file} — ${s.desktop.notepad.app}`,
      );
      await expect(
        notepad.getByRole("heading", { level: 2 }),
      ).toHaveAccessibleName(twoPart(s.title, s.titleAccent));
      await expect(notepad).toContainText(s.intro);

      // Explorer: a folder for each part of the work, every dish in it
      const explorer = desktop.getByRole("article").filter({
        has: page.getByRole("heading", {
          level: 3,
          name: s.desktop.stack.title,
          exact: true,
        }),
      });
      const sections = t.stackPage.sections as Record<string, { kind: string }>;
      const names = t.stackPage.names as Record<string, string>;
      await expect(explorer.getByRole("heading", { level: 4 })).toHaveText(
        menu.map((section) => sections[section.id]?.kind ?? ""),
      );
      await expect(explorer.getByRole("listitem")).toHaveText(
        menu.flatMap((section) =>
          section.dishes.map((dish) => dish.name ?? names[dish.id] ?? ""),
        ),
      );
      await expect(
        explorer.getByRole("link", { name: s.desktop.stack.more }),
      ).toHaveAttribute("href", "/stack");

      // the shortcuts down the left
      for (const [label, href] of [
        [s.desktop.icons.battleship, GAME],
        [s.desktop.icons.account, ACCOUNT],
        [s.desktop.icons.stack, "/stack"],
      ] as const)
        await expect(
          desktop.getByRole("link", { name: label, exact: true }),
        ).toHaveAttribute("href", href);
    });

    test("the game window plays the process, every step in the markup", async ({
      page,
    }) => {
      const p = t.process;
      await page.goto("/");
      const game = page.getByRole("region", {
        name: twoPart(p.title, p.titleAccent),
      });
      await expect(game).toContainText(p.intro);
      await expect(game.getByRole("heading", { level: 3 })).toHaveText(
        p.steps.map((step) => step.title),
      );
      await expect(game).toContainText(p.ai);
    });

    test("the contacts: the coupon books the call; e-mail, Telegram, LinkedIn and GitHub sit by it", async ({
      page,
    }) => {
      // reduced motion: the coupon is cut at once, no scissors to wait for
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await hydrated(page);
      const contact = page.getByRole("region", {
        name: twoPart(t.contact.title, t.contact.titleAccent),
      });
      await expect(contact).toHaveAttribute("id", "contact");
      await expect(contact).toContainText(t.contact.description);
      await expect(contact).toContainText(t.zine.couponOffer);
      const book = contact.getByRole("link", { name: t.nav.book, exact: true });
      await expect(book).toHaveAttribute("href", CALENDLY);
      await expectNewTab(book);
      // the address is joined only in the browser (EmailLink)
      await expect(contact.locator(`a[href="mailto:${EMAIL}"]`)).toContainText(
        EMAIL,
      );
      for (const href of [CALENDLY, TELEGRAM, LINKEDIN, GITHUB]) {
        const link = contact.locator(`a[href="${href}"]`).last();
        await expect(link).toBeVisible();
        await expectNewTab(link);
      }

      const cut = contact.getByRole("button", { name: t.zine.couponCut });
      await centre(cut);
      await cut.click();
      await expect(cut).toBeDisabled();
      await expect(contact.getByRole("status")).toHaveText(t.zine.couponCut2);
    });

    test("axe finds nothing serious on the issue read to the end, at desktop and phone sizes", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      // soft: a finding at one size still lets the other be scanned
      for (const viewport of [desktop, phone]) {
        await page.setViewportSize(viewport);
        await page.goto("/");
        await hydrated(page);
        await readAndReturn(page);
        expect
          .soft(await seriousViolations(page), `at ${viewport.width}px`)
          .toEqual([]);
      }
    });

    test("/stack: the menu lists every section of the stack and the trading cards", async ({
      page,
    }) => {
      const s = t.stackPage;
      await page.goto("/stack");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page).toHaveTitle(s.meta.title);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toContainText(s.titleAccent);
      const toc = page.getByRole("navigation", { name: s.sectionsLabel });
      expect(await hrefs(toc.getByRole("link"))).toEqual(
        menu.map((section) => `#${section.id}`),
      );
      const sections = s.sections as Record<
        string,
        { title: string; kind: string }
      >;
      for (const { id } of menu)
        await expect(
          page.locator(`#${id}`).getByRole("heading", { level: 2 }),
        ).toHaveText(`${sections[id]?.title} — ${sections[id]?.kind}`);
      await expect(
        page.locator("#trumps").getByRole("heading", { level: 3 }),
      ).toHaveText(trumpDeck.map((card) => card.name));
      const book = page
        .getByRole("main")
        .getByRole("link", { name: t.nav.book, exact: true });
      await expect(book).toHaveAttribute("href", CALENDLY);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        "https://outegro.dev/stack",
      );
    });

    test("/privacy: every section of the notice, the statistics settings and the address", async ({
      page,
    }) => {
      const p = t.privacy;
      await page.goto("/privacy");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page).toHaveTitle(p.meta.title);
      await expect(
        page.getByRole("heading", { level: 1 }),
      ).toHaveAccessibleName(twoPart(p.title, p.titleAccent));
      await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        ...p.sections.map((section) => section.title),
        p.analytics.title,
        p.contact,
        // the footer's two lists
        t.footer.platform,
        t.footer.site,
      ]);
      // every cookie the site and its apps may set is named
      for (const cookie of [
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
        await expect(page.getByRole("main")).toContainText(cookie);
      await expect(page.locator("#analytics")).toContainText(p.analytics.title);
      await expect(
        page.getByRole("link", { name: EMAIL, exact: true }),
      ).toHaveAttribute("href", `mailto:${EMAIL}`);
      await expect(page.getByRole("link", { name: p.back })).toHaveAttribute(
        "href",
        "/",
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        "https://outegro.dev/privacy",
      );
    });

    test("an unknown address answers 404 with the erratum slip in this language: its own title, the ways back, kept out of search", async ({
      page,
    }) => {
      // soft: one run names everything the page misses
      test.setTimeout(60_000);
      const n = t.notFound;
      const seen = await watch(page);
      // The browser logs the page's own 404 as a failed load, in words that
      // name no address: any other failed request is listed with its own.
      const own: string[] = [];
      const failed: string[] = [];
      page.on("console", (m) => {
        const { url, lineNumber, columnNumber } = m.location();
        const load = url === page.url() && !lineNumber && !columnNumber;
        if (m.type() === "error" && load) own.push(m.text());
      });
      page.on("response", (r) => {
        if (r.status() >= 400 && !r.request().isNavigationRequest())
          failed.push(`${r.status()} ${r.url()}`);
      });
      const response = await page.goto("/no-such-page");
      expect(response?.status()).toBe(404);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      // a tab or a bookmark of it never reads as the cover
      await expect.soft(page).toHaveTitle(n.meta.title);
      const main = page.getByRole("main");
      await expect
        .soft(main.getByRole("heading", { level: 1 }))
        .toHaveAccessibleName(
          new RegExp(`^404\\s*—\\s*${literally(n.title).source}$`),
        );
      await expect.soft(main).toContainText(n.body);
      await expect
        .soft(main.getByRole("link", { name: n.home, exact: true }))
        .toHaveAttribute("href", "/");
      await expect
        .soft(main.getByRole("link", { name: n.stack, exact: true }))
        .toHaveAttribute("href", "/stack");
      expect.soft(await seriousViolations(page)).toEqual([]);
      await page.setViewportSize(phone);
      await still(page);
      expect.soft(await overflow(page), "at 375px").toBeLessThanOrEqual(0);
      await page.waitForLoadState("networkidle");
      expect.soft(failed).toEqual([]);
      expect
        .soft(seen.errors.filter((error) => !own.includes(error)))
        .toEqual([]);
      expect.soft(await seen.csp()).toEqual([]);
    });

    test("/auth/error: a failed sign-in says what went wrong in this language, with the ways back, kept out of search", async ({
      page,
    }) => {
      const a = t.auth;
      const seen = await watch(page);
      await page.goto("/auth/error?reason=state_mismatch");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page).toHaveTitle(a.meta.title);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { level: 1 }),
      ).toHaveAccessibleName(a.errorTitle);
      await expect(main).toContainText(a.reasons.state_mismatch);
      await expect(main.getByRole("link", { name: a.retry })).toHaveAttribute(
        "href",
        "/auth/sign-in?returnTo=%2F",
      );
      await expect(
        main.getByRole("link", { name: a.home, exact: true }),
      ).toHaveAttribute("href", "/");
      // a reason the page does not know reads as the general one, never as
      // the address's own words
      await page.goto("/auth/error?reason=%3Cb%3Enope%3C%2Fb%3E");
      await expect(main).toContainText(a.reasons.unknown);
      await expect(main).not.toContainText("nope");
      expect(await seriousViolations(page)).toEqual([]);
      await page.setViewportSize(phone);
      await still(page);
      expect(await overflow(page), "at 375px").toBeLessThanOrEqual(0);
      expect(seen.errors).toEqual([]);
      expect(await seen.csp()).toEqual([]);
    });

    test("the words printed on the grained paper keep their contrast, on every page at both sizes", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      // everything in its place and still
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const viewport of [desktop, phone])
        for (const path of ["/", "/stack", "/privacy", "/no-such-page"]) {
          await page.setViewportSize(viewport);
          await page.goto(path);
          if (path === "/" || path === "/stack") await hydrated(page);
          const where = `${path} at ${viewport.width}px`;
          const { failing, unmeasured } = await contrastOnPaper(page);
          expect.soft(failing, where).toEqual([]);
          expect.soft(unmeasured, where).toEqual([]);
        }
    });

    test("axe finds nothing serious on /stack and /privacy read to the end, at desktop and phone sizes", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      for (const path of ["/stack", "/privacy"])
        for (const viewport of [desktop, phone]) {
          await page.setViewportSize(viewport);
          await page.goto(path);
          // the menu's sections fade out at hydration until they scroll in
          if (path === "/stack") await hydrated(page);
          await readAndReturn(page);
          expect
            .soft(
              await seriousViolations(page),
              `${path} at ${viewport.width}px`,
            )
            .toEqual([]);
        }
    });
  });
}

// ─── Language switch ─────────────────────────────────────────

test.describe("without a language cookie", () => {
  test.use({ lang: null });

  test("English by default even for a Russian browser; the switch changes the language in place", async ({
    page,
    context,
  }) => {
    await page.setExtraHTTPHeaders({ "Accept-Language": "ru-RU,ru;q=0.9" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      headline(messages.en),
    );
    await hydrated(page);

    const to = (name: RegExp) =>
      page.getByRole("button", { name }).filter({ visible: true }).first();
    const language = async () =>
      (await context.cookies()).find((c) => c.name === "og_locale")?.value;
    await to(/Русский/).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      headline(messages.ru),
    );
    await expect(page).toHaveTitle(messages.ru.meta.title);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await language()).toBe("ru");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await hydrated(page);
    await to(/English/).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await language()).toBe("en");
  });
});

test("/ru is not a route: the language is never in the URL", async ({
  request,
}) => {
  expect((await request.get("/ru")).status()).toBe(404);
});

// ─── Anchors and navigation ──────────────────────────────────

for (const [device, viewport] of [
  ["desktop", desktop],
  ["phone", phone],
] as const) {
  test(`${device}: every anchor is on the page once and every in-page link lands on one`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await hydrated(page);
    for (const id of ANCHORS)
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    // wide, the issue takes off before the read: its stage plays too
    if (device === "desktop")
      await expect(page.locator("#about")).toHaveAttribute("data-flight", "");
    // the scroll stages move ids about as they play: never off the page or
    // onto a second element, anywhere down
    const misplaced = new Map<string, string>();
    await scrollThrough(page, async (y) => {
      for (const miss of await page.evaluate((anchors) => {
        const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
        return [
          ...anchors
            .filter((id) => !ids.includes(id))
            .map((id) => `#${id} gone`),
          ...ids
            .filter((id, i) => ids.indexOf(id) !== i)
            .map((id) => `#${id} twice`),
        ];
      }, ANCHORS))
        if (!misplaced.has(miss)) misplaced.set(miss, `${miss} at ${y}px`);
    });
    expect([...misplaced.values()]).toEqual([]);
    const targets = new Set(await hrefs(page.locator('a[href^="#"]')));
    for (const href of targets)
      await expect(page.locator(href ?? ""), `${href}`).toHaveCount(1);
  });
}

test("desktop: the issue's book, flown and gone up off the screen, is only not painted: a screen reader finds its headings and links anywhere down", async ({
  page,
}) => {
  // Wide, with motion, the book is fixed over the page and placed on every
  // scroll frame. A reader of the desktop, the process or the contacts
  // still finds the report and the contents in the lists of headings and
  // links, and reads back up into them.
  await page.setViewportSize(desktop);
  await page.goto("/");
  await hydrated(page);
  const issue = page.locator("#about");
  await expect(issue).toHaveAttribute("data-flight", "");
  // what assistive tech has of the issue: each heading and link, by its tag
  // and words
  const read = async () =>
    (
      await Promise.all(
        (["heading", "link"] as const).map((role) =>
          issue
            .getByRole(role)
            .evaluateAll((els) =>
              els.map((el) => `${el.localName} ${el.textContent?.trim()}`),
            ),
        ),
      )
    ).flat();
  const all = await read();
  for (const tag of [/^h\d /, /^a /])
    expect(
      all.some((name) => tag.test(name)),
      `${tag}`,
    ).toBe(true);
  const missing = new Map<string, string>();
  await scrollThrough(page, async (y) => {
    const now = await read();
    for (const name of all.filter((name) => !now.includes(name)))
      if (!missing.has(name)) missing.set(name, `${name}: gone at ${y}px`);
  });
  expect([...missing.values()]).toEqual([]);
});

test("header: the name leads to the top, the masthead links land, the call is booked in Calendly", async ({
  page,
}) => {
  // instant jumps: a smooth scroll is still moving when the check runs
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(desktop);
  await page.goto("/");
  await hydrated(page);
  const header = page.getByRole("banner");
  const name = header.getByRole("link", { name: /Nick Lukashik/ });
  await expect(name).toHaveAttribute("href", "#top");
  const nav = header.getByRole("navigation", {
    name: messages.en.nav.sections,
  });
  const links = await hrefs(nav.getByRole("link"));
  expect(links).toContain("#projects");
  for (const href of links)
    await expect(page.locator(href ?? ""), `${href}`).toHaveCount(1);
  const book = header.locator(`a[href="${CALENDLY}"]`);
  await expect(book).toBeVisible();
  await expectNewTab(book);

  const last = links.at(-1) ?? "";
  await nav.locator(`a[href="${last}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${last}$`));
  await expect(page.locator(last)).toBeInViewport();

  // on the other pages the same links lead back to the main page
  await page.goto("/stack");
  await expect(name).toHaveAttribute("href", "/");
  expect(await hrefs(nav.getByRole("link"))).toEqual(
    links.map((href) => `/${href}`),
  );
});

test("keyboard: the skip link comes first and skips the masthead, which follows in order into the cover", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Safari only tabs to links with Option+Tab by default.",
  );
  const t = messages.en;
  await page.setViewportSize(desktop);
  await page.goto("/");
  await hydrated(page);
  const header = page.getByRole("banner");
  const skip = page.getByRole("link", { name: t.nav.skip });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  // the menu button waits for narrow screens: the call leads into the cover
  for (const next of [
    header.getByRole("link", { name: /Nick Lukashik/ }),
    header.getByRole("link", { name: t.nav.projects }),
    header.getByRole("link", { name: t.nav.process }),
    header.getByRole("button", { name: /English/ }),
    header.getByRole("button", { name: /Русский/ }),
    header.getByRole("link", { name: t.nav.talk }),
    page.locator("#top").getByRole("link", { name: t.zine.explore }),
  ]) {
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
  }

  // followed, the skip link starts the next Tab in the content
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await page.keyboard.press("Tab");
  expect(
    await page
      .getByRole("main")
      .evaluate((main) => main.contains(document.activeElement)),
  ).toBe(true);
});

/**
 * Where the keyboard stands, null on the page itself: what is focused,
 * whether it lies on screen, whether a click at its middle reaches it (no
 * masthead or layer over it) and whether focus draws a ring the element
 * lacks otherwise (an outline or a shadow). Read once the Tab has been
 * painted, as the reader sees it.
 */
async function focusStop(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1),
      Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1),
    );
    const ring = () => {
      const style = getComputedStyle(el);
      return {
        drawn:
          (style.outlineStyle !== "none" &&
            Number.parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== "none",
        look: `${style.outline} ${style.outlineOffset} ${style.boxShadow}`,
      };
    };
    // the element unfocused for a moment, with no transition to start
    const focused = ring();
    const transition = el.style.transition;
    el.style.transition = "none";
    el.blur();
    const blurred = ring();
    el.focus({ preventScroll: true });
    ring();
    el.style.transition = transition;
    const name = el.getAttribute("aria-label") ?? el.textContent ?? "";
    return {
      name: `${el.tagName.toLowerCase()} "${name.trim().replace(/\s+/g, " ").slice(0, 40)}"`,
      onScreen:
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.top < innerHeight &&
        box.right > 0 &&
        box.left < innerWidth,
      reachable:
        !!hit &&
        (el.contains(hit) || (hit.contains(el) && hit !== document.body)),
      ringed: focused.drawn && focused.look !== blurred.look,
    };
  });
}

test("keyboard: every stop on every page shows its ring on screen with nothing over it, at desktop and phone sizes", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Safari only tabs to links with Option+Tab by default.",
  );
  test.setTimeout(90_000);
  // focus brings each stop into view at once, no smooth scroll to wait for
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [desktop, phone])
    for (const path of ["/", "/stack", "/privacy", "/no-such-page"]) {
      const where = `${path} at ${viewport.width}px`;
      await page.setViewportSize(viewport);
      await page.goto(path);
      if (path === "/" || path === "/stack") await hydrated(page);
      const stops: string[] = [];
      const missing: string[] = [];
      // past the last stop focus leaves the page or comes round to the first
      for (;;) {
        await page.keyboard.press("Tab");
        const stop = await focusStop(page);
        if (!stop || stop.name === stops[0] || stops.length > 150) break;
        stops.push(stop.name);
        const misses = [
          !stop.ringed && "no ring",
          !stop.onScreen && "off screen",
          !stop.reachable && "covered",
        ].filter(Boolean);
        if (misses.length) missing.push(`${stop.name}: ${misses.join(", ")}`);
      }
      expect(stops.length, where).toBeGreaterThan(10);
      expect.soft(missing, where).toEqual([]);
    }
});

test("header: tucked away while reading down, back on the slightest scroll up", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(desktop);
  await page.goto("/");
  await hydrated(page);
  const header = page.getByRole("banner");
  const name = header.getByRole("link", { name: /Nick Lukashik/ });
  await expect(header).not.toHaveAttribute("data-hidden");
  await page.evaluate(() =>
    window.scrollTo({ top: 2400, behavior: "instant" }),
  );
  await expect(header).toHaveAttribute("data-hidden");
  await expect(name).not.toBeInViewport();
  await page.evaluate(() =>
    window.scrollBy({ top: -300, behavior: "instant" }),
  );
  await expect(header).not.toHaveAttribute("data-hidden");
  await expect(name).toBeInViewport();
});

test("phone menu: the sections and the call, Esc back to its square, and it closes after a jump", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(phone);
  await page.goto("/");
  await hydrated(page);
  // the open dialog hides the rest of the page from assistive tech
  const square = page.getByRole("button", {
    name: messages.en.nav.menu,
    includeHidden: true,
  });
  await square.click();
  // the dialog's code comes once the menu is asked for, so it opens a
  // moment after the press
  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();
  await expect(square).toHaveAttribute("aria-expanded", "true");
  const nav = menu.getByRole("navigation", { name: messages.en.nav.sections });
  const links = (await hrefs(nav.getByRole("link"))).filter((href) =>
    href?.startsWith("#"),
  );
  expect(links).toContain("#projects");
  for (const href of links)
    await expect(page.locator(href ?? ""), `${href}`).toHaveCount(1);
  const book = menu.locator(`a[href="${CALENDLY}"]`);
  await expect(book).toBeVisible();
  await expectNewTab(book);

  // Esc gives the focus back to the square; opened from the keyboard, the
  // menu starts on its first section
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(square).toBeFocused();
  await expect(square).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("link").first()).toBeFocused();

  const last = links.at(-1) ?? "";
  await nav.locator(`a[href="${last}"]`).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(last)).toBeInViewport();
});

/**
 * Where the page went instead, if the element with this id leaves the
 * screen within `ms`; null if it stays. Read every frame and found by id
 * each time, as the stages move their anchors about.
 */
function wandersOff(page: Page, id: string, ms: number) {
  return page.evaluate(
    ([id, ms]) =>
      new Promise<string | null>((done) => {
        const start = performance.now();
        const check = (now: number) => {
          const box = document.getElementById(id)?.getBoundingClientRect();
          if (!box || box.bottom <= 0 || box.top >= innerHeight)
            done(
              `#${id} left the screen ${Math.round(now - start)} ms on, at ${Math.round(scrollY)}px`,
            );
          else if (now - start >= ms) done(null);
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
    [id, ms] as const,
  );
}

for (const [way, from, href, links] of [
  // scrolled to the issue, the book lies open on its contents
  [
    "the contents",
    "#about",
    "#contact",
    (page: Page) =>
      page.getByRole("navigation", { name: messages.en.zine.tocTitle }),
  ],
  [
    "the masthead",
    "#top",
    "#process",
    (page: Page) =>
      page
        .getByRole("banner")
        .getByRole("navigation", { name: messages.en.nav.sections }),
  ],
] as const)
  test(`desktop: a jump from ${way} to ${href} past the stages lands there and stays`, async ({
    page,
  }) => {
    // Motion on: the jump passes the issue's broken page and the desktop.
    // It is taken as soon as the page is hydrated, so the issue may take
    // off on the way, and nothing the stages play meanwhile (the 504 joke
    // glides the page on to the desktop once it has played) may take the
    // reader anywhere else.
    test.setTimeout(60_000);
    await page.setViewportSize(desktop);
    await page.goto("/");
    await hydrated(page);
    await page
      .locator(from)
      .evaluate((el) => el.scrollIntoView({ behavior: "instant" }));
    await links(page).locator(`a[href="${href}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator(href), "where the jump lands").toBeInViewport();
    expect(await wandersOff(page, href.slice(1), 8_000)).toBeNull();
  });

/**
 * Each time from here on the focus falls to the page itself, looked at
 * every frame and after each focus taken away with nowhere to go (so a
 * drop is seen even if put right before the next frame): where the page
 * stood and how far the 504 joke had played (again as the joke plays on
 * meanwhile); read back with the function returned.
 */
async function focusDrops(page: Page) {
  await page.evaluate(() => {
    const drops: string[] = [];
    Object.defineProperty(window, "focusDrops", { value: drops });
    // the joke as it stood when last seen with the focus lost
    let lost: string | null = null;
    const look = () => {
      const focus = document.activeElement;
      const joke = document.querySelector("[data-phase]");
      const phase = joke?.getAttribute("data-phase") ?? "";
      if (focus && focus !== document.body) lost = null;
      else if (lost !== phase) {
        lost = phase;
        drops.push(`at ${Math.round(scrollY)}px, the joke ${phase}`);
      }
    };
    const everyFrame = () => {
      look();
      requestAnimationFrame(everyFrame);
    };
    requestAnimationFrame(everyFrame);
    document.addEventListener("focusout", (event) => {
      if (!event.relatedTarget) setTimeout(look);
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { focusDrops: string[] }).focusDrops,
    );
}

/**
 * Scrolls `step` px at a time, each step given two frames for the stages to
 * place themselves, until something matches `selector`; given an event's
 * name, until that event has reached what it matches.
 */
function scrollTill(
  page: Page,
  step: number,
  selector: string,
  event?: string,
) {
  return page.evaluate(
    ([step, selector, event]) =>
      new Promise<void>((done, fail) => {
        let heard = false;
        if (event)
          document.querySelector(selector)?.addEventListener(
            event,
            () => {
              heard = true;
            },
            { once: true },
          );
        let left = 500;
        const next = () => {
          if (event ? heard : document.querySelector(selector)) done();
          else if (!left--)
            fail(
              new Error(
                `Scrolled on, never to ${event ? `${event} on ` : ""}${selector}`,
              ),
            );
          else {
            window.scrollBy({ top: step, behavior: "instant" });
            requestAnimationFrame(() => requestAnimationFrame(next));
          }
        };
        next();
      }),
    [step, selector, event] as const,
  );
}

/**
 * What the 504 card went on to within `ms`, read every frame, if it left
 * its failed state; null while it still waits on its door.
 */
function pressedWithin(page: Page, ms: number) {
  return page.evaluate(
    (ms) =>
      new Promise<string | null>((done) => {
        const start = performance.now();
        const check = (now: number) => {
          const phase = document
            .querySelector("[data-phase]")
            ?.getAttribute("data-phase");
          if (phase !== "failed")
            done(`${phase ?? "no card"} ${Math.round(now - start)} ms on`);
          else if (now - start >= ms) done(null);
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
    ms,
  );
}

/** Whether the focus is on what `locator` finds or somewhere inside it. */
function holdsFocus(locator: Locator) {
  return locator.evaluate((el) => el.contains(document.activeElement));
}

/** Until the page sits still: a smooth scroll under way has come to rest. */
async function scrolledStill(page: Page) {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => scrollY);
        const still = y === last;
        last = y;
        return still;
      },
      { intervals: [300] },
    )
    .toBe(true);
}

/** The old desktop, by its name: its stage moves #services onto a mark. */
function theDesktop(page: Page) {
  const t = messages.en.services;
  return page.getByRole("region", { name: twoPart(t.title, t.titleAccent) });
}

/**
 * Wide, with motion, the issue in flight: the keyboard on the report's
 * last link, then scrolled on until the broken page is up over the issue.
 * Watches the focus from the report on.
 */
async function toTheBrokenPage(page: Page) {
  await page.setViewportSize(desktop);
  await page.goto("/");
  await hydrated(page);
  const issue = page.locator("#about");
  await expect(issue).toHaveAttribute("data-flight", "");
  // a Tab first: the stage follows only the keyboard's focus to its spread
  await page.keyboard.press("Tab");
  await issue.locator(`a[href="${GAME}"]`).last().focus();
  const drops = await focusDrops(page);
  await scrollTill(page, 30, ".issue-error[data-shown]");
  return drops;
}

/** Until the 504 card has failed and shows its door. */
const doorUp = (page: Page) =>
  expect(page.locator("[data-phase]")).toHaveAttribute("data-phase", "failed");

/** Scrolls on until the stage asks the 504 card to press its door. */
const scrollOnToThePress = (page: Page) =>
  scrollTill(page, 30, ".bonk", "bonk-retry");

// The 504 card plays over the issue's broken page: its door changes as the
// joke plays, the card goes, the broken page goes inert as it is scrolled
// off and the page glides on. The keyboard's place is kept all the while.
// Scrolled on, the stage presses the door for the reader, but not with the
// keyboard on it, nor once the keyboard comes to it: that reader presses it.
for (const [way, toTheDoor] of [
  [
    "once the card has failed",
    async (page: Page) => {
      await doorUp(page);
      await page.keyboard.press("Tab");
    },
  ],
  [
    "and scrolled on",
    async (page: Page) => {
      await doorUp(page);
      await page.keyboard.press("Tab");
      await scrollOnToThePress(page);
    },
  ],
  [
    "as it is about to be pressed for the reader scrolling on",
    async (page: Page) => {
      await scrollOnToThePress(page);
      await page.waitForFunction(
        () => document.querySelector("[data-phase] [data-pressed]"),
        null,
        { polling: "raf" },
      );
      await page.keyboard.press("Tab");
    },
  ],
] as const)
  test(`keyboard: the 504 card's door, tabbed to ${way}, waits for the reader's Enter, keeps the focus through the joke and hands it on to the desktop`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Safari only tabs to links with Option+Tab by default.",
    );
    test.setTimeout(60_000);
    const drops = await toTheBrokenPage(page);
    const joke = page.locator("[data-phase]");
    const door = page.getByRole("button", { name: messages.en.bonk.retry });
    await toTheDoor(page);
    await expect(door).toBeFocused();
    await expect(joke).toHaveAttribute("data-phase", "failed");
    // the card waits 0.7 s before it presses the door for the reader
    expect(await pressedWithin(page, 1_500)).toBeNull();
    await expect(door).not.toHaveAttribute("data-pressed");
    await page.keyboard.press("Enter");
    await expect(joke).toHaveAttribute("data-phase", "loaded", {
      timeout: 20_000,
    });
    await scrolledStill(page);
    // the page has glided on to the desktop, and so has the keyboard
    const desktopPart = theDesktop(page);
    await expect(desktopPart).toBeInViewport();
    await page.keyboard.press("Tab");
    await expect.poll(() => holdsFocus(desktopPart)).toBe(true);
    expect(await drops()).toEqual([]);
  });

for (const [when, phase] of [
  ["while the card loads", "loading"],
  ["once it has failed", "failed"],
] as const)
  test(`keyboard: Tab on past the 504 card ${when} and Shift+Tab back keep the focus in the issue`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Safari only tabs to links with Option+Tab by default.",
    );
    test.setTimeout(60_000);
    const drops = await toTheBrokenPage(page);
    const joke = page.locator("[data-phase]");
    await expect(joke).toHaveAttribute("data-phase", phase);
    // on to the desktop's first shortcut: past the door, if there is one yet
    const desktopPart = theDesktop(page);
    if (phase === "failed") await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect.poll(() => holdsFocus(desktopPart)).toBe(true);
    await expect(joke).not.toHaveAttribute("data-phase", /armed|loading/);
    // back: onto the door, or the report if the page has gone up off it
    for (let back = 0; back < 2; back++) {
      await page.keyboard.press("Shift+Tab");
      await scrolledStill(page);
      await expect.poll(() => holdsFocus(page.locator("#about"))).toBe(true);
    }
    expect(await drops()).toEqual([]);
  });

test("keyboard: scrolled back up off the 504 card, the focus on its door goes on from the report", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Safari only tabs to links with Option+Tab by default.",
  );
  test.setTimeout(60_000);
  const drops = await toTheBrokenPage(page);
  const joke = page.locator("[data-phase]");
  await expect(joke).toHaveAttribute("data-phase", "failed");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: messages.en.bonk.retry }),
  ).toBeFocused();
  // the broken page goes inert as it fades, and the joke is set again a
  // little further up, its door gone
  await scrollTill(page, -30, ".issue-error:not([data-shown])");
  await scrollTill(page, -30, '[data-phase="armed"]');
  await settle(page);
  expect(await holdsFocus(page.locator(".issue-error"))).toBe(false);
  expect(await holdsFocus(page.locator("#about"))).toBe(true);
  expect(await drops()).toEqual([]);
});

test("keyboard: the 504 joke played for a reader scrolling on from the report leaves the focus there, and the next Tab goes on to the desktop", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Safari only tabs to links with Option+Tab by default.",
  );
  test.setTimeout(60_000);
  const drops = await toTheBrokenPage(page);
  const joke = page.locator("[data-phase]");
  await scrollOnToThePress(page);
  await expect(joke).toHaveAttribute("data-phase", "loaded", {
    timeout: 20_000,
  });
  await scrolledStill(page);
  const desktopPart = theDesktop(page);
  await expect(desktopPart).toBeInViewport();
  expect(await holdsFocus(page.locator("#about"))).toBe(true);
  // on from where the reader was, to where the page now stands
  await page.keyboard.press("Tab");
  await expect.poll(() => holdsFocus(desktopPart)).toBe(true);
  await expect(desktopPart).toBeInViewport();
  expect(await drops()).toEqual([]);
});

test("the masthead on /stack leads to the main page's sections, with scripts and without", async ({
  browser,
  baseURL,
}) => {
  // The first frame lays out the cover alone (zine-page.css, first-frame),
  // and the browser looks for the address's fragment then: a section still
  // waiting under the cover is nowhere to scroll to. With scripts the page
  // goes there once it is in (RevealObserver); without, nothing looks again.
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled,
      reducedMotion: "reduce",
      viewport: desktop,
    });
    await context.addCookies(readerCookies(baseURL, "en"));
    const page = await context.newPage();
    for (const id of ["projects", "process"]) {
      await page.goto("/stack");
      await page
        .getByRole("banner")
        .getByRole("navigation", { name: messages.en.nav.sections })
        .locator(`a[href="/#${id}"]`)
        .click();
      await expect
        .soft(
          page.locator(`#${id}`),
          `#${id} ${javaScriptEnabled ? "with" : "without"} scripts`,
        )
        .toBeInViewport();
    }
    await context.close();
  }
});

test("the toys in the questionnaire lead to sections of the stack page", async ({
  page,
}) => {
  await page.goto("/");
  const links = page
    .locator('dl[aria-labelledby="form-title"]')
    .getByRole("link");
  await expect(links).toHaveCount(2);
  for (const href of await hrefs(links)) {
    await page.goto(href ?? "");
    const hash = new URL(page.url()).hash;
    if (hash)
      await expect(
        page.locator(hash).getByRole("heading", { level: 2 }),
      ).toBeVisible();
  }
});

test("the footer links the platform's sites and this site's pages on every page", async ({
  page,
}) => {
  const t = messages.en.footer;
  for (const path of ["/", "/stack", "/privacy"]) {
    await page.goto(path);
    // on the main page the footer comes in after the cover's first frame
    const footer = page.getByRole("contentinfo");
    await expect
      .poll(
        () =>
          hrefs(
            footer
              .getByRole("navigation", { name: t.platform })
              .getByRole("link"),
          ),
        path,
      )
      .toEqual([GAME, ACCOUNT, "https://pay.outegro.dev/subscriptions"]);
    expect(
      await hrefs(
        footer.getByRole("navigation", { name: t.site }).getByRole("link"),
      ),
      path,
    ).toEqual(["/stack", "/privacy", "/privacy#analytics"]);
  }
});

// ─── A clean read ────────────────────────────────────────────

for (const [device, viewport, joke] of [
  // a wide screen with motion breaks the issue and plays the 504 joke
  ["desktop", desktop, true],
  ["phone", phone, false],
] as const) {
  test(`${device}: reading the whole issue down raises no console error, no CSP violation, no failed request and shifts nothing`, async ({
    page,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(90_000);
    const seen = await watch(page);
    const shifted =
      browserName === "chromium" ? await layoutShift(page) : async () => 0;
    const failed: string[] = [];
    page.on("response", (response) => {
      if (response.url().startsWith(baseURL ?? "") && response.status() >= 400)
        failed.push(`${response.status()} ${response.url()}`);
    });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await hydrated(page);
    await scrollThrough(page);
    await expect(page.getByRole("contentinfo")).toBeInViewport();
    // the joke plays out to the end: the block "reloads" and the page
    // glides on to the desktop
    if (joke)
      await expect(page.locator("[data-phase]")).toHaveAttribute(
        "data-phase",
        "loaded",
        { timeout: 20_000 },
      );
    await page.waitForLoadState("networkidle");
    expect(seen.errors).toEqual([]);
    expect(await seen.csp()).toEqual([]);
    expect(failed).toEqual([]);
    // the stages move the book and the windows, never the layout
    expect(await shifted()).toBeLessThan(0.02);
    // the pictures the scripts add on the way have their text too
    await expect(page.locator("img:not([alt])")).toHaveCount(0);
  });
}

for (const [device, viewport] of [
  ["desktop", desktop],
  ["phone", phone],
] as const) {
  test(`${device}: the paper ride runs live on a real GPU and stays paper steps on a software one, never an empty stage`, async ({
    page,
  }) => {
    const p = messages.en.process;
    await page.setViewportSize(viewport);
    await page.goto("/");
    await hydrated(page);
    // the site's own verdict: WebGL2 not drawn by a software rasteriser
    const gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      const renderer =
        gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      return (
        !!gl &&
        !/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(
          renderer,
        )
      );
    });
    const game = page.getByRole("region", {
      name: twoPart(p.title, p.titleAccent),
    });
    await centre(game);
    // a failed scene falls back to the steps without a word in the console
    const scene = game.getByRole("img", { name: p.scene });
    if (gpu) await expect(scene.locator("canvas")).toBeVisible();
    else await expect(scene).toHaveCount(0);
    await expect(game.getByRole("heading", { level: 3 })).toHaveText(
      p.steps.map((step) => step.title),
    );
  });
}

test("/stack and /privacy load clean too, every picture with its text", async ({
  page,
}) => {
  const seen = await watch(page);
  for (const path of ["/stack", "/privacy"]) {
    await page.goto(path);
    await scrollThrough(page);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("img:not([alt])"), path).toHaveCount(0);
  }
  expect(seen.errors).toEqual([]);
  expect(await seen.csp()).toEqual([]);
});

// ─── Reduced motion and layout ───────────────────────────────

for (const [device, viewport] of [
  ["desktop", desktop],
  ["phone", phone],
] as const) {
  test(`${device}, reduced motion: a still page, every part in its place and in reading order, a clean console`, async ({
    page,
  }) => {
    const t = messages.en;
    const seen = await watch(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await hydrated(page);

    // nothing loops, nothing is drawn in WebGL, nothing waits for a scroll
    expect(await looping(page)).toEqual([]);
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await unseen(page)).toEqual([]);

    // no scroll stage: each anchor is its own section, with its heading
    const parts = [
      ["#top", t.zine.headlineLead],
      ["#projects", t.projects.title],
      ["#services", t.services.title],
      ["#process", t.process.title],
      ["#contact", t.contact.title],
    ] as const;
    const tops: number[] = [];
    for (const [id, title] of parts) {
      const part = page.locator(id);
      await expect(
        part.getByRole("heading", { name: literally(title) }),
      ).toBeVisible();
      tops.push(await part.evaluate((el) => el.getBoundingClientRect().top));
    }
    expect(tops).toEqual([...tops].sort((a, b) => a - b));

    // the spreads lie open: the contents, the questionnaire, the report
    await expect(
      page.getByRole("navigation", { name: t.zine.tocTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: t.zine.form.photo }),
    ).toBeVisible();
    for (const shot of Object.values(t.projects.shots))
      await expect(page.getByRole("img", { name: shot.alt })).toBeVisible();
    await expect(
      page
        .getByRole("region", {
          name: twoPart(t.process.title, t.process.titleAccent),
        })
        .getByRole("heading", { level: 3 }),
    ).toHaveCount(t.process.steps.length);

    await scrollThrough(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await seriousViolations(page)).toEqual([]);
    // the posters that stand in for the stages load as cleanly
    await page.waitForLoadState("networkidle");
    expect(seen.errors).toEqual([]);
    expect(await seen.csp()).toEqual([]);
  });
}

test("reduced motion: /stack, /privacy and the 404 slip keep still too, every word shown up front", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [desktop, phone]) {
    await page.setViewportSize(viewport);
    for (const path of ["/stack", "/privacy", "/no-such-page"]) {
      const where = `${path} at ${viewport.width}px`;
      await page.goto(path);
      if (path === "/stack") await hydrated(page);
      expect(await looping(page), where).toEqual([]);
      expect(await unseen(page), where).toEqual([]);
      await expect(page.locator("canvas"), where).toHaveCount(0);
    }
  }
});

for (const lang of locales)
  test.describe(lang, () => {
    test.use({ lang });

    for (const width of [320, 375, 768, 1024, 1280, 1440, 1920])
      test(`${width}px: no page scrolls sideways or cuts anything off at the sides, anywhere down`, async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
        for (const path of ["/", "/stack", "/privacy", "/no-such-page"]) {
          await page.goto(path);
          if (path === "/" || path === "/stack") await hydrated(page);
          // the entrances (a block may come in askew from a side) have
          // played; then a screen at a time from the cover to the footer,
          // through every stage
          await readAndReturn(page);
          const cut = new Map<string, string>();
          for (let y = 0, end = false; !end; ) {
            await page.evaluate(
              (top) => window.scrollTo({ top, behavior: "instant" }),
              y,
            );
            await still(page);
            expect(
              await overflow(page),
              `${path} at ${y}px`,
            ).toBeLessThanOrEqual(0);
            for (const [what, sides] of await cutAtTheSides(page))
              if (!cut.has(what)) cut.set(what, `${what} ${sides} at ${y}px`);
            ({ y, end } = await page.evaluate(() => ({
              y: scrollY + innerHeight,
              end:
                scrollY + innerHeight >=
                document.documentElement.scrollHeight - 2,
            })));
          }
          expect.soft([...cut.values()], path).toEqual([]);
        }
      });
  });

// ─── Fonts and the first paint ───────────────────────────────

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 720 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  for (const [path, lang] of [
    ["/", "en"],
    ["/", "ru"],
    ["/stack", "en"],
    ["/privacy", "en"],
  ] as const) {
    test.describe(lang, () => {
      test.use({ lang });

      test(`${device} ${path}: the first load on a slow network shifts nothing (CLS < 0.02, cache off)`, async ({
        page,
        browserName,
      }) => {
        test.skip(
          browserName !== "chromium",
          "Layout-shift entries and network emulation are Chromium APIs.",
        );
        // The faces arrive after the first paint, so the page is first set
        // in their metric-matched local fallbacks (zine.css, per script)
        // and the swap moves next to nothing.
        test.setTimeout(90_000);
        await page.setViewportSize(viewport);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        // Chrome's "Slow 4G"
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 150,
          downloadThroughput: (1.6 * 1024 * 1024) / 8,
          uploadThroughput: (750 * 1024) / 8,
        });
        const shifted = await layoutShift(page);
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        expect(await shifted()).toBeLessThan(0.02);
      });
    });
  }
}

// The kit's own faces: Manrope, Cormorant Garamond, JetBrains Mono.
const KIT_FACES = /manrope|cormorant|jetbrains/i;

test("the issue preloads none of the kit's faces; they come only with the kit specimen's calm islands", async ({
  page,
  request,
}) => {
  // The issue recasts the kit's sans, display and mono tokens to the zine
  // faces; the kit's own (preloaded, ~110 KB) would hold back the cover's
  // LCP for text no page of the issue sets.
  for (const path of ["/", "/stack", "/privacy"]) {
    const response = await request.get(path);
    const links = `${response.headers().link ?? ""}\n${(await response.text())
      .match(/<link[^>]*>/g)
      ?.join("\n")}`;
    expect(links, path).not.toMatch(KIT_FACES);
  }
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const declared = await page.evaluate(() =>
    [...document.fonts].map((face) => face.family),
  );
  expect(declared.filter((family) => KIT_FACES.test(family))).toEqual([]);

  // the specimen's calm islands read in Manrope, preloaded there
  const specimen = await request.get("/design-system");
  expect(specimen.headers().link ?? "").toMatch(
    /<[^>]*manrope[^>]*>;[^,]*as="?font/i,
  );
});

test("the /privacy heading breaks into the same lines in its fallback and its face, at any width", async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Checked where the first-load CLS is measured.",
  );
  test.skip(
    process.platform === "linux",
    "The tabloid fallback is local Georgia, which Linux lacks.",
  );
  // The accent's size follows the viewport and its column stops at 820 px;
  // without a measure of its own it came within 1% of the column at 1280 px,
  // where the fallback kept one line and the face (~1.5% wider) wrapped it
  // on arrival: CLS 0.0187.
  for (const lang of locales) {
    await context.addCookies(readerCookies(baseURL, lang));
    await page.goto("/privacy");
    await page.evaluate(() => document.fonts.ready);
    const accent = page
      .getByRole("heading", { level: 1 })
      .locator(".og-accent");
    for (const width of [
      360, 390, 430, 480, 520, 768, 1024, 1180, 1280, 1366, 1440, 1920,
    ]) {
      await page.setViewportSize({ width, height: 900 });
      const lines = await accent.evaluate(async (el: HTMLElement) => {
        const count = () =>
          Math.round(
            el.getBoundingClientRect().height /
              Number.parseFloat(getComputedStyle(el).fontSize),
          );
        const face = count();
        // the token without the faces: the metric-matched fallback onwards
        const family = getComputedStyle(el).fontFamily.split(",");
        el.style.fontFamily = family
          .slice(family.findIndex((name) => /fallback/i.test(name)))
          .join(",");
        count(); // lays it out, so a fallback not used yet starts loading
        await document.fonts.ready;
        const fallback = count();
        el.style.fontFamily = "";
        return { face, fallback };
      });
      expect(lines.face, `${lang} at ${width}px`).toBe(lines.fallback);
    }
  }
});

for (const lang of locales)
  test.describe(lang, () => {
    test("without JavaScript the server HTML carries the whole issue, every page shown in full at both sizes", async ({
      browser,
      baseURL,
    }) => {
      test.setTimeout(90_000);
      const t = messages[lang];
      const context = await browser.newContext({
        baseURL,
        javaScriptEnabled: false,
      });
      await context.addCookies(readerCookies(baseURL, lang));
      const page = await context.newPage();
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1 }),
      ).toHaveAccessibleName(headline(t));
      await expect(
        page
          .getByRole("navigation", { name: t.zine.tocTitle })
          .getByRole("link"),
      ).toHaveCount(t.zine.toc.length);
      for (const title of [
        twoPart(t.projects.title, t.projects.titleAccent),
        twoPart(t.services.title, t.services.titleAccent),
        twoPart(t.process.title, t.process.titleAccent),
        twoPart(t.contact.title, t.contact.titleAccent),
      ])
        await expect(
          page.getByRole("heading", { level: 2, name: title }),
        ).toBeVisible();
      await expect(
        page
          .locator('dl[aria-labelledby="form-title"]')
          .getByRole("definition"),
      ).toContainText([t.zine.form.name.a, t.zine.form.job.a]);
      for (const step of t.process.steps)
        await expect(
          page.getByRole("heading", { level: 3, name: step.title }),
        ).toBeAttached();
      const contact = page.locator("#contact");
      await expect(contact.locator(`a[href="${TELEGRAM}"]`)).toBeVisible();
      await expect(
        contact.locator(`a[href="${CALENDLY}"]`).first(),
      ).toBeVisible();
      // the address is readable; its mailto link comes with hydration, so
      // Cloudflare never finds a whole address in the server HTML (EmailLink)
      await expect(contact).toContainText(EMAIL);
      await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);

      await page.goto("/stack");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        t.stackPage.titleAccent,
      );

      // nothing waits for a script to be shown or to fit, on any page or size
      for (const viewport of [desktop, phone]) {
        await page.setViewportSize(viewport);
        for (const path of ["/", "/stack", "/privacy", "/no-such-page"]) {
          await page.goto(path);
          const where = `${path} at ${viewport.width}px`;
          await expect.poll(() => unseen(page), where).toEqual([]);
          expect(await overflow(page), where).toBeLessThanOrEqual(0);
          // the browser's own lazy loading brings every picture in
          const pictures = page
            .locator("main img[alt]:not([alt=''])")
            .filter({ visible: true });
          for (const picture of await pictures.all()) {
            await picture.scrollIntoViewIfNeeded();
            await expect
              .poll(
                () =>
                  picture.evaluate(
                    (img: HTMLImageElement) =>
                      img.complete && img.naturalWidth > 0,
                  ),
                `${where}: ${await picture.getAttribute("alt")}`,
              )
              .toBe(true);
          }
        }
      }
      await context.close();
    });
  });

// ─── What the server answers ─────────────────────────────────

test("security headers: a fresh nonce per page, no eval in production, no framing, no sniffing", async ({
  request,
}) => {
  // next dev needs eval for its debugging tools; a production build never
  const dev = (await (await request.get("/")).text()).includes("hmr-client");
  // the 404 slip and the sign-in error are pages of the site too
  const paths = ["/", "/stack", "/privacy", "/no-such-page", "/auth/error"];
  const nonces = new Set<string>();
  for (const path of paths) {
    const response = await request.get(path);
    const headers = response.headers();
    const csp = headers["content-security-policy"] ?? "";
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, path).toBeTruthy();
    nonces.add(nonce ?? "");
    // the nonce is this response's own: no cache on the way may hand it on
    expect(headers["cache-control"], path).toContain("no-store");
    expect(csp, path).toMatch(
      /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
    );
    for (const directive of [
      "default-src 'none'",
      "font-src 'self'",
      "worker-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ])
      expect(csp, path).toContain(directive);
    expect(csp.includes("'unsafe-eval'"), `${path}: eval`).toBe(dev);
    // Nothing let in wholesale: no wildcard, no bare scheme but the
    // pictures' data: and blob: (and the sockets of next dev's reloads),
    // no inline script.
    const policy = csp.split(/;\s*/).map((directive) => directive.split(" "));
    const scheme = (name = "", source = "") =>
      (name === "img-src" && /^(data|blob):$/.test(source)) ||
      (dev && name === "connect-src" && /^wss?:$/.test(source));
    const wholesale = policy.flatMap(([name, ...sources]) =>
      sources
        .filter((source) => /^(\*|[a-z]+:)$/.test(source))
        .filter((source) => !scheme(name, source))
        .map((source) => `${name} ${source}`),
    );
    expect(wholesale, path).toEqual([]);
    expect(
      policy.find(([name]) => name === "script-src"),
      path,
    ).not.toContain("'unsafe-inline'");
    // upgraded only behind TLS: on plain-http localhost Safari would ask
    // for every file over https
    expect(csp, path).not.toContain("upgrade-insecure-requests");
    const tls = await request.get(path, {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(tls.headers()["content-security-policy"], path).toContain(
      "upgrade-insecure-requests",
    );
    expect(headers["strict-transport-security"], path).toMatch(
      /max-age=\d{8,}; includeSubDomains; preload/,
    );
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["cross-origin-resource-policy"], path).toBe("same-site");
    expect(headers["cross-origin-opener-policy"], path).toBe("same-origin");
    expect(headers["origin-agent-cluster"], path).toBe("?1");
    expect(headers["x-dns-prefetch-control"], path).toBe("off");
    expect(headers["x-permitted-cross-domain-policies"], path).toBe("none");
    expect(headers["referrer-policy"], path).toBe(
      "strict-origin-when-cross-origin",
    );
    for (const feature of ["camera", "microphone", "geolocation", "payment"])
      expect(headers["permissions-policy"], path).toContain(`${feature}=()`);
    expect(headers["x-powered-by"], path).toBeUndefined();
    // Next.js stamps this response's nonce on every script it renders
    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length, path).toBeGreaterThan(0);
    for (const script of scripts)
      expect(script, path).toContain(`nonce="${nonce}"`);
    // the build's files carry the static headers too
    const asset = html.match(/src="(\/_next\/static\/[^"]+)"/)?.[1] ?? "";
    const assetHeaders = (await request.get(asset)).headers();
    expect(assetHeaders["x-content-type-options"], asset).toBe("nosniff");
    expect(assetHeaders["cross-origin-resource-policy"], asset).toBe(
      "same-site",
    );
    // named by their content, so a browser keeps them for good
    if (!dev)
      expect(assetHeaders["cache-control"], asset).toBe(
        "public, max-age=31536000, immutable",
      );
  }
  expect(nonces.size).toBe(paths.length);
});

test("every page the server sends comes under the CSP: the 404 slip at any address, a page loaded ahead or posted to", async ({
  request,
}) => {
  // The proxy that sets the policy leaves out, each by its whole path, the
  // routes that answer with a file; whatever else comes back in HTML is a
  // page of the site. A scanner's /wp-login.php, a card in a language the
  // site has not, an address that only starts or ends like one of those
  // routes, a deeper path: each is the 404 slip, under the policy.
  const files = [
    "/_next/static/no-such-chunk.js",
    "/_next/image",
    "/health",
    "/health/deep",
    "/og",
    "/og/ru",
    "/icon",
    "/apple-icon",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
  ];
  // a shared link's tracking query is the same page
  const pages = [
    "/",
    "/?utm_source=telegram",
    "/stack",
    "/privacy",
    "/auth/error",
    "/design-system",
  ];
  const unknown = [
    "/no-such-page",
    "/stack/no-such-page",
    "/STACK",
    "/wp-login.php",
    "/.env",
    "/og/de",
    "/ogre",
    "/healthz",
    "/icons",
    "/_next/no-such-file",
    "/api/no-such-route",
    ...files
      .filter((path) => !path.startsWith("/_next/"))
      .flatMap((path) => [`${path}x`, `${path}/x`, `${path}.php`]),
  ];
  const html = (headers: Record<string, string>) =>
    /^text\/html/.test(headers["content-type"] ?? "");
  for (const path of files)
    expect
      .soft(html((await request.get(path)).headers()), `${path} is a file`)
      .toBe(false);

  // A page loaded ahead is the very page the reader then gets, whoever
  // says so: Chromium's speculative loads in Sec-Purpose, older browsers in
  // Purpose, the Next router in a header of its own. A form posted back is
  // answered with a page too.
  const ways = [
    ["loaded ahead", { headers: { "sec-purpose": "prefetch;prerender" } }],
    ["fetched ahead", { headers: { purpose: "prefetch" } }],
    ["prefetched by the router", { headers: { "next-router-prefetch": "1" } }],
    ["posted to", { method: "POST" }],
  ] as const;
  for (const [path, where, options] of [
    ...[...pages, ...unknown].map((path) => [path, path, {}] as const),
    ...ways.flatMap(([way, options]) =>
      ["/", "/no-such-page"].map(
        (path) => [path, `${path} ${way}`, options] as const,
      ),
    ),
  ]) {
    const response = await request.fetch(path, options);
    const found = pages.includes(path);
    expect.soft(response.status(), where).toBe(found ? 200 : 404);
    expect.soft(html(response.headers()), `${where} is a page`).toBe(true);
    const body = await response.text();
    if (!found)
      expect
        .soft(body, where)
        .toContain(`<title>${messages.en.notFound.meta.title}</title>`);
    const csp = response.headers()["content-security-policy"] ?? "";
    expect
      .soft(csp, `${where}: the CSP`)
      .toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    if (nonce)
      for (const script of body.match(/<script\b[^>]*>/g) ?? [])
        expect.soft(script, where).toContain(`nonce="${nonce}"`);
  }
});

test("every page announces the share card of its language: a 1200×630 PNG other sites may show", async ({
  page,
  context,
  baseURL,
  request,
}) => {
  // next dev redraws the cards per request; a production build caches them
  const dev = (await (await request.get("/")).text()).includes("hmr-client");
  const card = async (path: string) => {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"], path).toBe("image/png");
    // link previews and readers on other sites load it too
    expect
      .soft(headers["cross-origin-resource-policy"], path)
      .toBe("cross-origin");
    if (!dev)
      expect
        .soft(headers["cache-control"], path)
        .toMatch(/public, max-age=[1-9]/);
    const png = await response.body();
    expect(png.subarray(0, 8), path).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // the IHDR chunk: width and height, big-endian
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([
      1200, 630,
    ]);
    return png;
  };
  const pages = [
    ["/", "", (t: Messages) => t.meta.title],
    ["/stack", "/stack", (t: Messages) => t.stackPage.meta.title],
    ["/privacy", "/privacy", (t: Messages) => t.privacy.meta.title],
  ] as const;
  const cards = new Set<string>();
  for (const lang of locales) {
    const t = messages[lang];
    await context.addCookies(readerCookies(baseURL, lang));
    for (const [path, canonical, title] of pages) {
      await page.goto(path);
      const meta = (key: string) =>
        page.locator(`meta[property="${key}"], meta[name="${key}"]`);
      const url = `https://outegro.dev${canonical}`;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        url,
      );
      await expect(meta("og:url")).toHaveAttribute("content", url);
      await expect(meta("og:title")).toHaveAttribute("content", title(t));
      await expect(meta("twitter:title")).toHaveAttribute("content", title(t));
      // a share reads what a search result reads
      const description =
        (await meta("description").getAttribute("content")) ?? "";
      expect(description, path).not.toBe("");
      await expect(meta("og:description")).toHaveAttribute(
        "content",
        description,
      );
      await expect(meta("twitter:description")).toHaveAttribute(
        "content",
        description,
      );
      await expect(meta("og:type")).toHaveAttribute("content", "website");
      await expect(meta("og:site_name")).toHaveAttribute(
        "content",
        "Nick Lukashik",
      );
      await expect(meta("og:locale")).toHaveAttribute(
        "content",
        lang === "ru" ? "ru_RU" : "en_US",
      );
      // the default language's card is /og, the other's /og/<locale>
      const image = `https://outegro.dev/og${lang === "en" ? "" : `/${lang}`}`;
      await expect(meta("og:image")).toHaveAttribute("content", image);
      await expect(meta("og:image:width")).toHaveAttribute("content", "1200");
      await expect(meta("og:image:height")).toHaveAttribute("content", "630");
      await expect(meta("og:image:alt")).toHaveAttribute(
        "content",
        t.meta.imageAlt,
      );
      await expect(meta("twitter:card")).toHaveAttribute(
        "content",
        "summary_large_image",
      );
      await expect(meta("twitter:image")).toHaveAttribute("content", image);
      await expect(meta("twitter:image:alt")).toHaveAttribute(
        "content",
        t.meta.imageAlt,
      );
      cards.add(new URL(image).pathname);
    }
  }
  const drawn = new Set<string>();
  for (const path of cards) drawn.add((await card(path)).toString("base64"));
  // each language its own card, not one card under two addresses
  expect(drawn.size).toBe(cards.size);
  // the default language has no second address
  expect((await request.get("/og/en")).status()).toBe(404);
});

test("the tab and home-screen icons each page names answer, in the type and sizes named", async ({
  request,
}) => {
  // the sizes of a PNG (its IHDR chunk) or of each picture in an ICO
  const sizes = (body: Buffer, type: string) =>
    type === "image/png"
      ? [`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`]
      : Array.from({ length: body.readUInt16LE(4) }, (_, i) => {
          // a byte per side, 0 for 256
          const side = (at: number) => body[6 + 16 * i + at] || 256;
          return `${side(0)}x${side(1)}`;
        });
  const icons = new Map<string, { type: string; sizes: string }>();
  for (const path of ["/", "/stack", "/privacy", "/no-such-page"]) {
    const links =
      (await (await request.get(path)).text()).match(
        /<link rel="(icon|apple-touch-icon)"[^>]*>/g,
      ) ?? [];
    const attribute = (link: string, name: string) =>
      link.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? "";
    const rels = links.map((link) => attribute(link, "rel"));
    expect(rels, path).toContain("icon");
    expect(rels, path).toContain("apple-touch-icon");
    for (const link of links)
      icons.set(attribute(link, "href"), {
        type: attribute(link, "type"),
        sizes: attribute(link, "sizes"),
      });
  }
  // a browser asks for /favicon.ico whatever the page names
  const favicon = [...icons].find(([href]) => href.startsWith("/favicon.ico?"));
  expect(favicon, "the page names /favicon.ico").toBeDefined();
  if (favicon) icons.set("/favicon.ico", favicon[1]);
  for (const [href, named] of icons) {
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
    expect(response.headers()["content-type"], href).toBe(named.type);
    expect(sizes(await response.body(), named.type), href).toContain(
      named.sizes,
    );
  }
});

test("the cover and the screenshots come as WebP even to a browser that takes AVIF", async ({
  page,
  request,
}) => {
  // Encoding AVIF pushed the server past its memory limit in production
  // (next.config.ts): WebP is all it serves. The src is the widest variant.
  const t = messages.en;
  // everything in its place: a screenshot comes in once it is near
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await hydrated(page);
  for (const image of [
    page.locator("#top").getByRole("img", { name: t.zine.coverAlt }),
    page.getByRole("img", { name: t.projects.shots.battle.alt, exact: true }),
  ]) {
    await centre(image);
    await expect(image).toHaveAttribute("src", /^\/_next\/image\?/);
    const src = (await image.getAttribute("src")) ?? "";
    const response = await request.get(src, {
      headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    });
    expect(response.status(), src).toBe(200);
    expect(response.headers()["content-type"], src).toBe("image/webp");
  }
});

test("robots.txt and sitemap.xml: the three pages indexed, the people's routes left out", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  expect(rules).toMatch(/^User-Agent: \*$/im);
  expect(rules).toMatch(/^Allow: \/$/m);
  const disallowed = [...rules.matchAll(/^Disallow: (\S+)$/gm)].map(
    (match) => match[1] ?? "",
  );
  for (const path of ["/design-system", "/health", "/auth/", "/api/"])
    expect(disallowed).toContain(path);
  expect(rules).toContain("Sitemap: https://outegro.dev/sitemap.xml");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const urls = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1] ?? "",
  );
  expect(urls).toEqual([
    "https://outegro.dev/",
    "https://outegro.dev/stack",
    "https://outegro.dev/privacy",
  ]);
  // each page listed is open to crawlers, answers, names itself canonical
  // and asks to be indexed
  for (const url of urls) {
    const path = new URL(url).pathname;
    expect(
      disallowed.filter((rule) => path.startsWith(rule)),
      path,
    ).toEqual([]);
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    expect(canonical && new URL(canonical).href, path).toBe(url);
    expect(html, path).not.toMatch(/<meta name="robots"[^>]*noindex/);
  }
});

test("the pages kept out of search say noindex and carry neither the cover's canonical nor a share card", async ({
  request,
}) => {
  // the kit specimen and its labs, the sign-in error, any unknown address
  for (const path of [
    "/design-system",
    "/design-system/paper",
    "/design-system/sahur",
    "/auth/error",
    "/no-such-page",
  ]) {
    const html = await (await request.get(path)).text();
    expect(html, path).toMatch(/<meta name="robots" content="noindex/);
    expect(html, path).not.toContain('rel="canonical"');
    expect(html, path).not.toMatch(/<meta (property="og|name="twitter):/);
  }
});

test("health probes answer for Kubernetes, never from a cache", async ({
  request,
}) => {
  for (const path of ["/health", "/health/deep"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("the trading cards on /stack flip from the keyboard, both faces in the markup", async ({
  page,
}) => {
  const t = messages.en.stackPage.trumps;
  await page.goto("/stack");
  await hydrated(page);
  const first = trumpDeck[0];
  const card = page
    .locator("#trumps li")
    .filter({ has: page.getByRole("heading", { name: first?.name }) });
  // the back is in the page for screen readers and without scripts
  await expect(card).toContainText(t.cards.next.does);
  const flip = card.getByRole("button", {
    name: new RegExp(`^${t.flip}\\W+${literally(first?.name ?? "").source}$`),
  });
  await expect(flip).toHaveAttribute("aria-pressed", "false");
  await flip.focus();
  await page.keyboard.press("Enter");
  await expect(flip).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(flip).toHaveAttribute("aria-pressed", "false");
});

test("the contact dialog on /stack lists every way to write, keeps the keyboard in, passes axe and gives focus back on Esc", async ({
  page,
}) => {
  const t = messages.en.contact;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/stack");
  await hydrated(page);
  const open = page.getByRole("main").getByRole("button", { name: t.button });
  await centre(open);
  await open.click();
  const dialog = page.getByRole("dialog", { name: t.dialogTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(t.dialogDescription);
  for (const href of [CALENDLY, `mailto:${EMAIL}`, TELEGRAM, LINKEDIN, GITHUB])
    await expect(dialog.locator(`a[href="${href}"]`)).toBeVisible();
  // round and round: past the last control focus comes back to the first
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  expect(await seriousViolations(page, '[role="dialog"]')).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
});

// ─── Without statistics and accounts ─────────────────────────

/*
 * The suite's own server runs with GTM_ID and the SSO addresses blank
 * (playwright.config.ts). A server it is pointed at may have them set, and
 * next dev signs in against the local stack by default: then these checks
 * have nothing to check. Each tells by what only the feature switched on
 * produces (a container id in the page, a sign-in sent on to the identity
 * service), so a server without it never skips them.
 */

test("no consent note, no Google tag and no Google host while GTM_ID is unset", async ({
  page,
  request,
}) => {
  test.skip(
    /GTM-[A-Z0-9]+/.test(await (await request.get("/")).text()),
    "This server has a GTM container.",
  );
  const t = messages.en.consent;
  const google: string[] = [];
  page.on("request", (r) => {
    if (/google/i.test(new URL(r.url()).hostname)) google.push(r.url());
  });
  for (const path of ["/", "/stack", "/privacy"]) {
    const csp = (await request.get(path)).headers()["content-security-policy"];
    expect(csp, path).not.toMatch(/google/i);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: t.title })).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.accept })).toHaveCount(0);
    await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => "dataLayer" in window), path).toBe(false);
  }
  expect(google).toEqual([]);
});

test("SSO off: no account control in the menu, nothing asks the account routes, and they answer 404", async ({
  page,
  request,
}) => {
  const signIn = await request.get("/auth/sign-in", { maxRedirects: 0 });
  test.skip(
    /\/authorize\?/.test(signIn.headers().location ?? ""),
    "This server signs in at the identity service.",
  );
  const asked: string[] = [];
  page.on("request", (r) => {
    if (/^\/(api|auth)\//.test(new URL(r.url()).pathname)) asked.push(r.url());
  });
  // the account control lives in the menu, on a narrow screen
  await page.setViewportSize(phone);
  for (const path of ["/", "/stack"]) {
    await page.goto(path);
    await hydrated(page);
    await page.getByRole("button", { name: messages.en.nav.menu }).click();
    const menu = page.getByRole("dialog");
    await expect(
      menu.getByRole("link", { name: messages.en.nav.book }),
    ).toBeVisible();
    await expect(menu.locator('[data-slot^="account-menu"]'), path).toHaveCount(
      0,
    );
    await page.waitForLoadState("networkidle");
  }
  await page.goto("/privacy");
  await page.waitForLoadState("networkidle");
  expect(asked).toEqual([]);
  // as if they were not there
  for (const path of ["/api/account", "/auth/sign-in", "/auth/callback"])
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(
      404,
    );
  expect((await request.post("/auth/sign-out")).status()).toBe(404);
});

// ─── The gates ───────────────────────────────────────────────

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/**
 * Holds the gates shut: their show stays paused from the first chunk on,
 * so only Esc can open them.
 */
async function holdTheGates(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent =
      ".gate:not([data-state]), .gate:not([data-state]) * { animation-play-state: paused !important; }";
    new MutationObserver((_, observer) => {
      if (!document.head) return;
      observer.disconnect();
      document.head.append(style);
    }).observe(document, { childList: true, subtree: true });
  });
}

test.describe("the gates", () => {
  // a fresh browser session: the gates have not played yet
  test.use({ gate: true });

  test("the server shuts them for a person, not for Googlebot, not after a skip, not on the kit specimen", async ({
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

  test("every page load opens through them, a reload too, until a skip", async ({
    page,
    context,
  }) => {
    await holdTheGates(page);
    const first = await page.goto("/");
    expect(await first?.text()).toContain('class="gate"');
    await expect(page.locator(".gate")).toBeVisible();
    // playing them is not skipping: nothing is remembered
    expect(
      (await context.cookies()).find((c) => c.name === "og_gate"),
    ).toBeUndefined();
    const again = await page.reload();
    expect(await again?.text()).toContain('class="gate"');
    const next = await page.goto("/stack");
    expect(await next?.text()).toContain('class="gate"');
    await expect(page.locator(".gate")).toBeVisible();
  });

  test("Esc opens them at once and keeps them open for the session", async ({
    page,
    context,
  }) => {
    await holdTheGates(page);
    await page.goto("/");
    const gate = page.locator(".gate");
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("aria-hidden", "true");
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(gate).toHaveCount(0, { timeout: 500 });
    }).toPass();
    // a session cookie: the gates are back with the next browser session
    expect(
      (await context.cookies()).find((c) => c.name === "og_gate"),
    ).toMatchObject({ value: "1", expires: -1 });
    await page.goto("/stack");
    await expect(page.locator(".gate")).toHaveCount(0);
  });

  test("reduced motion never shows them", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".gate")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
