import { atlasTestsPlugin } from "./test-rules/index.js";

/**
 * Override block for vitest test files in any Atlas TypeScript workspace.
 *
 * Wires up the shared `atlas-tests` plugin and turns its hygiene rules on
 * for `tests/**\/*.test.ts(x)`. Spread the result into the workspace's
 * eslint.config.js after the language-level config so the test-only
 * overrides apply last.
 *
 * Usage:
 *   import { testsConfig } from "@rebuildingamerica/eslint-config/tests";
 *   export default [...reactConfig(import.meta.dirname), ...testsConfig()];
 */
export function testsConfig() {
  return [
    {
      files: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
      plugins: { "atlas-tests": atlasTestsPlugin },
      rules: {
        "atlas-tests/no-banned-globals-in-tests": "error",
        "atlas-tests/no-test-file-locals": "error",
      },
    },
  ];
}
