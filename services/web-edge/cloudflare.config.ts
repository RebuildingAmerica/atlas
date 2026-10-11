import { bindings, defineConfig } from "cf/config";

// Exact assets and uncached proxying preserve deep links and private sessions.
export default defineConfig(({ mode }) => ({
  worker: {
    name:
      mode === "staging"
        ? "atlas-web-staging"
        : mode === "production"
          ? "atlas-web"
          : "atlas-web-candidate",
    entrypoint: "worker.ts",
    compatibilityDate: "2026-10-10",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
      headSamplingRate: 0.1,
      redactQueryString: true,
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: false,
    },
    env: {
      ASSETS: bindings.assets(),
      ATLAS_WEB_ORIGIN_URL: bindings.text(""),
      ATLAS_WEB_ORIGIN_SECRET: bindings.secret(),
    },
  },
}));
