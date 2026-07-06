#!/usr/bin/env node
// Fail the build if any of this package's widget bundles didn't actually get
// produced by scripts/build-widgets.mjs's per-widget vite invocations.
//
// This is a defense-in-depth backstop, not the primary safeguard:
// build-widgets.mjs already fails loudly and immediately if a given
// widget's own `vite build` invocation fails (e.g. because its `<name>.html`
// entry is missing). This script instead catches the case where every `vite
// build` reported success but the expected output still isn't on disk —
// e.g. a future bug in build-widgets.mjs itself, or a manual/partial
// `dist/widget/` cleanup between the build and this check.
//
// Imports WIDGET_NAMES from scripts/widget-names.mjs — the single source of
// truth also read by build-widgets.mjs — rather than keeping its own
// hand-maintained copy of the widget list. Before this shared import
// existed, a name added to one list but not the other could build (or fail
// to build) with no verification catching the gap; importing the same array
// both scripts consume makes that specific drift impossible.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WIDGET_NAMES } from "./widget-names.mjs";

const distWidgetDir = fileURLToPath(new URL("../dist/widget/", import.meta.url));

const missing = WIDGET_NAMES.filter((name) => !existsSync(`${distWidgetDir}${name}.html`));

if (missing.length > 0) {
  console.error(
    `Widget build verification failed: missing built HTML for ${missing.join(", ")} in ` +
      `${distWidgetDir}. Check that scripts/widget-names.mjs lists every widget this package ` +
      "builds, and that scripts/build-widgets.mjs successfully built each one.",
  );
  process.exit(1);
}
