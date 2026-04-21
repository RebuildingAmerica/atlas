import globals from "globals";
import { baseConfig, baseRules, typescriptEslint } from "./base.js";

/**
 * ESLint config for Node.js scripts and tools.
 *
 * Extends the shared base with Node globals. Same strict rules as the
 * app — no permissive overrides.
 *
 * Usage in eslint.config.js:
 *   import { nodeConfig } from "@atlas/eslint-config/node";
 *   export default nodeConfig(import.meta.dirname);
 */
export function nodeConfig(tsconfigRootDir) {
  return [
    ...baseConfig,
    {
      files: ["scripts/**/*.ts"],
      languageOptions: {
        globals: globals.node,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
      },
      rules: {
        ...baseRules,
        "no-console": "off",
      },
    },
  ];
}
