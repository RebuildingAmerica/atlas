# @rebuildingamerica/entity-widgets

Shared React components rendered both as MCP App UI widgets (rendered inline in
Claude and other compliant hosts) and inside Atlas's main web app: a compact
"entity card", a paginated "search results" list, and a "connections" list
showing which other Atlas entities are mechanically linked to a given one.

## Two build targets

- **Library** (`pnpm build` → `dist/lib/`): a normal ESM React library, consumed
  by `app/`. React/React DOM are external peer dependencies.
- **Widget** (`pnpm build` → `dist/widget/<name>.html`, one file per widget —
  currently `entity-card.html`, `search-results.html`, and
  `connections-graph.html`): each widget's HTML entry is built into its own
  single, fully self-contained file (all JS and CSS inlined via
  `vite-plugin-singlefile`) served as an MCP App UI resource.

See `vite.lib.config.ts` and `vite.widget.config.ts` for the two configs.

### Why the widget build runs once per widget

`vite-plugin-singlefile` only supports one HTML entry point per Vite config —
documented upstream as an explicit "wontfix." So `vite.widget.config.ts` reads
which HTML file to build from the `INPUT` env var (there's no default: an unset
`INPUT` fails the build immediately, since silently building the wrong widget —
or silently rebuilding only one of several — is worse than failing loudly), and
`package.json`'s `build` script invokes it once per widget:

```sh
rm -rf dist/widget \
  && INPUT=entity-card.html vite build --config vite.widget.config.ts \
  && INPUT=search-results.html vite build --config vite.widget.config.ts \
  && INPUT=connections-graph.html vite build --config vite.widget.config.ts \
  && node scripts/verify-widget-build.mjs
```

`dist/widget/` is cleared once up front — not via each config's own
`emptyOutDir`, which is `false` — so the three `INPUT=...` invocations don't
delete each other's output, while a full `pnpm build` still starts from a clean
directory (no stale widget file left over from a since-renamed or since-removed
entry). `scripts/verify-widget-build.mjs` runs last and fails the build if any
expected widget's `dist/widget/<name>.html` didn't actually get produced — e.g.
because an `INPUT=...` invocation was forgotten or the script got reordered — so
a missing widget is caught here, in CI, rather than later as a `RuntimeError`
from the API's `resolve_widget_asset_dir` at request time.

### Adding another widget

1. Add `<name>.html` and `src/widget-entries/<name>.entry.tsx` (mirror the
   existing `entity-card`/`search-results`/`connections-graph` trio).
2. Add one more `INPUT=<name>.html vite build --config vite.widget.config.ts`
   invocation to `package.json`'s `build` script, and add `"<name>"` to
   `WIDGET_NAMES` in `scripts/verify-widget-build.mjs`.
3. Add a `"<name>": "ui://atlas/<name>"` entry to `WIDGET_RESOURCES` in
   `api/atlas/platform/mcp/widgets.py`, and point the relevant tool's `meta=` at
   that URI in `api/atlas/platform/mcp/server.py`.

## Test convention

Tests are colocated next to the source they test (`entity-card.tsx` /
`entity-card.test.tsx`), not mirrored into a separate `tests/` tree. This
differs deliberately from `app/`'s convention — this is a small,
independently-versioned package where keeping a test next to its subject is
easier to navigate than a parallel directory structure.
