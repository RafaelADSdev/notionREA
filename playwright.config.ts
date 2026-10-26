import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  preserveOutput: "never",
  use: { baseURL: "http://127.0.0.1:3000", trace: "off", screenshot: "off", ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm start --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: { NEXT_TELEMETRY_DISABLED: "1", ENABLE_COLLABORATION_SPIKE: "true" },
  },
});
