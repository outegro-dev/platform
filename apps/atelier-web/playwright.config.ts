import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in mock mode: the production build (the same standalone
 * server.js the container runs) with ATELIER_API_URL=mock, so the made-up
 * data of src/lib/mock.ts stands in for atelier-backend and sign-in is
 * skipped. Run `pnpm build` first. The tests share the server's mock state
 * and reset it, so they run one at a time. Screenshots go to
 * E2E_SCREENSHOTS_DIR (default test-results/screenshots, never committed).
 */
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3197);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results/output",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    locale: "en-US",
    timezoneId: "UTC",
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
  webServer: {
    command: `node ../../tools/dev/start-standalone.mjs ${APP_PORT}`,
    url: `http://localhost:${APP_PORT}/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...process.env,
      HOSTNAME: "0.0.0.0",
      APP_URL: `http://localhost:${APP_PORT}`,
      ATELIER_API_URL: "mock",
    } as Record<string, string>,
  },
});
