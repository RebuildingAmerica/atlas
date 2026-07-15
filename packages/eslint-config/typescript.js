import { baseConfig, baseRules, typescriptEslint } from "./base.js";

/**
 * ESLint config for strict, typed TypeScript library packages.
 *
 * Use this for workspace packages that are neither React apps nor Node-only
 * scripts. Package-level configs should supply ignores only, then spread this
 * preset so parser and rule behavior remains centralized.
 */
export function typescriptConfig(tsconfigRootDir) {
  return [
    ...baseConfig,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
      },
      rules: baseRules,
    },
  ];
}
