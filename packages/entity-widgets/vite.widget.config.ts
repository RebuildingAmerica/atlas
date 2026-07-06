import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Widget build target: bundles ONE widget's HTML entry into a single
 * self-contained `dist/widget/<name>.html` — every JS module and every CSS
 * rule inlined, no external `<script src>`/`<link href>` references.
 *
 * `vite-plugin-singlefile` does not support multiple HTML entry points in
 * one Rollup input — this is documented upstream as an explicit "wontfix"
 * (the plugin is designed around exactly one output file per build). So
 * rather than listing every widget in one `rollupOptions.input`, this config
 * reads which HTML file to build from the `INPUT` env var, and
 * `scripts/build-widgets.mjs` invokes `vite build --config
 * vite.widget.config.ts` once per name in `scripts/widget-names.mjs` — the
 * single source of truth for which widgets this package builds. Adding a
 * new widget means adding its name there; this config itself doesn't
 * change.
 *
 * `INPUT` has no default. A silent default (e.g. falling back to
 * `entity-card.html`) would let `vite build --config vite.widget.config.ts`
 * — run directly, bypassing `scripts/build-widgets.mjs` — quietly rebuild
 * only one widget with no error, while `emptyOutDir: false` (below) leaves
 * any other, now-stale widget file looking current. Per this repo's "no
 * fallbacks or silent defaults" convention, an unset `INPUT` fails the build
 * immediately and loudly instead.
 *
 * `emptyOutDir` is `false`: with multiple invocations of this same config
 * writing into the same `dist/widget/` directory in one `pnpm build` run,
 * `true` would let each later invocation delete the widget(s) built by the
 * earlier ones. `package.json`'s `build` script instead clears `dist/widget/`
 * itself once, before `scripts/build-widgets.mjs` runs, so a full build
 * still starts from a clean directory (no stale widgets from a
 * since-renamed or since-removed entry) without the invocations clobbering
 * each other. `scripts/verify-widget-build.mjs` runs after that as a
 * defense-in-depth backstop, failing the build if any expected widget's
 * HTML still isn't on disk despite every `vite build` reporting success.
 *
 * This is what gets served as the MCP App UI resource: hosts fetch each
 * built file and render it in a sandboxed iframe, so none of them can depend
 * on any separately-hosted asset.
 */
const inputFile = process.env.INPUT;
if (!inputFile) {
  throw new Error(
    "vite.widget.config.ts requires an INPUT env var naming the widget HTML " +
      "entry to build (e.g. INPUT=entity-card.html) — see " +
      "scripts/build-widgets.mjs for how this is invoked. There is no " +
      "default: silently building the wrong (or just one) widget is worse " +
      "than failing loudly.",
  );
}

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: "dist/widget",
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: fileURLToPath(new URL(`./${inputFile}`, import.meta.url)),
    },
  },
});
