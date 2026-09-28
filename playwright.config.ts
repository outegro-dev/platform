import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Real GPU on Windows dev machines. Elsewhere Chromium falls back to
        // SwiftShader and the site (correctly) shows posters instead of 3D.
        launchOptions: {
          args:
            process.platform === "win32"
              ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"]
              : [],
        },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    // The same standalone server.js the container runs.
    command: "pnpm --filter @outegro/landing-web start 3100",
    url: "http://localhost:3100/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
