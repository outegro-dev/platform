import AxeBuilder from "@axe-core/playwright";
import {
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Persona } from "./personas.ts";

// Same defaults and overrides as playwright.config.ts.
export const PLATFORM = `http://localhost:${process.env.E2E_PLATFORM_PORT ?? 4198}`;
export const APP = `http://localhost:${process.env.E2E_APP_PORT ?? 3198}`;
/** SITE_URL of the app under test: linked, never opened. */
export const SITE = `${PLATFORM}/site`;

type Fixtures = {
  consoleErrors: string[];
  /** Console errors a test causes on purpose (e.g. a 404 page). */
  allowConsoleErrors: (pattern: RegExp) => void;
};

/**
 * Every test: console errors fail it, and layout shifts are recorded from
 * the first paint (window.__cls).
 */
export const test = base.extend<Fixtures>({
  allowConsoleErrors: async ({ consoleErrors }, use) => {
    await use((pattern) => {
      (consoleErrors as string[] & { allowed?: RegExp[] }).allowed ??= [];
      (consoleErrors as string[] & { allowed?: RegExp[] }).allowed?.push(
        pattern,
      );
    });
  },
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] & { allowed?: RegExp[] } = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (failure) => errors.push(failure.message));
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[]) {
            if (!entry.hadRecentInput) w.__cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await use(errors);
      const unexpected = errors.filter(
        (text) => !(errors.allowed ?? []).some((pattern) => pattern.test(text)),
      );
      expect(unexpected, "the page logged errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Signs in through the fake id.outegro.dev as a persona and lands on `returnTo`. */
export async function signIn(
  page: Page,
  persona: Persona = "reader",
  returnTo = "/",
) {
  await page
    .context()
    .addCookies([
      { name: "e2e_persona", value: persona, domain: "localhost", path: "/" },
    ]);
  await page.goto(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  const path = returnTo.split("?")[0];
  await page.waitForURL((url) => url.pathname === path);
}

/** The signed-in user's id: the `sub` of the access token in og_at. */
export async function userIdOf(page: Page): Promise<string> {
  const token = (await page.context().cookies(APP)).find(
    (cookie) => cookie.name === "og_at",
  )?.value;
  if (!token) throw new Error("not signed in");
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { sub?: string };
  if (!payload.sub) throw new Error("no subject in the access token");
  return payload.sub;
}

export type Fault = {
  /** assistStatus: the assistant's status the page loads (GET /v1/me/assist). */
  route: "attempts" | "cards" | "assist" | "assistStatus";
  mode: "drop" | "dropAfter" | "status" | "delay" | "verdict" | "streamError";
  status?: number;
  /** The assistant's reason for a status (fieldErrors.assist). */
  reason?: "daily_limit" | "disabled" | "paused" | "busy";
  delayMs?: number;
  verdict?: { correct: boolean; solved: boolean };
  times?: number;
};

/**
 * The fake assistant for this page's user: on or off, paused for the day
 * (the shared limit of all readers), and today's answers.
 */
export async function setAssist(
  page: Page,
  state: {
    enabled?: boolean;
    paused?: boolean;
    dailyLimit?: number;
    usedToday?: number;
  },
) {
  const userId = await userIdOf(page);
  const response = await page.request.post(`${PLATFORM}/__e2e/assist`, {
    data: { userId, ...state },
  });
  expect(response.status()).toBe(204);
}

/** What the fake assistant was asked by this page's user, and how many answers were cut off. */
export async function assistLog(page: Page): Promise<{
  requests: { kind: string; body: Record<string, unknown> }[];
  hangUps: number;
}> {
  const userId = await userIdOf(page);
  const response = await page.request.get(
    `${PLATFORM}/__e2e/assist?userId=${userId}`,
  );
  return response.json();
}

/** Makes the fake edu-backend misbehave for this page's user only. */
export async function injectFault(page: Page, fault: Fault) {
  const userId = await userIdOf(page);
  const response = await page.request.post(`${PLATFORM}/__e2e/faults`, {
    data: { userId, ...fault },
  });
  expect(response.status()).toBe(204);
}

/** What the fake edu-backend recorded for this user's attempts at an exercise. */
export async function recordedAttempts(
  page: Page,
  exerciseId: string,
): Promise<{ count: number; keys: string[]; requests: number }> {
  const userId = await userIdOf(page);
  const response = await page.request.get(
    `${PLATFORM}/__e2e/attempts?userId=${userId}&exerciseId=${exerciseId}`,
  );
  return response.json();
}

/** While axe measures, every animation and transition shows its end at once. */
const HOLD_STILL = `*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
}`;

/** No accessibility violations at all (WCAG 2.2 AA rules), whatever their impact. */
export async function expectAccessible(page: Page, where: string) {
  const still = await page.addStyleTag({ content: HOLD_STILL });
  let found: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];
  try {
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.playState !== "running" ||
            animation.effect?.getTiming().iterations ===
              Number.POSITIVE_INFINITY,
        ),
    );
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    found = violations;
  } finally {
    await still
      .evaluate((node) => (node as HTMLStyleElement).remove())
      .catch(() => undefined);
    await still.dispose();
  }
  expect(
    found.map(
      (violation) =>
        `${where}: ${violation.id} × ${violation.nodes.length} — ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    ),
  ).toEqual([]);
}

/** Cumulative layout shift since the page loaded (inputs excluded, as in CLS). */
export async function layoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __cls: number }).__cls ?? 0,
  );
}

/**
 * Waits until React has hydrated an element (it carries React's internal
 * keys then). Typing into a server-rendered editor before that could land
 * in the middle of hydration, which resets the field.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((node) =>
        Object.keys(node).some((key) => key.startsWith("__react")),
      ),
    )
    .toBe(true);
}

/** Lets the page settle (fonts, hydration) before measuring. */
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

/**
 * Elements whose box ends past the viewport's left or right edge outside
 * any box that scrolls or clips them: content the page cuts off. html and
 * body clip overflow-x, so the page's scroll width alone cannot show it.
 */
export function cutOffElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipped = (element: Element) => {
      for (
        let parent = element.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      )
        if (getComputedStyle(parent).overflowX !== "visible") return true;
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > width + 0.5 || box.left < -0.5);
      })
      .filter((element) => !clipped(element))
      .map((element) => {
        const box = element.getBoundingClientRect();
        const name =
          typeof element.className === "string" && element.className
            ? `.${element.className.trim().split(/\s+/).join(".")}`
            : "";
        return `${element.tagName.toLowerCase()}${name} [${Math.round(box.left)}–${Math.round(box.right)}] ${(element.textContent ?? "").trim().slice(0, 30)}`;
      });
  });
}

/** Nothing on the page is cut off at its sides (see cutOffElements). */
export async function expectNothingCutOff(page: Page, where: string) {
  expect(await cutOffElements(page), `${where}: cut off at the sides`).toEqual(
    [],
  );
}

/** The SQL worker's script (Turbopack's worker entry). */
const WORKER = /turbopack-worker-/;

/**
 * Holds every load of the SQL engine until `offline()` is called, then
 * fails it as a browser without a connection would: the engine's first
 * download happens while the reader is offline.
 */
export async function engineLoadsOffline(context: BrowserContext) {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await context.route(WORKER, async (route) => {
    await held;
    await route.abort("internetdisconnected").catch(() => undefined);
  });
  return {
    async offline() {
      await context.setOffline(true);
      release();
    },
    async online() {
      await context.unroute(WORKER);
      await context.setOffline(false);
    },
  };
}

/** 200 rows of two 480-character cells: a result far over 96 kB. */
export const HUGE_RESULT =
  "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 200) SELECT n, hex(zeroblob(240)) AS a, hex(zeroblob(240)) AS b FROM t;";
