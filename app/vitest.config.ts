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
        // Server-only modules that depend on the Better Auth runtime,
        // Postgres/SQLite handles, or external service SDKs.  These are
        // covered by acceptance + contract suites instead of unit tests.
        "src/domains/access/server/auth.tsx",
        "src/domains/access/server/atlas-migrations.ts",
        "src/domains/access/server/runtime.ts",
        "src/domains/access/server/sso-provider-store.ts",
        "src/domains/access/server/workspace-lookup.ts",
        "src/domains/access/server/workspace-products.ts",
        "src/domains/billing/server/stripe-client.ts",
        "src/domains/billing/server/stripe-customer.ts",
        // TanStack Start server functions are exercised end-to-end by the
        // acceptance suite; unit-testing them requires reproducing the
        // server-fn runtime.
        "src/**/*.functions.ts",
        // Vite-only entry; cannot import in vitest without spinning up Vite.
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
