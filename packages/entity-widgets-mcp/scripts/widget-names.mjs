// Single source of truth for every widget this package builds.
//
// Both scripts/build-widgets.mjs (drives the per-widget `vite build`
// invocations) and scripts/verify-widget-build.mjs (fails the build if any
// expected widget's HTML didn't actually get produced) import this same
// array — neither hand-maintains its own copy. Before this file existed,
// the two lists were hand-maintained in parallel with no shared source, and
// the failure modes weren't symmetric: forgetting to add a name here while
// a widget's `<name>.html` entry existed would build the widget with zero
// verification for it, a silent gap in the one script whose entire job is
// to catch silent gaps. Driving both scripts from this one array makes
// that specific drift structurally impossible — there's no longer a
// separate "build list" and "verify list" to fall out of sync.
//
// Adding a widget: add its name here, plus `<name>.html` and
// `src/widget-entries/<name>.entry.tsx` (see README.md's "Adding another
// widget" section), plus its resource wiring in
// `api/atlas/platform/mcp/widgets.py`/`server.py`.
export const WIDGET_NAMES = ["entity-card", "search-results", "connections-graph"];
