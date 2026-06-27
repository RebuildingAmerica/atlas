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
        "src/lib/generated/**",
        "src/routeTree.gen.ts",
        "tests/**",
        // Vite-only entry that pulls in `@vercel/config`; importing it in
        // vitest crashes outside the Vite runtime.
        "vercel.ts",
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
