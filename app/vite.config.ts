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
  "ATLAS_DEPLOY_MODE",
  "ATLAS_PUBLIC_URL",
  "ATLAS_DOCS_URL",
  "ATLAS_AUTH_BASE_PATH",
  "ATLAS_SERVER_API_PROXY_TARGET",
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

export function buildHostedProxyRouteRules(env: HostedAtlasEnv): NitroRouteRules {
  const docsOrigin = normalizeDocsOrigin(env.ATLAS_DOCS_URL);
  const apiOrigin = normalizeApiProxyOrigin(env);
  const rules: NitroRouteRules = {};

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
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
      tanstackStart(),
      nitro({
        rollupConfig: {
          onwarn,
        },
        vercel: {
          functions: {
            maxDuration: 30,
          },
          regions: ["cle1"],
        },
        routeRules: buildHostedProxyRouteRules(env),
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      chunkSizeWarningLimit: 1000,
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
