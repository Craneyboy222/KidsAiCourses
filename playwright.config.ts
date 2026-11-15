import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end and accessibility suites. They run against a production build using the
 * test database and fixture providers: no real AI, Stripe or Radar source is ever called.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: ["e2e/**/*.spec.ts", "a11y/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure", locale: "en-GB", timezoneId: "Europe/London" },
  globalSetup: "./tests/helpers/e2e-global-setup.ts",
  projects: [
    { name: "desktop", testMatch: "e2e/**/*.spec.ts", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    {
      // A typical school Chromebook: 1366×768, slow CPU is approximated in the Lighthouse run.
      name: "chromebook",
      testMatch: "e2e/**/*.chromebook.spec.ts",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1366, height: 768 } },
    },
    { name: "a11y", testMatch: "a11y/**/*.spec.ts", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],
  webServer: {
    command: `pnpm exec dotenv -e .env.test -- next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
