import { typescriptConfig } from "@rebuildingamerica/eslint-config/typescript";

export default [
  {
    ignores: ["node_modules/", "dist/", "src/generated/"],
  },
  ...typescriptConfig(import.meta.dirname),
];
