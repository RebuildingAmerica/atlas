import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Library build target: compiles `src/index.ts` to an ESM bundle in
 * `dist/lib/`, externalizing React so `app/` (which already provides it)
 * doesn't get a second copy bundled in.
 *
 * This target intentionally does not run Tailwind CSS processing — the
 * components only reference utility class names as plain strings, and the
 * consuming app's own Tailwind pipeline is responsible for generating the
 * matching CSS (see `src/styles/theme-tokens.css` for the token set a
 * consumer needs to reconcile with).
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/lib",
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
});
