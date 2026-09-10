# Full-app screenshot audit

Captures every renderable page of Atlas as a full-page PNG at 1440px, light
theme, against a fully seeded demo database. The output is a design/UX artifact:
one image per page, plus an index that flags anything that rendered badly.

## Running it

```bash
pnpm install
pnpm --filter @rebuildingamerica/atlas-app exec playwright install chromium
pnpm screenshots
```

Output lands in `screenshots/` at the repo root (gitignored):

```
screenshots/
  desktop-light/<name>.png       one image per page
  desktop-light/_results/*.json  per-capture detail
  report.json                    merged, machine-readable
  index.md                       read this first
```

Single pass: `pnpm --filter @rebuildingamerica/atlas-app screenshots:local` (or
`screenshots:session`).

## Why there are two passes

`ATLAS_DEPLOY_MODE=local` hands the app a synthetic owner session for the seeded
`local` workspace, which is what makes the whole authenticated surface reachable
without logging in. But `redirectIfLocalSession` bounces `/sign-in`, `/sign-up`,
`/pricing`, `/account`, `/organization*`, `/checkout-complete`, `/onboarding*`
and `/accept-invitation/*` in that mode, and `/admin/*` is gated on the operator
email at the data layer rather than by a route guard.

So the audit boots the app twice:

- **local** — public pages and the workspace, rich with seeded data.
- **session** — the routes above, behind one real magic-link sign-in as
  `person@atlas.test` (the operator address). The session is established once
  and reused via `storageState`.

`ATLAS_DEPLOY_MODE` is baked into the client bundle at build time, so this
genuinely needs two processes, not two Playwright projects. Turbo caches each
mode's build, so switching between them after the first run is a cache restore.

## Keeping the manifest honest

`route-manifest.ts` must account for every route in `routeTree.gen.ts` — each
one is either captured or listed in `EXCLUDED_ROUTES` with a reason. That is
enforced at compile time:

```ts
type UncoveredPath = Exclude<AtlasRoutePath, CapturedPath | ExcludedPath>;
export type RouteCoverageIsComplete = AssertNever<UncoveredPath>;
```

Add a route without listing it and
`pnpm --filter @rebuildingamerica/atlas-app typecheck` fails, naming the path it
is missing. That check already runs in CI, so the manifest cannot drift
silently.

## What the statuses mean

| Status       | Meaning                                                                       |
| ------------ | ----------------------------------------------------------------------------- |
| `ok`         | Rendered cleanly.                                                             |
| `degraded`   | Rendered, but logged console or page errors. Worth a look.                    |
| `redirected` | Landed somewhere other than the requested path — usually a mis-assigned mode. |
| `failed`     | Threw while loading. The PNG is still captured; that is the point.            |

A page that breaks is still photographed. The run only exits non-zero when a
manifest entry produced no image at all.

## Determinism

Time is pinned to a fixed instant, animations and transitions are zeroed,
webfonts and images are awaited, full-page captures scroll first so lazy content
mounts, analytics beacons are aborted, and basemap tiles are stubbed (set
`ATLAS_SCREENSHOTS_LIVE_TILES=1` for the real basemap). If the Google Fonts CDN
is unreachable every capture silently falls back to system type, so each sidecar
records `fontsLoaded` and `index.md` calls it out.

Virtualized lists only mount visible rows, so those pages are captured as
`viewport` rather than `full-page` — an honest 1440x900 frame beats a tall image
with a truncated list.

## Environment

| Variable                        | Default                  | Purpose                                     |
| ------------------------------- | ------------------------ | ------------------------------------------- |
| `ATLAS_SCREENSHOTS_MODE`        | —                        | `local` or `session`. Set by the runner.    |
| `ATLAS_SCREENSHOTS_APP_URL`     | `http://localhost:3200`  | App port, distinct from dev and acceptance. |
| `ATLAS_SCREENSHOTS_API_URL`     | `http://localhost:38200` | API port.                                   |
| `ATLAS_SCREENSHOTS_MAILBOX_URL` | `http://localhost:8225`  | Mail capture, session pass only.            |
| `ATLAS_SCREENSHOTS_OUT_DIR`     | `<repo>/screenshots`     | Redirect output to keep a run aside.        |
| `ATLAS_SCREENSHOTS_LIVE_TILES`  | unset                    | `1` fetches real basemap tiles.             |

## Demo data

The seeded slugs and ids the manifest points at live in the `SEEDED` constant in
`route-manifest.ts`, and are produced by `atlas.seed_demo` on the Python side.
If you change a seed slug, change it in both places — a stale slug shows up as a
`failed` capture, not a silent empty page.
