import { reactConfig } from "@atlas/eslint-config/react";

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
];
