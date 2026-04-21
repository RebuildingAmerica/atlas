import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig, baseRules, typescriptEslint } from "./base.js";

/**
 * ESLint config for React/TanStack Start app code.
 *
 * Extends the shared base with browser globals and React hooks rules.
 *
 * Usage in app/eslint.config.js:
 *   import { reactConfig } from "@atlas/eslint-config/react";
 *   export default reactConfig(import.meta.dirname);
 */
export function reactConfig(tsconfigRootDir) {
  return [
    ...baseConfig,
    {
      languageOptions: {
        globals: {
          ...globals.browser,
          ...globals.node,
        },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: {
        "react-hooks": reactHooks,
        "@typescript-eslint": typescriptEslint.plugin,
      },
      rules: {
        ...baseRules,
        ...reactHooks.configs.recommended.rules,
        "no-console": ["warn", { allow: ["warn", "error"] }],
      },
    },
  ];
}
