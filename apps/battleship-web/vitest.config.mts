import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Stores and the socket are framework-agnostic: plain Node, fake timers.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
