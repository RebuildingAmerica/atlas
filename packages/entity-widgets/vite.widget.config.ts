import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Widget build target: bundles `entity-card.html` into a single
 * self-contained `dist/widget/entity-card.html` — every JS module and every
 * CSS rule inlined, no external `<script src>`/`<link href>` references.
 *
 * This is what gets served as the MCP App UI resource (wired up in a later
 * task, not this one): hosts fetch this one file and render it in a
 * sandboxed iframe, so it cannot depend on any separately-hosted asset.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist/widget",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./entity-card.html", import.meta.url)),
    },
  },
});
