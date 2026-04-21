import { nodeConfig } from "@atlas/eslint-config/node";

export default [
  {
    ignores: ["node_modules/", "app/", "api/", "**/*.js"],
  },
  ...nodeConfig(import.meta.dirname),
];
