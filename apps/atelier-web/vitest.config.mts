import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Scoring, SQL result comparison, the inline renderer and the catalog
    // are framework-agnostic: plain Node.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
