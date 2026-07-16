import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@",
        replacement: resolve(__dirname, "src"),
      },
    ],
  },
  test: {
    coverage: {
      exclude: [
        "coverage/**",
        "dist/**",
        "src/lib/generated/**",
        "src/routeTree.gen.ts",
        "tests/**",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    environment: "node",
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    setupFiles: ["tests/setup.ts"],
    // The route-heavy app suite has shared module/mock edges that are safe when
    // each file owns the process in order, but can deadlock dynamic route
    // imports under Vitest's file-level worker pool. Keep app parallelism at the
    // Turbo package boundary until those route harnesses are isolated further.
    maxWorkers: 1,
    // The pre-push gate runs every workspace's suite concurrently via Turbo;
    // under that CPU contention the heaviest auth-flow tests drift just past
    // vitest's 5s default and time out. A generous ceiling keeps a green suite
    // from flaking — a genuinely broken test still fails fast, not via timeout.
    testTimeout: 30_000,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
      "tests/integration/**/*.test.tsx",
      "tests/e2e/**/*.test.ts",
      "tests/e2e/**/*.test.tsx",
    ],
  },
});
