import { nodeVitestConfig } from "@rebuildingamerica/vitest-config/node";

export default nodeVitestConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/**/*.test.ts"],
    },
  },
});
