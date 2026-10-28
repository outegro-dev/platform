import { defineConfig } from "vitest/config";

// The uniformity test rolls 150 000 rounds through WebCrypto: seconds locally,
// several times longer on a busy CI runner.
export default defineConfig({
  test: {
    testTimeout: 120_000,
  },
});
