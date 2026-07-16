import { reactConfig } from "@rebuildingamerica/eslint-config/react";

export default [
  {
    ignores: ["node_modules/", "dist/"],
  },
  ...reactConfig(import.meta.dirname),
];
