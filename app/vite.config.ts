import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Suppress known noise from "use client" directives in third-party libraries
 * and circular chunk warnings from the server-side build.
 */
const onwarn = (warning: any, warn: any) => {
  if (warning.message?.includes('"use client"')) return;
  if (warning.message?.includes("Circular chunk")) return;
  warn(warning);
};

export default defineConfig({
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
});
