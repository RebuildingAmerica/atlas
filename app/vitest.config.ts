import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    coverage: {
      exclude: [
        "coverage/**",
        "dist/**",
        "src/entry.client.tsx",
        "src/entry.server.tsx",
        "src/lib/generated/**",
        "src/router.tsx",
        "src/routes/**",
        "src/routeTree.gen.ts",
        "tests/**",
      ],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
