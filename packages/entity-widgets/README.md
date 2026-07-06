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
`package.json`'s `build` script runs `scripts/build-widgets.mjs`, which invokes
it once per name in `scripts/widget-names.mjs`:

```sh
rm -rf dist/widget \
  && node scripts/build-widgets.mjs \
  && node scripts/verify-widget-build.mjs
```

`scripts/widget-names.mjs` is the single source of truth for which widgets this
package builds — both `build-widgets.mjs` (the per-widget `vite build`
invocations) and `verify-widget-build.mjs` (the post-build check below) import
the same `WIDGET_NAMES` array rather than each keeping its own hand-maintained
copy, so the two can't drift apart on which widgets exist.

`dist/widget/` is cleared once up front — not via each `vite build` invocation's
own `emptyOutDir`, which is `false` — so building one widget doesn't delete
another's already-built output, while a full `pnpm build` still starts from a
clean directory (no stale widget file left over from a since-renamed or
since-removed entry). `build-widgets.mjs` itself fails immediately and loudly if
any single widget's `vite build` fails (e.g. a missing `<name>.html` entry);
`verify-widget-build.mjs` runs after it as a defense-in-depth backstop, failing
the build if any expected widget's `dist/widget/<name>.html` still isn't on disk
despite every `vite build` reporting success — so a missing widget is caught
here, in CI, rather than later as a `RuntimeError` from the API's
`resolve_widget_asset_dir` at request time.

### Adding another widget

1. Add `<name>.html` and `src/widget-entries/<name>.entry.tsx` (mirror the
   existing `entity-card`/`search-results`/`connections-graph` trio).
2. Add `"<name>"` to `WIDGET_NAMES` in `scripts/widget-names.mjs` — this alone
   is what makes both `build-widgets.mjs` build it and `verify-widget-build.mjs`
   verify it.
3. Add a `"<name>": "ui://atlas/<name>"` entry to `WIDGET_RESOURCES` in
   `api/atlas/platform/mcp/widgets.py`, and point the relevant tool's `meta=` at
   that URI in `api/atlas/platform/mcp/server.py`.

## Test convention

Tests are colocated next to the source they test (`entity-card.tsx` /
`entity-card.test.tsx`), not mirrored into a separate `tests/` tree. This
differs deliberately from `app/`'s convention — this is a small,
independently-versioned package where keeping a test next to its subject is
easier to navigate than a parallel directory structure.
