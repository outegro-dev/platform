import { defineConfig } from "vitest/config";

// One stack of real services for the whole file: tests run in order.
export default defineConfig({
  test: {
    testTimeout: 180_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
