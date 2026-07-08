# Scout Production Dry Run

Use this checklist before Scout release work. It proves the production CLI can
run discovery, use bounded browser fallback, and sync reviewed artifacts without
cutting a tag, publishing a GitHub release, or updating the Homebrew tap.

## What This Checks

- The production `scout` command imports and shows the expected command surface.
- Local model, database, Atlas URL, search, and sync readiness are visible.
- Direct URL runs create canonical local artifacts.
- Search-backed place and issue runs can discover new sources.
- JavaScript-rendered pages use headless Playwright only when needed.
- Sync can authenticate against `https://atlas.rebuildingus.org`.

This is not the release checklist. Use
[scout-homebrew-tap.md](scout-homebrew-tap.md) only after this dry run passes.

## Local Gates

Run these from the Atlas repo root:

```bash
uv --directory scout run ruff check .
uv --directory scout run mypy src
uv --directory scout run pytest
pnpm exec turbo run @rebuildingamerica/atlas-shared#test @rebuildingamerica/atlas-discovery-engine#test @rebuildingamerica/atlas-scout#test
pnpm release:homebrew:test
```

`uv --directory scout run pytest` is the normal Scout test gate. Coverage is an
explicit separate check:

```bash
cd scout
pnpm run test:coverage
```

## Environment Readiness

Confirm the CLI and database path:

```bash
uv --directory scout run scout --help
uv --directory scout run scout db path
```

Prepare a real local profile:

```bash
uv --directory scout run scout setup
uv --directory scout run scout config model
uv --directory scout run scout search connect
uv --directory scout run scout login --atlas-url https://atlas.rebuildingus.org
```

For automation, use environment variables instead of committing secrets:

```bash
export SEARCH_API_KEY=...
export ATLAS_API_KEY=...
```

Check the target environment:

```bash
uv --directory scout run scout doctor --atlas-url https://atlas.rebuildingus.org --json
```

Required capabilities before continuing:

- `direct-url-runs.ready` is `true`.
- `search-discovery.ready` is `true` for place-and-issue runs.
- `atlas-sync.ready` is `true` before any sync command.

If sync shows `HTTP 401`, rerun
`scout login --atlas-url https://atlas.rebuildingus.org` or set `ATLAS_API_KEY`
for the shell.

## Discovery Dry Run

Pick one source URL from the city or news site being tested. The source should
be public, recent, and relevant to a real Atlas issue area.

Direct URL run:

```bash
uv --directory scout run scout run \
  --prompt "Find source-backed civic actors and preserve current source context." \
  "https://example.org/public-page"
```

Search-backed run:

```bash
uv --directory scout run scout run \
  --location "Las Vegas, NV" \
  --issues housing_affordability,transportation \
  --target-count 25
```

Inspect the local result before syncing:

```bash
uv --directory scout run scout runs list
uv --directory scout run scout entries stats
uv --directory scout run scout entries list --type person --random --unique-names --limit 25
```

Do not treat row counts as current people data by themselves. Review source
title, URL, source date, source type, and context before syncing or exporting.

## Browser Fallback Dry Run

Scout fetches normal HTML first. To prove JavaScript fallback works without
turning browser rendering into the primary path, run a small article crawl with
a bounded render budget:

```bash
uv --directory scout run scout articles crawl \
  --seed "https://example.org/news" \
  --target-count 5 \
  --max-pages 20 \
  --max-depth 1 \
  --browser-renders 3 \
  --json
```

Expected behavior:

- Browser windows are headless.
- Static fetches still happen first.
- Browser renders stay at or under the configured budget.
- Missing Chromium produces a clear Playwright remediation, not a traceback.

Install Chromium only on machines that need JavaScript rendering:

```bash
uv --directory scout run playwright install chromium
```

## Sync Dry Run

After reviewing a completed run with canonical artifacts:

```bash
uv --directory scout run scout sync RUN_ID \
  --atlas-url https://atlas.rebuildingus.org \
  --target public
```

Expected receipt:

- Remote Atlas run id is shown.
- Local entries map to remote review records or clearly report skips/errors.
- Public sync stages records for Atlas review and does not directly publish
  them.

If the run is not ready for the public review queue, use workspace sync:

```bash
uv --directory scout run scout sync RUN_ID \
  --atlas-url https://atlas.rebuildingus.org \
  --target workspace \
  --workspace WORKSPACE_ID
```

## Pass Criteria

The dry run passes when:

- All local gates pass.
- Doctor reports direct, search, and sync capabilities ready.
- Direct URL and search-backed runs produce local artifacts.
- Browser fallback is bounded and headless.
- A reviewed run syncs to production Atlas with a receipt.
- No release tag, GitHub release, or tap formula is created during the dry run.
