import { defineConfig } from "vitest/config";

// Engine tests play thousands of seeded games and placements: CPU-bound work
// that takes seconds locally and several times longer on a busy CI runner.
export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});
