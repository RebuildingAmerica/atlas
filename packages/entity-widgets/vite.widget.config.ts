import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const DEFAULT_WIDGET_ENTRY = "entity-card.html";

/**
 * Widget build target: bundles ONE widget's HTML entry into a single
 * self-contained `dist/widget/<name>.html` — every JS module and every CSS
 * rule inlined, no external `<script src>`/`<link href>` references.
 *
 * `vite-plugin-singlefile` does not support multiple HTML entry points in
 * one Rollup input — this is documented upstream as an explicit "wontfix"
 * (the plugin is designed around exactly one output file per build). So
 * rather than listing every widget in one `rollupOptions.input`, this config
 * reads which HTML file to build from the `INPUT` env var, and `package.json`'s
 * `build` script invokes `vite build --config vite.widget.config.ts` once per
 * widget, e.g. `INPUT=search-results.html vite build --config
 * vite.widget.config.ts`. Adding a new widget means adding one more such
 * invocation to that script — this config itself doesn't change.
 *
 * `emptyOutDir` is `false`: with multiple invocations of this same config
 * writing into the same `dist/widget/` directory in one `pnpm build` run,
 * `true` would let each later invocation delete the widget(s) built by the
 * earlier ones. `package.json`'s `build` script instead clears `dist/widget/`
 * itself once, before the first `INPUT=...` invocation, so a full build still
 * starts from a clean directory (no stale widgets from a since-renamed or
 * since-removed entry) without the invocations clobbering each other.
 *
 * This is what gets served as the MCP App UI resource: hosts fetch each
 * built file and render it in a sandboxed iframe, so none of them can depend
 * on any separately-hosted asset.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist/widget",
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: fileURLToPath(
        new URL(`./${process.env.INPUT ?? DEFAULT_WIDGET_ENTRY}`, import.meta.url),
      ),
    },
  },
});
