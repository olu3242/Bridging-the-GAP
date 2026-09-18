import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const baseURL = process.env.BTG_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// Some sandboxes ship a preinstalled Chromium whose build differs from the one
// this Playwright version downloads. Point at it instead of re-downloading.
const executablePath = process.env.BTG_E2E_CHROMIUM || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
  ],
  webServer: process.env.BTG_E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
