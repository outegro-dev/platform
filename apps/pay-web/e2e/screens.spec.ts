import type { Page } from "@playwright/test";
import sharp from "sharp";
import {
  expect,
  type Persona,
  type PersonaOptions,
  persona,
  preferRussian,
  settle,
  test,
  updatePersona,
} from "./support";

/*
 * Screenshots of every screen for review and the report:
 *   e2e/screenshots/<screen>--<desktop|mobile>-<en|ru>.png
 * Run with `pnpm --filter @outegro/pay-web screenshots` (after a build).
 */

const viewports = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
} as const;

type Screen = {
  name: string;
  persona?: PersonaOptions;
  /** Also shot in Russian. */
  ru?: boolean;
  open: (page: Page, buyer: Persona) => Promise<void>;
  /** Shoot while something is still loading (no waiting for the network). */
  inFlight?: boolean;
  /** Only the viewport, e.g. for dialogs over a fixed overlay. */
  viewportOnly?: boolean;
};

const find = (buyer: Persona, productKey: string, status: string) =>
  buyer.orders.find((o) => o.productKey === productKey && o.status === status)
    ?.id as string;
const pending = (buyer: Persona) =>
  buyer.orders.find((o) => o.status === "pending")?.id as string;

const screens: Screen[] = [
  {
    name: "orders",
    ru: true,
    open: async (page) => {
      await page.goto("/orders");
      await expect(page.locator("article.order-row")).toHaveCount(4);
    },
  },
  {
    // Sent here by Battleship's "Manage subscription": the way back on top.
    name: "subscriptions-from-battleship",
    ru: true,
    open: async (page) => {
      const shop = encodeURIComponent("https://battleship.fake.test/shop");
      await page.goto(`/subscriptions?return=${shop}`);
      await expect(page.getByTestId("return-link")).toBeVisible();
    },
  },
  {
    name: "account-menu",
    ru: true,
    viewportOnly: true,
    persona: { roles: ["support"] },
    open: async (page) => {
      await page.goto("/orders");
      await page.getByRole("button", { name: /and apps$|приложения$/ }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "orders-empty",
    persona: { scenario: "empty" },
    open: async (page) => {
      await page.goto("/orders");
      await expect(page.locator(".state-panel")).toBeVisible();
    },
  },
  {
    name: "orders-unavailable",
    persona: { payments: "down" },
    ru: true,
    open: async (page) => {
      await page.goto("/orders");
      await expect(page.locator(".state-panel")).toBeVisible();
    },
  },
  {
    name: "orders-loading",
    inFlight: true,
    open: async (page, buyer) => {
      await page.goto("/subscriptions");
      await updatePersona(buyer.id, { latencyMs: 6000 });
      await page
        .getByRole("navigation", { name: /sections|Разделы/ })
        .getByRole("link", { name: "Purchases" })
        .click();
      await expect(page.locator(".loading-note")).toBeVisible();
    },
  },
  {
    name: "order-subscription-paid",
    ru: true,
    open: async (page, buyer) => {
      await page.goto(`/orders/${find(buyer, "battleship-premium", "paid")}`);
      await expect(page.locator(".hero-card")).toBeVisible();
    },
  },
  {
    name: "order-one-time-paid",
    open: async (page, buyer) => {
      await page.goto(
        `/orders/${find(buyer, "battleship-silver-fleet", "paid")}`,
      );
      await expect(page.locator(".hero-card")).toBeVisible();
    },
  },
  {
    name: "order-processing",
    persona: { scenario: "returning" },
    ru: true,
    open: async (page, buyer) => {
      await page.goto(`/orders/${pending(buyer)}`);
      await expect(page.locator(".orb")).toBeVisible();
    },
  },
  {
    name: "order-not-completed",
    persona: { scenario: "returning" },
    open: async (page, buyer) => {
      await page.goto(
        `/checkout/result?orderId=${pending(buyer)}&result=cancel`,
      );
      await expect(page.locator(".orb")).toBeVisible();
    },
  },
  {
    name: "order-unpaid",
    persona: { scenario: "returning" },
    open: async (page, buyer) => {
      const abandoned = buyer.orders.filter((o) => o.status === "pending")[1];
      await page.goto(`/orders/${abandoned?.id}`);
      await expect(page.locator(".hero-card")).toBeVisible();
    },
  },
  {
    name: "order-activating",
    persona: { scenario: "returning" },
    open: async (page, buyer) => {
      await settle(pending(buyer), "paid", { accessAfterMs: 120_000 });
      await page.goto(`/orders/${pending(buyer)}`);
      await expect(page.locator(".orb")).toBeVisible();
    },
  },
  {
    name: "order-failed",
    open: async (page, buyer) => {
      await page.goto(
        `/orders/${find(buyer, "battleship-silver-fleet", "failed")}`,
      );
      await expect(page.locator(".hero-card[data-tone=danger]")).toBeVisible();
    },
  },
  {
    name: "order-refunded",
    open: async (page, buyer) => {
      await page.goto(
        `/orders/${find(buyer, "battleship-premium", "refunded")}`,
      );
      await expect(page.locator(".hero-card")).toBeVisible();
    },
  },
  {
    name: "order-not-found",
    open: async (page) => {
      await page.goto("/orders/00000000-0000-4000-8000-000000000000");
      await expect(page.locator(".state-panel")).toBeVisible();
    },
  },
  {
    name: "subscriptions",
    ru: true,
    open: async (page) => {
      await page.goto("/subscriptions");
      await expect(page.locator(".sub-card").first()).toBeVisible();
    },
  },
  {
    name: "subscriptions-states",
    persona: { scenario: "states" },
    open: async (page) => {
      await page.goto("/subscriptions");
      await expect(page.locator(".sub-card")).toHaveCount(5);
    },
  },
  {
    name: "subscriptions-cancel-dialog",
    viewportOnly: true,
    ru: true,
    open: async (page) => {
      await page.goto("/subscriptions");
      await page
        .locator(".sub-card")
        .first()
        .getByRole("button")
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "subscriptions-cancelled",
    open: async (page) => {
      await page.goto("/subscriptions");
      await page
        .locator(".sub-card")
        .first()
        .getByRole("button")
        .first()
        .click();
      await page
        .getByRole("dialog")
        .locator("[data-variant=destructive]")
        .click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(page.locator(".sub-note .done")).toBeVisible();
    },
  },
  {
    name: "catalog",
    persona: { scenario: "empty" },
    ru: true,
    open: async (page) => {
      await page.goto("/catalog");
      await expect(page.locator(".product-card")).toHaveCount(2);
    },
  },
  {
    name: "catalog-owned",
    open: async (page) => {
      await page.goto("/catalog");
      await expect(page.locator(".product-card")).toHaveCount(2);
    },
  },
  {
    name: "catalog-closed",
    persona: { scenario: "empty", catalog: "closed" },
    open: async (page) => {
      await page.goto("/catalog");
      await expect(page.locator(".notice")).toBeVisible();
    },
  },
  {
    name: "signed-out",
    open: async (page) => {
      await page.goto("/orders");
      await page.getByRole("button", { name: /and apps$/ }).click();
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/signed-out/);
    },
  },
  {
    name: "sign-in-error",
    open: async (page) => {
      await page.goto("/auth/error?reason=state_mismatch");
      await expect(page.locator(".notice-page")).toBeVisible();
    },
  },
];

for (const screen of screens) {
  for (const [device, options] of Object.entries(viewports)) {
    for (const locale of screen.ru ? ["en", "ru"] : ["en"]) {
      test(`${screen.name} ${device} ${locale}`, async ({ browser }) => {
        const context = await browser.newContext({
          ...options,
          locale: locale === "ru" ? "ru-RU" : "en-US",
          timezoneId: "UTC",
        });
        const page = await context.newPage();
        const buyer = await persona(page, {
          displayName: "Nick Lukashik",
          email: "nick@outegro.dev",
          ...screen.persona,
        });
        if (locale === "ru") await preferRussian(page);
        await screen.open(page, buyer);
        if (!screen.inFlight)
          await page.waitForLoadState("networkidle").catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        const shot = await page.screenshot({
          fullPage: !screen.viewportOnly,
          animations: "disabled",
        });
        await context.close();
        // Palette PNG: the same picture at about a third of the bytes.
        await sharp(shot)
          .png({ palette: true, quality: 90, effort: 8, compressionLevel: 9 })
          .toFile(`e2e/screenshots/${screen.name}--${device}-${locale}.png`);
      });
    }
  }
}
