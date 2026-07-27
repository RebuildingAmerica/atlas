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
      // Without this, vitest reports only files a test happens to import, so a
      // source file nobody tests is absent from the denominator entirely and
      // deleting its last test *raises* coverage. Name the product surface
      // explicitly and let the thresholds mean what they say.
      include: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts"],
      exclude: [
        "coverage/**",
        "dist/**",
        "src/lib/generated/**",
        "src/routeTree.gen.ts",
        "src/vite-env.d.ts",
        "tests/**",
        // Exercised outside vitest. Each of these has a real gate, just not this
        // one -- excluding them keeps the number about product code.
        //
        // hosted-e2e + its route: Playwright, playwright.hosted-identity.config.ts
        "src/domains/access/server/hosted-e2e.ts",
        "src/routes/api/e2e/**",
        // scripts/e2e: the `test:acceptance`, `e2e:mail` and `e2e:cleanup` scripts
        "scripts/e2e/**",
        // screenshots + route-tree generation: `screenshots` and `predev`/`prebuild`
        "scripts/screenshots.mjs",
        "scripts/generate-route-tree.mjs",
      ],
      thresholds: {
        // Never lower these to land a change. `coverage.include` above names the
        // whole product surface, so an untested file counts against this number
        // rather than dropping out of the report.
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    // Call history is reset between tests centrally rather than by a per-file
    // `clearAllMocks`; implementations survive, so describe-level setup still
    // holds. Env and global stubs unwind the same way.
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    environment: "node",
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    // Dates render in the reader's own zone once the browser hydrates, so a
    // suite that inherited the developer's clock would assert different text on
    // a laptop in Dallas than on a CI runner already in UTC.
    env: {
      TZ: "UTC",
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
      "tests/e2e/**/*.test.ts",
      "tests/e2e/**/*.test.tsx",
    ],
  },
});
