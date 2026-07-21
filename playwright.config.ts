import { defineConfig, devices, type ReporterDescription } from "@playwright/test";

const port = 4173;
const structuredReport = process.env.GT_PLAYWRIGHT_JSON_OUTPUT;
const reporters: ReporterDescription[] = [[process.env.CI || structuredReport ? "line" : "list"]];
if (structuredReport) reporters.push(["json", { outputFile: structuredReport }]);
if (process.env.CI) reporters.push(["html", { open: "never" }]);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: reporters,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "compact-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 920, height: 720 } },
    },
  ],
});
