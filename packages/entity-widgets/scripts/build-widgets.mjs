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
// A widget whose vite build fails (e.g. because its `<name>.html` entry
// doesn't exist yet) fails this script immediately and loudly — it does not
// continue on to build the remaining widgets and rely solely on
// verify-widget-build.mjs to notice afterward.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WIDGET_NAMES } from "./widget-names.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

for (const name of WIDGET_NAMES) {
  const result = spawnSync(
    "vite",
    ["build", "--config", "vite.widget.config.ts"],
    {
      cwd: packageRoot,
      stdio: "inherit",
      env: { ...process.env, INPUT: `${name}.html` },
    },
  );

  if (result.status !== 0) {
    console.error(`Widget build failed for ${name}.html (see vite output above).`);
    process.exit(result.status ?? 1);
  }
}
