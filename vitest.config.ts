import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // bin.e2e needs a built dist/ — it runs via `pnpm test:e2e` (own config).
    exclude: ["**/node_modules/**", "test/bin.e2e.test.ts"],
  },
});
