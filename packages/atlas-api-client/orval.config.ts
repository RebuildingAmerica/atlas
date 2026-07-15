import { defineConfig } from "orval";

export default defineConfig({
  atlas: {
    input: {
      target: "../../openapi/atlas.openapi.json",
    },
    output: {
      mode: "tags-split",
      target: "./src/generated/atlas/index.ts",
      client: "fetch",
      clean: true,
      schemas: {
        path: "./src/generated/atlas-schemas",
        splitByTags: true,
      },
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: "./src/orval/fetcher.ts",
          name: "atlasFetch",
        },
      },
    },
  },
});
