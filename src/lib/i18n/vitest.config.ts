import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/lib/i18n/**/*.test.ts"], maxWorkers: 1, restoreMocks: true },
});
