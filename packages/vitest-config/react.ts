import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import type { UserConfig } from "vite";

export function reactVitestConfig(config: UserConfig = {}) {
  return defineConfig({
    ...config,
    plugins: [...(config.plugins ?? []), react()],
    test: {
      ...config.test,
      coverage: {
        provider: "v8",
        thresholds: {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        ...config.test?.coverage,
      },
      environment: "jsdom",
    },
  });
}
