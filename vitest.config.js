import { defineConfig } from "vitest/config";

// Server tests only; kept separate from vite.config.ts so the React plugin
// is not loaded.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // The first run downloads a MongoDB binary for mongodb-memory-server.
    hookTimeout: 180000,
    testTimeout: 30000,
  },
});
