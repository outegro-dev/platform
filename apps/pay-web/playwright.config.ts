import { defineConfig, devices } from "@playwright/test";

/**
 * Hermetic end-to-end run: the production build of pay-web (the same
 * standalone server.js the container runs) against e2e/fake-platform.ts,
 * which plays Identity SSO and payments-backend. Needs `pnpm build` first.
 *
 *   pnpm --filter @outegro/pay-web test:e2e      flows, axe, layout shift
 *   pnpm --filter @outegro/pay-web screenshots   e2e/screenshots/*.png
 */
const APP = "http://localhost:3197";
const FAKE = "http://localhost:4197";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  use: {
    baseURL: APP,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /screens\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // Pictures, not checks: one retry absorbs a slow machine.
      name: "screens",
      testMatch: /screens\.spec\.ts/,
      retries: 1,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON e2e/fake-platform.ts",
      url: `${FAKE}/__control/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_PLATFORM_PORT: "4197", FAKE_APP_ORIGIN: APP },
    },
    {
      command: "node ../../tools/dev/start-standalone.mjs 3197",
      url: `${APP}/health`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        PAYMENTS_API_URL: FAKE,
        AUTH_API_URL: FAKE,
        ID_URL: FAKE,
        APP_URL: APP,
        CHECKOUT_ORIGINS: "https://app.lava.top",
        CLIENT_IP_SOURCE: "x-forwarded-for",
        SITE_URL: "https://outegro.dev",
        // Sibling apps: linked to and allowed as ways back, never opened.
        BATTLESHIP_URL: "https://battleship.fake.test",
        EDU_URL: "https://edu.fake.test",
        ADMIN_URL: "https://admin.fake.test",
      },
    },
  ],
});
