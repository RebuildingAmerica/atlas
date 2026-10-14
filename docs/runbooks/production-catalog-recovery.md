# Production Catalog Recovery

Use this runbook when the hosted catalog is empty or scheduled discovery is not
creating runs.

## How you find out

The Production Canary workflow probes the app, the API health endpoint, the
sitemap, the PDS, and the catalog itself every hour, and fails when any of them
is wrong. It asks `/api/entities?limit=1` for real rows rather than trusting
`/health`, which answers `ok` while the database is unreachable.

It exists because OpenStatus watches one URL, the app homepage, and that page is
static. It answered 200 for the whole five-week outage that began on 2026-08-02
while the API, the PDS, the directory, the map and the sitemap were all down. A
monitor that cannot fail is not a monitor.

Run it on demand from the Actions tab when you want a quick verdict on whether
production is serving.

## Check Current State

Confirm the public API and the backing database agree:

```bash
curl -sS "https://atlas-api.rebuildingus.org/api/entities?limit=1"
curl -sS "https://atlas-api.rebuildingus.org/api/entities/map?min_lng=-125&min_lat=24&max_lng=-66&max_lat=50&limit=5"
```

Expected healthy catalog state:

- `/api/entities` returns `total` greater than `0`.
- `/api/entities/map` returns `total` greater than `0` when placed actors exist.

## Repair Scheduled Discovery

The scheduled trigger endpoint requires the trusted internal secret and the
internal actor identity headers:

- `X-Atlas-Internal-Secret`
- `X-Atlas-Actor-Id=atlas-scheduler`
- `X-Atlas-Actor-Email=scheduler@atlas.rebuildingus.org`

The scheduled trigger only queues each enabled target once per day, so it does
not need an operator identity. Listing or changing schedule targets does.

Check the active Cloudflare discovery Worker and its consumer status through the
protected production publication workflow and Workers Observability. A healthy
HTTP endpoint does not prove that a schedule fired or that a discovery job
completed. If no trigger is configured, record scheduled discovery as an
unresolved dependency; do not rely on the retired Google Cloud Scheduler job. If
no discovery schedules exist, a successful trigger enqueues `0` jobs.

## Populate Production Data

Do not run `pnpm seed:profiles` or the briefing-room demo seed against
production. Those fixtures contain placeholder sources and are for local or
staging proof only.

Use reviewed, real source-backed data:

```bash
uv --directory scout run scout doctor \
  --atlas-url https://atlas.rebuildingus.org \
  --require direct-url-runs \
  --require search-discovery \
  --require atlas-sync \
  --json

uv --directory scout run scout sync RUN_ID \
  --atlas-url https://atlas.rebuildingus.org \
  --target public
```

Review and approve synced records before treating the public catalog as
restored. The recovery is complete when `/api/entities?limit=1` returns
`total > 0` and the first returned item has source receipts.

## Add Future Schedule Targets

Create schedule targets only after the place and issue scope is approved. Open
`https://atlas.rebuildingus.org/editorial/schedules`, signed in with a passkey
as an address on the production `ATLAS_INSTANCE_OPERATOR_EMAILS` variable. Name
the place, its state, the issues and the search depth, then add it. Pause a
target to skip it without losing it. Every schedule change is written to the
append-only `audit_log` table under your email.

Scheduled discovery creates jobs only for enabled rows in `discovery_schedules`.
