import { defineConfig, loadEnv, type Rollup } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro, type NitroPluginConfig } from "nitro/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHostedRewriteDestination,
  normalizeApiProxyOrigin,
  normalizeDocsOrigin,
  validateHostedAtlasEnv,
  type HostedAtlasEnv,
} from "./src/platform/config/hosted-env";

const __dirname = dirname(fileURLToPath(import.meta.url));
type NitroRouteRules = NonNullable<NitroPluginConfig["routeRules"]>;

export const PUBLIC_ATLAS_ENV_KEYS = [
  "ATLAS_ADMIN_PUBLIC_URL",
  "ATLAS_MANAGED",
  "ATLAS_MULTI_USER",
  "ATLAS_PUBLIC_URL",
  "ATLAS_WEB_CANONICAL_URL",
  "ATLAS_DOCS_URL",
  "ATLAS_AUTH_BASE_PATH",
  "ATLAS_SERVER_API_PROXY_TARGET",
  "VITE_CF_WEB_ANALYTICS_TOKEN",
] as const;

const DOCS_SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

/**
 * Validates public environment values that would break primary discovery when
 * missing from a production Atlas deploy.
 *
 * @param env - Raw Vite-loaded environment values.
 */
function validateProductionPublicEnv(env: HostedAtlasEnv): void {
  validateHostedAtlasEnv(env);
}

/**
 * Pages that moved to the Atlas platform admin. An old bookmark or email link
 * lands on the admin's own page instead of a 404.
 */
const PLATFORM_ADMIN_PAGES: Record<string, string> = {
  "/admin/cloud-costs": "/cloud-costs",
  "/admin/discounts": "/discounts",
  "/admin/waitlist": "/waitlist",
};

/**
 * Every old /admin address lands somewhere real. The instance's editorial
 * pages moved to /editorial, so "admin" can mean only the platform admin;
 * the more specific platform rules win over this catch-all.
 */
const EDITORIAL_REDIRECTS: NitroRouteRules = {
  "/admin": { redirect: { to: "/editorial", status: 308 } },
  "/admin/**": { redirect: { to: "/editorial/**", status: 308 } },
};

export function buildHostedProxyRouteRules(env: HostedAtlasEnv): NitroRouteRules {
  const docsOrigin = normalizeDocsOrigin(env.ATLAS_DOCS_URL);
  const apiOrigin = normalizeApiProxyOrigin(env);
  const adminOrigin = env.ATLAS_ADMIN_PUBLIC_URL?.trim()
    ? new URL(env.ATLAS_ADMIN_PUBLIC_URL.trim()).origin
    : null;
  const rules: NitroRouteRules = { ...EDITORIAL_REDIRECTS };

  if (adminOrigin) {
    for (const [from, to] of Object.entries(PLATFORM_ADMIN_PAGES)) {
      rules[from] = { redirect: { to: `${adminOrigin}${to}`, status: 308 } };
      rules[`${from}/**`] = { redirect: { to: `${adminOrigin}${to}/**`, status: 308 } };
    }
  }

  if (docsOrigin) {
    rules["/docs"] = {
      headers: DOCS_SECURITY_HEADERS,
      proxy: buildHostedRewriteDestination(docsOrigin, "/docs"),
    };
    rules["/docs/**"] = {
      headers: DOCS_SECURITY_HEADERS,
      proxy: buildHostedRewriteDestination(docsOrigin, "/docs/**"),
    };
  }

  if (apiOrigin) {
    rules["/mcp"] = {
      proxy: buildHostedRewriteDestination(apiOrigin, "/mcp/"),
    };
    rules["/mcp/**"] = {
      proxy: buildHostedRewriteDestination(apiOrigin, "/mcp/**"),
    };
    rules["/api/entities"] = {
      proxy: buildHostedRewriteDestination(apiOrigin, "/api/entities"),
    };
    rules["/api/entities/**"] = {
      proxy: buildHostedRewriteDestination(apiOrigin, "/api/entities/**"),
    };
  }

  return rules;
}

const onwarn: Rollup.WarningHandlerWithDefault = (warning, defaultHandler) => {
  if (warning.message?.includes('"use client"')) return;
  if (warning.message?.includes("Circular chunk")) return;
  defaultHandler(warning);
};

/** Select explicit Workers entrypoints while preserving the ordinary Node build. */
export function workersExecutionEntry(runtime: string, execution: string): string | undefined {
  if (runtime !== "node" && runtime !== "workers")
    throw new Error("ATLAS_WEB_RUNTIME must be node or workers.");
  if (!["direct", "durable-evaluation", "durable-production"].includes(execution))
    throw new Error(
      "ATLAS_WORKERS_EXECUTION must be direct, durable-evaluation or durable-production.",
    );
  if (execution !== "direct" && runtime !== "workers")
    throw new Error("Durable Object execution requires the Workers build.");
  return execution === "direct" ? undefined : `server/${execution}.ts`;
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const runtime = process.env.ATLAS_WEB_RUNTIME ?? env.ATLAS_WEB_RUNTIME ?? "node";
  const execution = process.env.ATLAS_WORKERS_EXECUTION ?? "direct";
  const durableEntrypoint = workersExecutionEntry(runtime, execution);
  const runtimePlugins =
    runtime === "workers"
      ? [
          {
            name: "atlas-workers-database",
            enforce: "pre" as const,
            resolveId(source: string, importer: string | undefined) {
              if (source === "./auth-db" && importer?.includes("/domains/access/server/"))
                return resolve(__dirname, "server/auth-db.workers.ts");
              return null;
            },
          },
          (await import("@cloudflare/vite-plugin")).cloudflare({
            viteEnvironment: { name: "ssr" },
            types: { generate: false },
            ...(durableEntrypoint
              ? {
                  config: (config) => ({
                    entrypoint: durableEntrypoint,
                    exports: { AtlasAppRuntime: { type: "durable-object", storage: "sqlite" } },
                    env: {
                      ...config.env,
                      ATLAS_WORKERS_EXECUTION: { type: "text", value: execution },
                      APP_RUNTIME: {
                        type: "durable-object",
                        worker: config.name,
                        exportName: "AtlasAppRuntime",
                      },
                    },
                  }),
                }
              : {}),
          }),
        ]
      : [
          nitro({
            rollupConfig: { onwarn },
            routeRules: buildHostedProxyRouteRules(env),
          }),
        ];
  validateProductionPublicEnv(env);
  const define: Record<string, string> = {};
  for (const key of PUBLIC_ATLAS_ENV_KEYS) {
    if (env[key] !== undefined) {
      define[`import.meta.env.${key}`] = JSON.stringify(env[key]);
    }
  }

  return {
    define,
    plugins: [
      ...(runtime === "workers" ? runtimePlugins : []),
      tanstackStart(
        runtime === "workers"
          ? {
              // These public documents contain no visitor data. Build their
              // existing SSR HTML once so opening them consumes no Worker CPU.
              // Profiles, account flows and server functions keep live routing.
              pages: [{ path: "/" }, { path: "/privacy" }],
              prerender: {
                enabled: true,
                autoStaticPathsDiscovery: false,
                crawlLinks: false,
                failOnError: true,
                retryCount: 0,
              },
            }
          : undefined,
      ),
      ...(runtime === "node" ? runtimePlugins : []),
      react(),
      tailwindcss(),
    ],
    build: {
      chunkSizeWarningLimit: 1000,
      ...(runtime === "workers" ? { minify: true as const } : {}),
      rollupOptions: {
        onwarn,
      },
    },
    server: {
      proxy: {
        "/api": {
          target: process.env.ATLAS_DEV_API_PROXY_TARGET,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    resolve: {
      alias: [
        {
          find: /^maplibre-gl$/,
          replacement: resolve(__dirname, "node_modules/maplibre-gl/dist/maplibre-gl-csp.js"),
        },
        {
          find: "@",
          replacement: resolve(__dirname, "src"),
        },
      ],
    },
  };
});
