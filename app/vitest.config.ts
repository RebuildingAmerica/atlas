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
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
