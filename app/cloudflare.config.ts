import { bindings, defineConfig } from "cf/config";

// Preserve request-scoped identity and source-linked SSR on Workers Free.
export default defineConfig({
  worker: {
    name: "atlas-app-candidate",
    compatibilityDate: "2026-10-10",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "server/worker.ts",
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
      headSamplingRate: 0.1,
      redactQueryString: true,
    },
    env: {
      NODE_ENV: bindings.text("production"),
      ATLAS_AUTH_MIGRATIONS: bindings.text("external"),
      ATLAS_DOCS_URL: bindings.text(""),
      ATLAS_API_ROUTE_PREFIX: bindings.text<"" | "/atlas">(""),
      ATLAS_SERVER_API_PROXY_TARGET: bindings.text(""),
      ATLAS_AUTH_INTERNAL_SECRET: bindings.secret(),
      HYPERDRIVE: bindings.hyperdrive({
        id: "00000000000000000000000000000000",
        dev: {
          connectionString: "postgres://atlas:atlas@127.0.0.1:5432/atlas",
        },
      }),
    },
  },
});
