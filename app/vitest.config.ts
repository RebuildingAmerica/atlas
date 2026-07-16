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
    // Turbo runs app tests alongside the Python API, Scout, and package suites
    // during pre-push. Letting Vitest take every local core makes heavy route
    // imports starve and occasionally hit the 30s timeout even when the same
    // files pass in isolation. Capping workers keeps the suite stable under the
    // real gate and avoids burning CI minutes on retry-only failures.
    maxWorkers: "50%",
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
