# @rebuildingamerica/entity-widgets

Shared React components rendered both as MCP App UI widgets (rendered inline in
Claude and other compliant hosts) and inside Atlas's main web app: a compact
"entity card", a paginated "search results" list, and a "connections" list
showing which other Atlas entities are mechanically linked to a given one.

## UI-only library

This package is a normal ESM React library, built via `vite.lib.config.ts` into
`dist/lib/`. React and React DOM are external peer dependencies — this package
never bundles its own copy, since `app/` (its only consumer as a library)
already provides one.

These components also get bundled into standalone, self-contained HTML files
served as MCP App UI widgets. That bundling — the MCP Apps host-communication
adapters, the widget mount entries, and the widget-specific build tooling —
lives in the sibling package `../entity-widgets-mcp`, which depends on this
package via `workspace:*`. See that package's README for how the widget build
works.

## Test convention

Tests are colocated next to the source they test (`entity-card.tsx` /
`entity-card.test.tsx`), not mirrored into a separate `tests/` tree. This
differs deliberately from `app/`'s convention — this is a small,
independently-versioned package where keeping a test next to its subject is
easier to navigate than a parallel directory structure.
