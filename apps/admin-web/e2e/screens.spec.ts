import type { Page } from "@playwright/test";
import {
  expectAccessible,
  expectNoSideScroll,
  expectStable,
  openFirstRow,
  openUserTab,
  type Persona,
  phone,
  screenshot,
  settle,
  signIn,
  test,
  useRussian,
  visit,
  withFailure,
} from "./fixtures";

/**
 * Every screen, three ways (desktop EN, phone EN, desktop RU; a few on a
 * Russian phone too): no serious or critical axe violations, no sideways
 * page scroll, no layout shift after load, no console errors, and a
 * full-page screenshot in e2e/screenshots/ to look at.
 */
type Screen = {
  name: string;
  persona?: Persona;
  path: string;
  /** Extra steps after landing on `path` (open a row, a tab, a dialog). */
  steps?: (page: Page) => Promise<void>;
  userAgent?: string;
  /** Dialog screens: the dialog is the input, its opening shift is intended. */
  skipStability?: boolean;
  /** `steps` find controls by their English names. */
  englishOnly?: boolean;
  /** Console errors this screen causes on purpose. */
  allowedConsoleErrors?: RegExp[];
};

const openTab = (name: string) => (page: Page) => openUserTab(page, name);

const screens: Screen[] = [
  { name: "dashboard", path: "/" },
  { name: "users", path: "/users" },
  { name: "user-profile", path: "/users?query=mira", steps: openFirstRow },
  {
    name: "user-roles",
    englishOnly: true,
    path: "/users?query=mira",
    steps: async (page) => {
      await openFirstRow(page);
      await openTab("Roles")(page);
    },
  },
  {
    name: "user-access",
    englishOnly: true,
    path: "/users?query=lena",
    steps: async (page) => {
      await openFirstRow(page);
      await openTab("Product access")(page);
    },
  },
  {
    // Nothing bought or granted: both cards show their empty state.
    name: "user-access-empty",
    englishOnly: true,
    path: "/users?query=hana",
    steps: async (page) => {
      await openFirstRow(page);
      await openTab("Product access")(page);
    },
  },
  {
    name: "user-education",
    englishOnly: true,
    path: "/users?query=mira",
    steps: async (page) => {
      await openFirstRow(page);
      await openTab("Education")(page);
    },
  },
  {
    // Grants in force, scheduled and expired (Payments calls all three active).
    name: "user-education-grants",
    path: "/users?query=artem.k",
    steps: async (page) => {
      await openFirstRow(page);
      await page.waitForURL(/\/users\/[0-9a-f-]{36}$/);
      await visit(page, `${new URL(page.url()).pathname}?tab=education`);
    },
  },
  {
    name: "user-notifications",
    englishOnly: true,
    path: "/users?query=mira",
    steps: async (page) => {
      await openFirstRow(page);
      await openTab("Notifications")(page);
    },
  },
  {
    name: "user-suspend-dialog",
    englishOnly: true,
    path: "/users?query=chloe",
    skipStability: true,
    steps: async (page) => {
      await openFirstRow(page);
      await page.getByRole("button", { name: "Suspend" }).click();
      await page
        .getByRole("dialog")
        .getByLabel("Reason")
        .fill("Chargeback abuse");
    },
  },
  { name: "notifications", path: "/notifications" },
  { name: "deliveries", path: "/notifications/deliveries" },
  {
    name: "delivery",
    // A retryable one (sign-in codes never are).
    path: "/notifications/deliveries?state=failed&channel=telegram",
    steps: openFirstRow,
  },
  {
    name: "templates",
    path: "/notifications/templates?template=security.session-revoked",
  },
  { name: "channels", path: "/notifications/channels" },
  { name: "notifications-audit", path: "/notifications/audit" },
  { name: "payments", path: "/payments" },
  { name: "orders", path: "/payments/orders" },
  { name: "order", path: "/payments/orders?status=paid", steps: openFirstRow },
  { name: "subscriptions", path: "/payments/subscriptions" },
  { name: "events", path: "/payments/events" },
  {
    name: "event",
    path: "/payments/events?status=unmatched",
    steps: openFirstRow,
  },
  { name: "grants", path: "/payments/grants" },
  { name: "issues", path: "/payments/issues" },
  { name: "refunds", path: "/payments/refunds" },
  {
    name: "payments-not-connected",
    path: "/payments",
    userAgent: withFailure("fake-down=payments"),
  },
  { name: "battleship", path: "/battleship" },
  { name: "matches", path: "/battleship/matches" },
  {
    name: "match",
    path: "/battleship/matches?status=finished",
    steps: openFirstRow,
  },
  { name: "players", path: "/battleship/players" },
  {
    name: "player",
    path: "/battleship/players?query=SeaWolf",
    steps: openFirstRow,
  },
  { name: "battleship-audit", path: "/battleship/audit" },
  { name: "education", path: "/education" },
  { name: "books", path: "/education/books" },
  { name: "book", path: "/education/books/sql-internals" },
  {
    name: "book-access-dialog",
    englishOnly: true,
    path: "/education/books/nodejs-internals",
    skipStability: true,
    steps: async (page) => {
      await page.getByRole("button", { name: "Change access" }).click();
      await page
        .getByRole("dialog")
        .getByLabel("Reason")
        .fill("Two free chapters for the launch week");
    },
  },
  { name: "readers", path: "/education/readers" },
  { name: "education-audit", path: "/education/audit" },
  {
    // A newer edu-backend records an action this console cannot name yet.
    name: "education-audit-future",
    path: "/education/audit",
    userAgent: withFailure("fake-audit=future"),
  },
  {
    // The AI assistant switched off: no requests, so no shares; no spending cap.
    name: "education-assist-off",
    path: "/education",
    userAgent: withFailure("fake-assist=off"),
  },
  {
    // Today's spending cap reached: paused for readers until 00:00 UTC.
    name: "education-assist-paused",
    path: "/education",
    userAgent: withFailure("fake-assist=paused"),
  },
  {
    name: "education-not-connected",
    path: "/education",
    userAgent: withFailure("fake-down=edu"),
  },
  { name: "audit", path: "/audit" },
  {
    name: "dashboard-degraded",
    path: "/",
    userAgent: withFailure("fake-fail=notifications"),
  },
  { name: "forbidden", persona: "support", path: "/payments" },
  { name: "no-access", persona: "nobody", path: "/" },
  {
    name: "not-found",
    path: "/nothing-here",
    allowedConsoleErrors: [/status of 404/],
  },
];

async function capture(page: Page, screen: Screen, suffix: string) {
  await signIn(page, screen.persona ?? "owner", screen.path);
  if (screen.path !== new URL(page.url()).pathname + new URL(page.url()).search)
    await visit(page, screen.path);
  await screen.steps?.(page);
  await settle(page);
  await expectAccessible(page);
  await expectNoSideScroll(page);
  if (!screen.skipStability) await expectStable(page);
  await screenshot(page, `${screen.name}-${suffix}`);
}

test.describe("desktop, English", () => {
  for (const screen of screens) {
    test.describe(screen.name, () => {
      if (screen.userAgent) test.use({ userAgent: screen.userAgent });
      if (screen.allowedConsoleErrors)
        test.use({ allowedConsoleErrors: screen.allowedConsoleErrors });
      test(`${screen.name}`, async ({ page }) => {
        await capture(page, screen, "desktop-en");
      });
    });
  }

  test("sign-in", async ({ page }) => {
    await visit(page, "/sign-in?reason=idle");
    await expectAccessible(page);
    await expectStable(page);
    await screenshot(page, "sign-in-desktop-en");
  });
});

test.describe("phone, English", () => {
  test.use(phone);
  for (const screen of screens) {
    test.describe(screen.name, () => {
      if (screen.userAgent)
        test.use({ userAgent: `${screen.userAgent} Mobile` });
      if (screen.allowedConsoleErrors)
        test.use({ allowedConsoleErrors: screen.allowedConsoleErrors });
      test(`${screen.name}`, async ({ page }) => {
        await capture(page, screen, "mobile-en");
      });
    });
  }

  test("sign-in", async ({ page }) => {
    await visit(page, "/sign-in?signedOut=1");
    await expectAccessible(page);
    await screenshot(page, "sign-in-mobile-en");
  });

  test("navigation sheet", async ({ page }) => {
    await signIn(page, "owner", "/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expectAccessible(page);
    await page.screenshot({
      path: `${__dirname}/screenshots/navigation-sheet-mobile-en.png`,
    });
  });
});

test.describe("desktop, Russian", () => {
  for (const screen of screens.filter((item) => !item.englishOnly)) {
    test.describe(screen.name, () => {
      if (screen.userAgent) test.use({ userAgent: screen.userAgent });
      if (screen.allowedConsoleErrors)
        test.use({ allowedConsoleErrors: screen.allowedConsoleErrors });
      test(`${screen.name}`, async ({ page, context }) => {
        await useRussian(context);
        await capture(page, screen, "desktop-ru");
      });
    });
  }

  test("sign-in", async ({ page, context }) => {
    await useRussian(context);
    await visit(page, "/sign-in");
    await expectAccessible(page);
    await screenshot(page, "sign-in-desktop-ru");
  });
});

test.describe("phone, Russian", () => {
  test.use(phone);
  for (const screen of screens.filter((item) =>
    [
      "dashboard",
      "user-profile",
      "match",
      "order",
      "channels",
      "education",
      "book",
    ].includes(item.name),
  )) {
    test(`${screen.name}`, async ({ page, context }) => {
      await useRussian(context);
      await capture(page, screen, "mobile-ru");
    });
  }
});
