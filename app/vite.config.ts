import { defineConfig, loadEnv, type Rollup } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PUBLIC_ATLAS_ENV_KEYS = [
  "ATLAS_DEPLOY_MODE",
  "ATLAS_PUBLIC_URL",
  "ATLAS_MAP_STYLE_URL",
  "ATLAS_DOCS_URL",
  "ATLAS_AUTH_BASE_PATH",
  "ATLAS_SERVER_API_PROXY_TARGET",
] as const;

interface AtlasBuildEnv {
  ATLAS_DEPLOY_MODE?: string;
  ATLAS_MAP_STYLE_URL?: string;
  VERCEL_ENV?: string;
}

const PLACEHOLDER_MAP_STYLE_URL = "https://maptiler.invalid/maps/atlas-placeholder/style.json";

function isAtlasProductionBuild(env: AtlasBuildEnv): boolean {
  return env.ATLAS_DEPLOY_MODE === "production" || env.VERCEL_ENV === "production";
}

/**
 * Validates public environment values that would break primary discovery when
 * missing from a production Atlas deploy.
 *
 * @param env - Raw Vite-loaded environment values.
 */
export function validateProductionPublicEnv(env: AtlasBuildEnv): void {
  if (!isAtlasProductionBuild(env)) {
    return;
  }

  const mapStyleUrl = env.ATLAS_MAP_STYLE_URL?.trim();
  if (!mapStyleUrl) {
    throw new Error("ATLAS_MAP_STYLE_URL is required for production Atlas builds.");
  }

  if (mapStyleUrl === PLACEHOLDER_MAP_STYLE_URL) {
    throw new Error("ATLAS_MAP_STYLE_URL must not use the placeholder in production Atlas builds.");
  }

  if (!/^https?:\/\//.test(mapStyleUrl)) {
    throw new Error("ATLAS_MAP_STYLE_URL must be an absolute http(s) URL.");
  }
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
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
  };
});
