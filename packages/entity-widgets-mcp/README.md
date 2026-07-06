# @rebuildingamerica/entity-widgets-mcp

The MCP App adapter/bootstrap layer and widget-bundling build tooling for
`@rebuildingamerica/entity-widgets`'s components: the host-communication hooks
(`src/adapters/`) that connect a widget to the MCP Apps host, parse its tool
result, and support pagination; the mount entry points (`src/widget-entries/`)
that render each component into its widget HTML page; and the Vite config and
scripts that bundle each one into a single self-contained
`dist/widget/<name>.html`.

This package has **no `exports` field**, deliberately: nothing ever imports it
as a JS module. Its only consumer is `api/Dockerfile`, which copies the built
`dist/widget/*.html` files off the filesystem directly to serve as MCP App UI
resources — there's no code-level import path to keep working, so there's
nothing to declare in `exports`.

## Why the widget build runs once per widget

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
