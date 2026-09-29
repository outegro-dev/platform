import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Client, stores and formatting are framework-agnostic: plain Node.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
