import { defineConfig } from "orval";

/**
 * The platform admin calls only the platform routes, described in their own
 * OpenAPI document (`pnpm run openapi` writes both). Every call goes through
 * `platformFetch`, which signs it as the admin app and forwards the
 * operator's Cloudflare Access sign-in.
 */
export default defineConfig({
  platform: {
    input: {
      target: "../openapi/atlas-platform.openapi.json",
    },
    output: {
      mode: "single",
      target: "./src/generated/platform-api.ts",
      schemas: "./src/generated/platform-schemas",
      client: "fetch",
      clean: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: "./src/server/platform-fetch.ts",
          name: "platformFetch",
        },
      },
    },
  },
});
