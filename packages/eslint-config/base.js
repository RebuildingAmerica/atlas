import js from "@eslint/js";
import typescriptEslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * Shared base rules for all Atlas TypeScript code.
 *
 * This is the single source of truth for lint severity. App and scripts
 * configs extend this and only add directory-specific overrides (e.g.,
 * React hooks for app, no-console for scripts).
 */
export const baseConfig = [
  js.configs.recommended,
  ...typescriptEslint.configs.strictTypeChecked,
  ...typescriptEslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
];

export const baseRules = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/explicit-module-boundary-types": "off",
  "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
  "@typescript-eslint/restrict-template-expressions": "off",
  "@typescript-eslint/no-misused-spread": "off",
  "@typescript-eslint/no-unnecessary-condition": "off",
  "@typescript-eslint/prefer-nullish-coalescing": "off",
  "@typescript-eslint/no-deprecated": "off",
};

export { typescriptEslint };
