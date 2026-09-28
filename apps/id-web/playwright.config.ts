import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end account flows against the real services. Needs `pnpm infra:up`,
 * `pnpm env:local`, migrations and a build; servers already running are reused.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3002",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --env-file=.env dist/main.js",
      cwd: "../auth-backend",
      url: "http://localhost:4001/health",
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: "node --env-file=.env dist/main.js",
      cwd: "../notifications-backend",
      url: "http://localhost:4002/health",
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      // The same standalone server.js the container runs.
      command: "node ../../tools/dev/start-standalone.mjs 3002",
      url: "http://localhost:3002/health",
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});
