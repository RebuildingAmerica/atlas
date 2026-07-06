# @rebuildingamerica/entity-widgets

Shared React components for rendering a compact "entity card" — used both as an
MCP App UI widget (rendered inline in Claude and other compliant hosts) and
inside Atlas's main web app.

## Two build targets

- **Library** (`pnpm build` → `dist/lib/`): a normal ESM React library, consumed
  by `app/`. React/React DOM are external peer dependencies.
- **Widget** (`pnpm build` → `dist/widget/entity-card.html`): a single, fully
  self-contained HTML file (all JS and CSS inlined via `vite-plugin-singlefile`)
  served as an MCP App UI resource.

See `vite.lib.config.ts` and `vite.widget.config.ts` for the two configs.

## Test convention

Tests are colocated next to the source they test (`entity-card.tsx` /
`entity-card.test.tsx`), not mirrored into a separate `tests/` tree. This
differs deliberately from `app/`'s convention — this is a small,
independently-versioned package where keeping a test next to its subject is
easier to navigate than a parallel directory structure.
