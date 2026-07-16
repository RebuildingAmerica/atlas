import { nodeVitestConfig } from "@rebuildingamerica/vitest-config/node";

export default nodeVitestConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
