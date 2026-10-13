import { defineConfig, devices } from "@playwright/test";

// PW_BASE_URL points the suite at a server that is already running (a dev
// server, a preview); without it the suite starts the standalone build.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: the e2e run is not a Turborepo task, nothing is cached on it.
const external = process.env.PW_BASE_URL;

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
    baseURL: external ?? "http://localhost:3100",
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
  webServer: external
    ? undefined
    : {
        // The same standalone server.js the container runs.
        command: "pnpm --filter @outegro/landing-web start 3100",
        url: "http://localhost:3100/health",
        reuseExistingServer: !process.env.CI,
        timeout: 60000,
        // The suite checks the site as it runs without accounts and
        // statistics: blank, these turn SSO and GTM off whatever the shell
        // has set.
        env: {
          ...process.env,
          APP_URL: "",
          ID_URL: "",
          AUTH_API_URL: "",
          GTM_ID: "",
        } as Record<string, string>,
      },
});
