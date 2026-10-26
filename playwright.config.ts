import { defineConfig, devices } from "@playwright/test";
import { loadTestEnvironment } from "./scripts/test-stack.mjs";

const environment = loadTestEnvironment();
Object.assign(process.env, environment);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  preserveOutput: "never",
  use: { baseURL: "http://127.0.0.1:3001", trace: "off", screenshot: "off", ...devices["Desktop Chrome"] },
  webServer: {
    command: "node scripts/test-stack.mjs server",
    url: "http://127.0.0.1:3001/login",
    reuseExistingServer: false,
    timeout: 60000,
    env: { ...environment, NEXT_TELEMETRY_DISABLED: "1" },
  },
});
