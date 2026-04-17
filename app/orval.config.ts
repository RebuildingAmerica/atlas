import { defineConfig } from "orval";

export default defineConfig({
  atlas: {
    input: {
      target: "../openapi/atlas.openapi.json",
    },
    output: {
      target: "./src/lib/generated/atlas.ts",
      client: "fetch",
      clean: true,
      prettier: true,
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
