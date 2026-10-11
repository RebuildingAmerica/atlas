import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      // The Workers runtime module does not exist under Node; tests supply its settings.
      {
        find: "cloudflare:workers",
        replacement: resolve(__dirname, "tests/helpers/cloudflare-workers.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    env: { TZ: "UTC" },
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx", "cloudflare.config.ts"],
      exclude: ["src/generated/**", "src/routeTree.gen.ts", "src/env.d.ts"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
