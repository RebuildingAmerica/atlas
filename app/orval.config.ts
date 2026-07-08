import { defineConfig } from "orval";

export default defineConfig({
  atlas: {
    input: {
      target: "../openapi/atlas.openapi.json",
    },
    output: {
      mode: "tags-split",
      target: "./src/lib/generated/atlas/index.ts",
      client: "fetch",
      clean: true,
      prettier: true,
      schemas: {
        path: "./src/lib/generated/atlas-schemas",
        splitByTags: true,
        indexFiles: false,
      },
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: "./src/lib/orval/fetcher.ts",
          name: "atlasFetch",
        },
      },
    },
  },
});
