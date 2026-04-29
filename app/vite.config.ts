import { defineConfig, loadEnv, type Rollup } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PUBLIC_ATLAS_ENV_KEYS = [
  "ATLAS_DEPLOY_MODE",
  "ATLAS_PUBLIC_URL",
  "ATLAS_DOCS_URL",
  "ATLAS_AUTH_BASE_PATH",
  "ATLAS_SERVER_API_PROXY_TARGET",
] as const;

const onwarn: Rollup.WarningHandlerWithDefault = (warning, defaultHandler) => {
  if (warning.message?.includes('"use client"')) return;
  if (warning.message?.includes("Circular chunk")) return;
  defaultHandler(warning);
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
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
