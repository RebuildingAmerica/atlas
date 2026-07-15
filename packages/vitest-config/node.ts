import { defineConfig } from "vitest/config";
import type { UserConfig } from "vite";

export function nodeVitestConfig(config: UserConfig = {}) {
  return defineConfig({
    ...config,
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
      environment: "node",
    },
  });
}
