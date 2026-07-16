import { reactVitestConfig } from "@rebuildingamerica/vitest-config/react";

export default reactVitestConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
