import { defineConfig, devices } from "@playwright/test";

/**
 * Hermetic e2e: the production build (standalone server.js, as in the
 * container) against a fake platform that plays Identity, Notifications,
 * Battleship and Payments. Needs `pnpm --filter @outegro/admin-web build`.
 */
const APP = "http://localhost:3196";
const FAKE = "http://localhost:4196";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: APP,
    locale: "en-US",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command:
        "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON e2e/fake-platform.ts",
      url: `${FAKE}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { FAKE_PLATFORM_PORT: "4196" },
    },
    {
      command: "node ../../tools/dev/start-standalone.mjs 3196",
      url: `${APP}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        AUTH_API_URL: `${FAKE}/auth`,
        NOTIFICATIONS_API_URL: `${FAKE}/notifications`,
        BATTLESHIP_API_URL: `${FAKE}/battleship`,
        PAYMENTS_ADMIN_API_URL: `${FAKE}/payments`,
        ID_URL: FAKE,
        APP_URL: APP,
        CLIENT_IP_SOURCE: "x-forwarded-for",
      },
    },
  ],
});
