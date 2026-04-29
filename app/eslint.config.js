import { reactConfig } from "@atlas/eslint-config/react";
import atlasTests from "./eslint-rules/index.js";

export default [
  {
    ignores: [
      "node_modules/",
      "dist/",
      ".output/",
      ".vinxi/",
      ".nitro/",
      "src/lib/generated/",
      "src/routeTree.gen.ts",
      "tests/unit/domains/access/client/use-atlas-session.test.tsx",
      "**/*.js",
    ],
  },
  ...reactConfig(import.meta.dirname),
  {
    files: ["src/routes/**/*.tsx", "src/domains/**/route-guard.ts"],
    rules: {
      "@typescript-eslint/only-throw-error": "off",
    },
  },
  {
    files: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    plugins: { "atlas-tests": atlasTests },
    rules: {
      "atlas-tests/no-test-file-locals": "error",
      "atlas-tests/no-banned-globals-in-tests": "error",
    },
  },
];
