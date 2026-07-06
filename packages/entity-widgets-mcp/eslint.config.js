import { reactConfig } from "@rebuildingamerica/eslint-config/react";

export default [
  {
    ignores: ["node_modules/", "dist/", "**/*.js"],
  },
  ...reactConfig(import.meta.dirname),
];
