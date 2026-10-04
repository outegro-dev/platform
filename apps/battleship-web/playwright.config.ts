import { defineConfig, devices } from "@playwright/test";

/**
 * Hermetic end-to-end tests: the production build on :3195 talks to a fake
 * platform (identity, battleship HTTP, payments) on :4195, and each test
 * scripts the game WebSocket in the browser (page.routeWebSocket).
 * Run `pnpm build` first. Another checkout running its suite at the same
 * time picks other ports with E2E_APP_PORT and E2E_PLATFORM_PORT.
 */
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3195);
const PLATFORM_PORT = Number(process.env.E2E_PLATFORM_PORT ?? 4195);
const PLATFORM = `http://localhost:${PLATFORM_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  workers: 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    locale: "en-US",
    colorScheme: "light",
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
      url: `${PLATFORM}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      env: {
        ...process.env,
        FAKE_PLATFORM_PORT: String(PLATFORM_PORT),
        FAKE_APP_ORIGIN: `http://localhost:${APP_PORT}`,
      } as Record<string, string>,
    },
    {
      // The same standalone server.js the container runs.
      command: `node ../../tools/dev/start-standalone.mjs ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/health`,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...process.env,
        HOSTNAME: "0.0.0.0",
        APP_URL: `http://localhost:${APP_PORT}`,
        BATTLESHIP_API_URL: PLATFORM,
        // Its own prefix: Identity and the game server both have /v1/me.
        AUTH_API_URL: `${PLATFORM}/identity`,
        ID_URL: PLATFORM,
        SITE_URL: `${PLATFORM}/site`,
        GAME_WS_URL: `ws://localhost:${PLATFORM_PORT}`,
        PAYMENTS_API_URL: PLATFORM,
        // Only linked to, never opened by the tests.
        PAY_URL: "https://pay.fake.test",
        EDU_URL: "https://edu.fake.test",
        ADMIN_URL: "https://admin.fake.test",
        CHECKOUT_ORIGINS: "https://checkout.fake.test",
        CLIENT_IP_SOURCE: "x-forwarded-for",
      } as Record<string, string>,
    },
  ],
});
