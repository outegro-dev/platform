import { defineConfig, devices } from "@playwright/test";

/**
 * Hermetic end-to-end tests: the production build on :3195 talks to a fake
 * platform (identity, battleship HTTP, payments) on :4195, and each test
 * scripts the game WebSocket in the browser (page.routeWebSocket).
 * Run `pnpm build` first.
 */
const APP_PORT = 3195;
const PLATFORM = "http://localhost:4195";

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
        AUTH_API_URL: PLATFORM,
        ID_URL: PLATFORM,
        SITE_URL: `${PLATFORM}/site`,
        GAME_WS_URL: "ws://localhost:4195",
        PAYMENTS_API_URL: PLATFORM,
        CHECKOUT_ORIGINS: "https://checkout.fake.test",
        CLIENT_IP_SOURCE: "x-forwarded-for",
      } as Record<string, string>,
    },
  ],
});
