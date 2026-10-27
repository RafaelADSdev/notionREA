import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser-local",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: "list",
  preserveOutput: "never",
  use: { baseURL: "http://127.0.0.1:3002", trace: "off", screenshot: "off", ...devices["Desktop Chrome"] },
  webServer: {
    command: "node scripts/local-browser-test.mjs",
    url: "http://127.0.0.1:3002",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
