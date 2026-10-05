import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

export const APP = "http://localhost:3197";
export const FAKE = "http://localhost:4197";

export type PersonaOptions = {
  scenario?: "empty" | "rich" | "returning" | "states" | "many";
  payments?: "up" | "down";
  /** future: also products of apps pay-web knows less about (fake-platform.ts). */
  catalog?: "normal" | "empty" | "closed" | "down" | "future";
  cancelMode?: "confirm" | "pending";
  checkoutMode?: "ready" | "preparing" | "failed" | "offsite";
  accessTtlSec?: number;
  latencyMs?: number;
  displayName?: string;
  email?: string;
  /** Platform roles, e.g. ["support"]: the account menu links the admin console. */
  roles?: string[];
  /** Identity's /v1/me fails while the session keeps working. */
  identity?: "up" | "down";
};

export type Persona = {
  id: string;
  email: string;
  orders: {
    id: string;
    productKey: string;
    status: string;
    subscriptionId: string | null;
  }[];
  subscriptions: { id: string; state: string; orderId: string }[];
  log: {
    refreshes: number;
    logouts: number;
    checkouts: {
      key: string;
      productKey: string;
      currency: string;
      returnUrl: string | null;
    }[];
    cancels: string[];
    orderPolls: number;
  };
};

/** Talks to the fake platform's control API. */
export async function control<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(`${FAKE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return (await response.json()) as T;
}

/**
 * A fresh buyer with realistic data. The browser gets the persona cookie
 * the fake /authorize reads and its own client IP (pay-web forwards it to
 * services, which is how public catalog calls find the persona).
 */
export async function persona(
  page: Page,
  options: PersonaOptions = {},
): Promise<Persona> {
  // A documentation-range IPv6 address per persona: collisions are out of
  // the question, so parallel tests never see each other's catalog.
  const ip = `2001:db8::${randomBytes(6).toString("hex").match(/.{4}/g)?.join(":")}`;
  const created = await control<Persona>("/__control/personas", {
    scenario: "rich",
    ...options,
    ip,
  });
  const context = page.context();
  await context.addCookies([
    { name: "fake_persona", value: created.id, url: FAKE },
  ]);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return created;
}

export const updatePersona = (id: string, changes: Partial<PersonaOptions>) =>
  control<Persona>(`/__control/personas/${id}`, changes, "PATCH");

export const readPersona = (id: string) =>
  control<Persona>(`/__control/personas/${id}`);

export const settle = (
  orderId: string,
  outcome: "paid" | "failed",
  timing: { afterMs?: number; accessAfterMs?: number } = {},
) => control(`/__control/orders/${orderId}/settle`, { outcome, ...timing });

export async function preferRussian(page: Page) {
  await page
    .context()
    .addCookies([{ name: "og_locale", value: "ru", url: APP }]);
}

/**
 * Waits for finite CSS animations (dialog fade-in, settle-in marks) to end,
 * so contrast is measured on the final colours. Endless ones (spinners,
 * live dots) are ignored.
 */
export async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );
}

/** No serious or critical axe violations (WCAG 2.1 A/AA). */
export async function expectAccessible(page: Page, screen: string) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
    `axe on ${screen}`,
  ).toEqual([]);
}

/** Sums layout shifts without recent input from the first paint on. */
export async function watchLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[])
        if (!entry.hadRecentInput) w.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
}

export const layoutShift = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cls: number }).__cls);

/** No horizontal page scroll at this viewport. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Every test fails on browser console errors and uncaught page errors.
 * A test that provokes failing responses on purpose lists them in
 * `expectedConsole`.
 */
export const test = base.extend<{ expectedConsole: RegExp[] }>({
  expectedConsole: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      const expected: RegExp[] = [];
      await use(expected);
      const unexpected = errors.filter(
        (text) => !expected.some((pattern) => pattern.test(text)),
      );
      expect(unexpected, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
