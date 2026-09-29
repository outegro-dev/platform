import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    // The package imports itself by name, as the apps do (tsconfig paths).
    alias: [
      { find: /^@outegro\/ui\/lib\/(.*)$/, replacement: `${src}/lib/$1.ts` },
      {
        find: /^@outegro\/ui\/(.*)$/,
        replacement: `${src}/components/$1.tsx`,
      },
    ],
  },
  test: {
    // Plain Node: the model is data, components are rendered to HTML.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // One pre-bundled file instead of thousands of icon modules per run.
    deps: {
      optimizer: {
        ssr: { enabled: true, include: ["@phosphor-icons/react"] },
      },
    },
  },
});
