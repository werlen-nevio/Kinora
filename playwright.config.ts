import { defineConfig, devices } from "@playwright/test";

export const E2E_PORT = 3101;

export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // Die Tests teilen sich Datenbank und Rate Limits, deshalb nacheinander.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "de-CH",
  },
  webServer: {
    command: "npx tsx tests/e2e/start-stack.ts",
    url: `http://localhost:${E2E_PORT}/api/health`,
    timeout: 8 * 60 * 1000,
    reuseExistingServer: Boolean(process.env.E2E_REUSE),
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /responsive/ },
    { name: "mobil", use: { ...devices["Pixel 7"] }, testMatch: /responsive/ },
  ],
});
