# Production Catalog Recovery

Use this runbook when the hosted catalog is empty or scheduled discovery is not
creating runs.

## How you find out

The Production Canary workflow probes the app, the API health endpoint, the
sitemap, the PDS, and the catalog itself every thirty minutes, and fails when
any of them is wrong. It asks `/api/entities?limit=1` for real rows rather than
trusting `/health`, which answers `ok` while the database is unreachable.

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

Cloud Scheduler must call the API with the trusted internal secret and the
internal actor identity headers:

- `X-Atlas-Internal-Secret`
- `X-Atlas-Actor-Id=atlas-scheduler`
- `X-Atlas-Actor-Email=scheduler@atlas.rebuildingus.org`

Redeploying production from the fixed deploy workflow updates the
`atlas-discovery-scheduled` job. To verify the live job without printing
secrets:

```bash
gcloud scheduler jobs describe atlas-discovery-scheduled \
  --location us-central1 \
  --format="value(state,schedule,lastAttemptTime,status.code)"
```

After the next run, `status.code` should not show the previous HTTP 400 failure.
If no discovery schedules exist, a successful scheduler call still enqueues `0`
jobs.

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

Create schedule targets only after the place and issue scope is approved:

```bash
curl -X POST "https://atlas-api.rebuildingus.org/api/discovery-schedules" \
  -H "X-Atlas-Internal-Secret: $ATLAS_AUTH_INTERNAL_SECRET" \
  -H "X-Atlas-Actor-Id: atlas-operator" \
  -H "X-Atlas-Actor-Email: operator@atlas.rebuildingus.org" \
  -H "Content-Type: application/json" \
  --data '{"location_query":"Las Vegas, NV","state":"NV","issue_areas":["housing_affordability"],"search_depth":"standard"}'
```

Scheduled discovery creates jobs only for enabled rows in `discovery_schedules`.
