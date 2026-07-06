import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        // Widget-only mount script: executes side effects at import time
        // (createRoot(...).render(...)) and delegates all real logic to
        // `useEntityCardData` and `EntityCard`, both fully covered on their
        // own. Mirrors the precedent in app/vitest.config.ts for excluding
        // Vite-only entry points that aren't meaningfully unit-testable.
        "src/widget-entries/**",
        // Shared test fixtures/mocks (FakeApp, fixture payloads) imported
        // only by *.test.ts files in src/adapters/ — test infrastructure,
        // not shipped library or widget code, so it isn't held to the same
        // coverage gate as production source.
        "src/adapters/test-support/**",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
