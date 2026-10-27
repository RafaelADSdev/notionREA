import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    setupFiles: ["./src/lib/i18n/test-request.ts", "./tests/dom-setup.ts"],
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/spikes/**/*.test.ts", "src/lib/i18n/**/*.test.ts"],
    restoreMocks: true,
    maxWorkers: 4,
  },
});
