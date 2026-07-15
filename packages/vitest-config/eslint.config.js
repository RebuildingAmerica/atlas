import { typescriptConfig } from "@rebuildingamerica/eslint-config/typescript";

export default [
  {
    ignores: ["node_modules/", "dist/", "**/*.js"],
  },
  ...typescriptConfig(import.meta.dirname),
];
