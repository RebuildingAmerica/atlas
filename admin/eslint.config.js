import { reactConfig } from "@rebuildingamerica/eslint-config/react";
import { testsConfig } from "@rebuildingamerica/eslint-config/tests";

export default [
  {
    ignores: [
      "node_modules/",
      "coverage/",
      ".cloudflare/",
      ".output/",
      ".tanstack/",
      ".wrangler/",
      "src/generated/",
      "src/routeTree.gen.ts",
      "**/*.js",
      "**/*.mjs",
    ],
  },
  ...reactConfig(import.meta.dirname),
  ...testsConfig(),
  {
    // The admin and the Atlas app are separate deploy units: neither may reach
    // into the other (docs/standards/internal-apps.md).
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/app/src/**",
                "@rebuildingamerica/atlas-app",
                "@rebuildingamerica/atlas-app/*",
              ],
              message: "The platform admin must not import the Atlas app.",
            },
          ],
        },
      ],
    },
  },
];
