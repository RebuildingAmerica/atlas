#!/usr/bin/env node
// Builds every widget bundle listed in WIDGET_NAMES (scripts/widget-names.mjs
// — the single source of truth for which widgets this package builds) into
// its own self-contained dist/widget/<name>.html.
//
// `vite-plugin-singlefile` only supports one HTML entry point per Vite
// config — documented upstream as an explicit "wontfix" (see
// vite.widget.config.ts) — so this spawns one `vite build --config
// vite.widget.config.ts` per name, with `INPUT=<name>.html` set for that
// invocation. Adding a widget now means adding its name to WIDGET_NAMES
// exactly once; this script (and scripts/verify-widget-build.mjs, which
// runs after it) automatically pick it up without either needing a matching
// hand-edited invocation of its own.
//
// Each widget's build is fully independent (different `INPUT`, different
// output file — `vite.widget.config.ts` sets `emptyOutDir: false` for
// exactly this reason), so all of them run concurrently rather than one
// after another. If any fail, this script reports every failure (not just
// the first) and exits non-zero; it does not rely solely on
// verify-widget-build.mjs to notice afterward.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WIDGET_NAMES } from "./widget-names.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** @returns {Promise<{ name: string, code: number | null }>} */
function buildWidget(name) {
  return new Promise((resolve) => {
    const child = spawn(
      "vite",
      ["build", "--config", "vite.widget.config.ts"],
      {
        cwd: packageRoot,
        stdio: "inherit",
        env: { ...process.env, INPUT: `${name}.html` },
      },
    );
    child.on("exit", (code) => resolve({ name, code }));
  });
}

const results = await Promise.all(WIDGET_NAMES.map(buildWidget));

const failed = results.filter((result) => result.code !== 0);
if (failed.length > 0) {
  for (const { name, code } of failed) {
    console.error(
      `Widget build failed for ${name}.html (exit code ${code}, see vite output above).`,
    );
  }
  process.exit(1);
}
