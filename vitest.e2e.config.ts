import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/bin.e2e.test.ts"],
    // Spawning the bundled bin + a stdio MCP handshake needs headroom.
    testTimeout: 30_000,
  },
});
