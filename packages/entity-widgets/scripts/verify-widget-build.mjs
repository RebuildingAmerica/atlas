#!/usr/bin/env node
// Fail the build if any of this package's widget bundles didn't actually get
// produced by `pnpm build`'s per-widget vite invocations.
//
// `package.json`'s build script chains one `INPUT=<name>.html vite build`
// invocation per widget (vite-plugin-singlefile can't build more than one
// HTML entry per config — see vite.widget.config.ts). Nothing about that
// chain fails if a future invocation is forgotten or the script gets
// reordered: `vite build` still exits 0 for every widget that *did* build,
// so `pnpm build` (and CI) would too. Without this check, a missing widget
// would only surface later as a RuntimeError from `resolve_widget_asset_dir`
// (api/atlas/platform/mcp/widgets.py) at request time in production, not in
// CI. Keep WIDGET_NAMES in sync with the INPUT=... invocations in
// package.json's build script and with WIDGET_RESOURCES in widgets.py.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WIDGET_NAMES = ["entity-card", "search-results"];

const distWidgetDir = fileURLToPath(new URL("../dist/widget/", import.meta.url));

const missing = WIDGET_NAMES.filter((name) => !existsSync(`${distWidgetDir}${name}.html`));

if (missing.length > 0) {
  console.error(
    `Widget build verification failed: missing built HTML for ${missing.join(", ")} in ` +
      `${distWidgetDir}. Check that package.json's build script has an ` +
      "INPUT=<name>.html vite build --config vite.widget.config.ts invocation for each " +
      "name in WIDGET_NAMES (scripts/verify-widget-build.mjs).",
  );
  process.exit(1);
}
