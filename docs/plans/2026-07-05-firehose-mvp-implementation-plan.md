# Firehose MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Firehose MVP as newsroom-grade hot civic beat monitoring: a
workspace can mark trusted public sources as hot, receive provisional
source-backed civic signals within 60 seconds of detection, and see later review
or enrichment updates without losing provenance.

**Architecture:** Firehose is a two-speed subsystem inside Atlas. The hot path
detects source changes, creates provisional civic signals, gates them, and
routes them into live workspace surfaces in under one minute. The slow path
enriches, resolves, reviews, and links approved signals into existing Atlas
sources, entries, relationships, watch digests, review queues, APIs, and MCP
responses.

**Tech Stack:** FastAPI, Python 3.12, async `aiosqlite`/PostgreSQL-compatible
SQL, `httpx`, `trafilatura`, Pydantic, TanStack Start, TanStack Query, Orval,
Vitest, Pytest, existing Atlas workspace watches, coverage targets, sources,
entry sources, review queue, and OpenAPI generation.

**MVP Cloud Profile:** Vercel for the app, Cloudflare for the public API edge,
Cloud Run for the API, a separate Cloud Run Firehose hot worker or worker pool
for minute-grade production monitoring, Neon Postgres by default for MVP
production data, Artifact Registry for container images, Secret Manager for
runtime secrets, Cloud Scheduler for low-cost run-once ticks and safety jobs,
and Cloud Logging/Monitoring for baseline observability.

This profile preserves the core architecture while minimizing nonprofit startup
cost. The architecture depends on standard PostgreSQL, not Cloud SQL
specifically. Use Neon first unless Google Cloud credits, customer requirements,
private networking, or reliability constraints make Cloud SQL the better
operator choice. Defer Pub/Sub, Cloud Tasks, Cloud Storage, BigQuery,
Redis/Memorystore, read replicas, HA database tiers, and multi-region services
until the thresholds in this plan require them.

---

## Reference Documents

Read these before implementation:

- `AGENTS.md`
- `docs/experience-first.md`
- `docs/the-atlas-product.md`
- `docs/product/prds/14-firehose-civic-intelligence-prd.md`
- `docs/design/firehose/README.md`
- `docs/design/firehose/collection-pipeline.md`
- `docs/design/firehose/analysis-and-resolution-pipeline.md`
- `docs/design/firehose/storage-and-serving-model.md`
- `docs/design/firehose/governance-and-operations.md`
- `docs/design/2026-07-04-atlas-scout-cli-worker-discovery.md`
- `docs/design/2026-06-23-discovery-platform-redesign.md`
- `docs/architecture/app.md`
- `docs/architecture/pipeline.md`
- `docs/architecture/data-model.md`

Existing code seams to reuse:

- `api/atlas/domains/discovery/coverage_targets.py`
- `api/atlas/domains/discovery/worker.py`
- `api/atlas/domains/discovery/trust_gate.py`
- `api/atlas/domains/access/models/watches.py`
- `api/atlas/domains/access/models/watch_events.py`
- `api/atlas/domains/access/api/org_watch_digest.py`
- `api/atlas/domains/moderation/review_queue.py`
- `api/atlas/domains/catalog/models/source.py`
- `api/atlas/models/schema.sql`
- `api/atlas/models/database.py`
- `scout/src/atlas_scout/cli.py`
- `scout/src/atlas_scout/steps/contribute.py`
- `scout/src/atlas_scout/store.py`
- `app/src/domains/workspace/pages/coverage-detail-page.tsx`
- `app/src/domains/workspace/pages/watches-page.tsx`
- `app/src/domains/workspace/server/watch-digest.ts`
- `app/src/domains/workspace/hooks/use-workspace-watch-digest.ts`

## MVP Product Contract

The MVP is not a national crawler. It is not a general search engine. It is not
a raw event wall.

The MVP is hot civic beat monitoring for configured public sources.

A newsroom, civic research team, funder, or coalition workspace can:

1. Create or open a coverage target.
2. Add hot public sources to the target.
3. Let Firehose check those sources continuously.
4. Receive provisional civic signals quickly.
5. Inspect the public source and relevant passage.
6. See confidence, public-realm basis, and review state.
7. Route low-risk signals into watch digest and API responses.
8. Route ambiguous, sensitive, or person-centered signals into review.

The hot path must satisfy this service target:

- P50 signal visibility: under 30 seconds from reachable source change.
- P95 signal visibility: under 60 seconds from reachable source change.
- P99 signal visibility: under 120 seconds from reachable source change.

The SLA begins when the source is publicly reachable by the configured
connector. If a provider posts late, publishes malformed feeds, blocks requests,
or hides content behind an interactive portal, Firehose records that source
state instead of pretending it saw the update earlier.

## Cloud Services And Cost Posture

Firehose must be inexpensive to operate before it is revenue-supported. The goal
is not to remove managed infrastructure; it is to keep the managed
infrastructure small, boring, and tied to visible user value.

### Required MVP Services

| Need                  | MVP service                                          | Notes                                                                                        |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Public app            | Vercel                                               | Existing hosted app path. Avoid paid add-ons until usage requires them.                      |
| API boundary          | Cloud Run service                                    | Keep the API request-based with `min-instances=0` for early production.                      |
| Hot monitoring        | Cloud Run worker or worker pool                      | Use only for approved hot targets that need the 60-second promise.                           |
| Pilot/demo hot checks | Cloud Scheduler -> API run-once endpoint             | Cheaper than a continuous worker when no paying user depends on minute-grade delivery.       |
| Operational data      | Neon Postgres                                        | Default MVP production Postgres provider. Use standard `DATABASE_URL`.                       |
| Container images      | Artifact Registry                                    | Reuse the existing API image publication path.                                               |
| Secrets               | Secret Manager and GitHub/Vercel environment secrets | Store provider keys, database URLs, edge secrets, and model/search keys outside code.        |
| Public API edge       | Cloudflare                                           | Keep DNS, API edge protection, rate limits, and signed origin headers in front of Cloud Run. |
| Logs and alerts       | Cloud Logging and Cloud Monitoring                   | Track hot-path latency, source failures, cost spikes, and worker health.                     |

### Deferred Services

Do not add these before they are needed:

- Pub/Sub. Add when artifact detection needs fan-out to multiple independent
  consumers that should not share worker state.
- Cloud Tasks. Add when per-source retry, backoff, and rate-limit control is too
  complex for Postgres leases.
- Cloud Storage. Add when raw HTML, PDF, transcript, or media snapshots are too
  large or too risky to keep directly in Postgres.
- BigQuery. Add for analytics, replay, source performance analysis, and revenue
  reporting. Do not use it for operational signal serving.
- Redis or Memorystore. Add only when live UI fan-out, ephemeral dedupe, or
  short-lived cache pressure cannot be handled by Postgres and TanStack Query.
- Cloud SQL. Add only if GCP-only infrastructure, private networking, Cloud SQL
  IAM/connector posture, Google credits, HA/read-replica needs, or Neon
  performance/operations constraints justify it.

### Cost Guardrails

- Keep the hot worker disabled by default until production hot targets exist.
- Use Cloud Scheduler `run_firehose_once` for demos, staging, and low-duty
  pilots before turning on a continuous worker.
- Start with one small Neon production project and scale from measured load.
- Use pooled Neon connection strings for request-heavy app/API paths where
  compatible; use direct strings for migrations and admin tasks.
- Keep the Firehose hot path deterministic. Do not call LLMs before a
  provisional signal is visible.
- Enforce source budgets by workspace, coverage target, source class, provider,
  and time window.
- Tier cadences: `hot` at 30-60 seconds, `warm` at 5-15 minutes, `cold` daily or
  manual.
- Store normalized signal metadata, hashes, and source passages in Postgres.
  Move large raw artifacts to object storage only when size or retention risk
  makes it necessary.
- Label every cloud resource by environment and product area.
- Add budget alerts at 50%, 80%, and 100%, with an operator runbook that can
  pause the Firehose worker, disable source classes, or lower cadence.

### Initial Spend Target

Until Firehose has paying users or dedicated grant support, the expected hosted
platform target is roughly $75-$200 per month excluding model/search API spend,
email, staff seats, and unusually large storage. If spend exceeds that range,
the first response should be to reduce hot source count, lower cadence, stop LLM
enrichment, or pause raw artifact retention rather than replacing the core
architecture.

## Scout CLI Relationship

Firehose does not replace Scout. Scout remains Atlas's local, operator-driven,
and volunteer-capable discovery instrument. Firehose is the hosted
hot-monitoring lane for configured public sources that must become visible
quickly.

### Division Of Labor

| Responsibility          | Firehose MVP                                                                                 | Scout CLI                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Minute-grade monitoring | Owns the 60-second hot-source SLA for approved configured sources.                           | Does not own the SLA; local and volunteer workers cannot be assumed available.                                                            |
| Deep discovery          | Creates provisional signals from known hot sources, then queues slow enrichment when needed. | Runs search-backed discovery, direct URL discovery, iterative deepening, entity chasing, browser research, and launch imports.            |
| Source seeding          | Stores approved source targets and watches them by cadence.                                  | Finds candidate sources, imports public datasets, and syncs canonical run artifacts back to Atlas.                                        |
| Cost control            | Keeps cloud work deterministic and small in the hot path.                                    | Moves expensive exploratory research and local-model work off hosted infrastructure when a human/operator can tolerate slower turnaround. |
| Trust boundary          | Routes signals through Firehose gate, review queue, watch digest, API, and MCP.              | Syncs to public review or workspace-private import; public uploads do not publish directly.                                               |

### Required Boundary

The MVP must not depend on Scout workers for the newsroom-grade hot path.
Volunteer laptops, operator desktops, and local Scout daemons are excellent for
deep research, backfills, source discovery, and evidence packets, but they
cannot be the mechanism that guarantees source changes appear within a minute.

The hosted Firehose worker owns:

- checking hot source targets;
- inserting immutable artifacts;
- classifying provisional signals;
- routing low-risk signals to product surfaces;
- holding risky signals for review.

Scout owns:

- local development ingestion through `scout-dev`;
- launch/backfill imports through production-useful Scout commands;
- direct-URL and search-backed local discovery;
- optional worker-mode jobs claimed through the existing discovery job queue;
- canonical run artifact sync to Atlas public review or workspace-private
  import.

### Integration Flow

Scout integrates with Firehose through existing Atlas boundaries rather than by
writing Firehose tables directly:

```text
Scout run or source import
  -> local Scout store
  -> canonical discovery run artifacts
  -> Atlas run-sync API
  -> public review or workspace-private import
  -> approved sources and coverage gaps
  -> Firehose source target candidates
  -> Firehose hot/warm/cold monitoring
```

Firehose may also create slow-path work for Scout-compatible jobs:

```text
Firehose signal or coverage gap
  -> review or enrichment need
  -> existing discovery job queue
  -> trusted Scout worker claim
  -> Scout local pipeline
  -> canonical artifact sync
  -> Firehose/catalog/review follow-through
```

This keeps Scout useful without putting local machines inside the Firehose
reliability envelope.

### MVP Requirements For Scout Compatibility

- Development and launch-data ingestion must continue through `scout-dev`, not
  direct database writes.
- Firehose source targets must record how they were created. If a source target
  came from Scout, store the origin as `scout_sync` and retain the remote run
  id, worker id when available, artifact hash, and a short origin note.
- Firehose should treat Scout-discovered sources as candidates until a user,
  reviewer, or trusted operator approves the target and cadence.
- Firehose slow enrichment can enqueue Scout-compatible discovery jobs only
  after the provisional signal is already visible or held for review.
- Scout public uploads remain review-gated. They must not bypass Firehose safety
  policy, source governance, or person-centered review rules.
- The UI should make Scout-origin provenance visible to operators and reviewers,
  not normal public users unless the source has been approved for publication.

## MVP Boundaries

### In Scope

- Hot coverage targets owned by workspaces.
- Configured source targets, not open-ended crawling.
- RSS and Atom feeds.
- Exact web pages with content fingerprinting.
- Optional extraction of linked article pages when the fetch fits the hot-path
  timeout.
- Provisional signals with phase, confidence, source, relevant passage, and
  public-realm basis.
- Conservative matching to existing entries, places, and issues.
- Routing to `org_change_events` for workspace digest visibility.
- Routing to `review_queue` for person-centered, sensitive, ambiguous, or
  low-confidence signals.
- List APIs for source targets and signals.
- A workspace UI slice on coverage detail and watching pages.
- Background hot worker controlled by settings.
- Manual run-once endpoint for tests and demos.
- OpenAPI and generated frontend client sync.

### Out Of Scope

- Arbitrary national crawling.
- Social platform monitoring.
- Hidden or private data collection.
- Law-enforcement surveillance workflows.
- Custom electoral targeting.
- Predictive scoring.
- Full public profile timelines.
- Full relationship graph mutation from Firehose.
- Bulk export marketplace.
- Webhook delivery.
- Complex alert builder.
- LLM-first hot classification.

These are excluded from the MVP because the first useful experience is fast,
source-backed detection on trusted configured beats. Broader collection can be
added after the hot lane proves itself.

## Core Concepts

### Hot Coverage Target

A hot coverage target is an existing `org_coverage_targets` record with at least
one enabled Firehose source target. The target defines the beat: place, issue,
actor types, source types, and customer scope.

### Source Target

A source target is one public URL Firehose is allowed to check. It is owned by
one workspace and usually attached to one coverage target.

MVP source kinds:

- `rss`: RSS 2.0 feed.
- `atom`: Atom feed.
- `web_page`: exact page monitored by fingerprint.

### Artifact

An artifact is one immutable public item captured from a source target. For a
feed source, each item becomes an artifact. For a web page source, a changed
page snapshot becomes an artifact.

### Civic Signal

A civic signal is a source-backed observation that something in a watched civic
field happened, changed, appeared, disappeared, gained evidence, lost freshness,
or became worth review.

MVP signal types:

- `new_source`
- `source_changed`
- `public_meeting`
- `public_event`
- `filing_update`
- `grant_award`
- `coalition_update`
- `public_role_update`
- `possible_new_actor`
- `coverage_gap`
- `needs_review`

### Signal Phase

Signals move through phases without losing the original detection:

- `detected`: source-backed item exists.
- `classified`: Firehose classified the civic signal.
- `resolved`: Firehose linked at least one existing Atlas record.
- `routed`: Firehose sent the signal to a surface.
- `reviewed`: a reviewer accepted or corrected the signal.
- `rejected`: a reviewer or gate rejected it.
- `suppressed`: the signal is retained for audit but hidden from normal
  surfaces.

The MVP should usually create `detected`, then `classified`, then `routed`
inside one worker pass.

## Architecture Overview

```text
Workspace Coverage Target
  -> Firehose Source Targets
  -> Hot Worker Claim Loop
  -> Connector Fetch
  -> Artifact Fingerprint
  -> Artifact Insert Or Skip
  -> Rule-Based Signal Classifier
  -> Conservative Resolver
  -> Firehose Gate
  -> Signal Persist
  -> Route To Watch Digest Or Review Queue
  -> API And Workspace UI
```

The hot path must avoid model calls by default. Use deterministic parsing,
fingerprints, keyword classification, and existing Atlas records. A separate
enrichment job can be queued after the provisional signal exists, but the MVP
does not require that slow path to be complete before the newsroom sees the
signal.

## File Structure

Create:

- `api/atlas/domains/discovery/firehose/__init__.py`
- `api/atlas/domains/discovery/firehose/models.py`
- `api/atlas/domains/discovery/firehose/schemas.py`
- `api/atlas/domains/discovery/firehose/connectors.py`
- `api/atlas/domains/discovery/firehose/classifier.py`
- `api/atlas/domains/discovery/firehose/resolver.py`
- `api/atlas/domains/discovery/firehose/gate.py`
- `api/atlas/domains/discovery/firehose/routing.py`
- `api/atlas/domains/discovery/firehose/worker.py`
- `api/atlas/domains/discovery/api_org_firehose.py`
- `api/tests/domains/discovery/firehose/test_models.py`
- `api/tests/domains/discovery/firehose/test_connectors.py`
- `api/tests/domains/discovery/firehose/test_classifier.py`
- `api/tests/domains/discovery/firehose/test_resolver.py`
- `api/tests/domains/discovery/firehose/test_gate.py`
- `api/tests/domains/discovery/firehose/test_routing.py`
- `api/tests/domains/discovery/firehose/test_worker.py`
- `api/tests/domains/discovery/test_org_firehose_api.py`
- `app/src/domains/workspace/server/firehose.ts`
- `app/src/domains/workspace/hooks/use-firehose-signals.ts`
- `app/src/domains/workspace/hooks/use-firehose-source-targets.ts`
- `app/src/domains/workspace/components/firehose-live-signals-panel.tsx`
- `app/src/domains/workspace/components/firehose-source-targets-panel.tsx`
- `app/tests/unit/domains/workspace/server/firehose.test.ts`
- `app/tests/unit/domains/workspace/components/firehose-live-signals-panel.test.tsx`
- `app/tests/unit/domains/workspace/components/firehose-source-targets-panel.test.tsx`

Modify:

- `api/atlas/models/schema.sql`
- `api/atlas/models/database.py`
- `api/atlas/platform/config.py`
- `api/atlas/main.py`
- `api/atlas/platform/http/router.py`
- `api/atlas/domains/access/models/watch_events.py`
- `api/atlas/domains/access/api/org_watch_digest.py`
- `api/atlas/platform/openapi.py`
- `api/.env.example`
- `.env.example`
- `app/src/domains/workspace/pages/coverage-detail-page.tsx`
- `app/src/domains/workspace/pages/watches-page.tsx`
- `app/src/domains/workspace/server/watch-digest.ts`
- `app/src/domains/workspace/hooks/use-workspace-watch-digest.ts`
- `app/src/lib/generated/`
- `openapi/atlas.openapi.json`
- `mintlify/openapi/atlas.openapi.json`
- `docs/design/firehose/storage-and-serving-model.md`
- `docs/design/firehose/collection-pipeline.md`

Do not add a new package unless a task explicitly proves the existing stack
cannot parse the configured source class. RSS and Atom can be parsed with
`xml.etree.ElementTree`; web pages can use existing `httpx` and `trafilatura`.

## Database Model

Implement the MVP tables in both `api/atlas/models/schema.sql` and
`api/atlas/models/database.py`.

Use the existing SQL placeholder style: `?` placeholders. The PostgreSQL adapter
translates placeholders.

### `firehose_source_targets`

```sql
CREATE TABLE IF NOT EXISTS firehose_source_targets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    coverage_target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('rss', 'atom', 'web_page')),
    priority TEXT NOT NULL DEFAULT 'hot' CHECK(priority IN ('hot', 'warm')),
    cadence_seconds INTEGER NOT NULL DEFAULT 30 CHECK(cadence_seconds >= 15),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    safety_policy TEXT NOT NULL DEFAULT 'standard'
        CHECK(safety_policy IN ('standard', 'person_review_required', 'review_all')),
    origin TEXT NOT NULL DEFAULT 'manual'
        CHECK(origin IN ('manual', 'scout_sync', 'api', 'system')),
    origin_run_id TEXT,
    origin_worker_id TEXT,
    origin_artifact_hash TEXT,
    origin_note TEXT,
    last_checked_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    next_check_at TIMESTAMPTZ,
    last_error TEXT,
    last_http_status INTEGER,
    etag TEXT,
    last_modified TEXT,
    content_hash TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, coverage_target_id, url)
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_firehose_source_targets_due
    ON firehose_source_targets(enabled, priority, next_check_at);
CREATE INDEX IF NOT EXISTS idx_firehose_source_targets_coverage
    ON firehose_source_targets(org_id, coverage_target_id);
CREATE INDEX IF NOT EXISTS idx_firehose_source_targets_lease
    ON firehose_source_targets(lease_expires_at);
```

### `firehose_artifacts`

```sql
CREATE TABLE IF NOT EXISTS firehose_artifacts (
    id TEXT PRIMARY KEY,
    source_target_id TEXT NOT NULL REFERENCES firehose_source_targets(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    coverage_target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('rss', 'atom', 'web_page')),
    published_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    content_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    relevant_text TEXT NOT NULL,
    raw_content TEXT,
    http_status INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_target_id, fingerprint)
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_firehose_artifacts_target_detected
    ON firehose_artifacts(source_target_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_artifacts_coverage_detected
    ON firehose_artifacts(org_id, coverage_target_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_artifacts_hash
    ON firehose_artifacts(content_hash);
```

### `firehose_signals`

```sql
CREATE TABLE IF NOT EXISTS firehose_signals (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES firehose_artifacts(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    coverage_target_id TEXT NOT NULL REFERENCES org_coverage_targets(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL CHECK(signal_type IN (
        'new_source',
        'source_changed',
        'public_meeting',
        'public_event',
        'filing_update',
        'grant_award',
        'coalition_update',
        'public_role_update',
        'possible_new_actor',
        'coverage_gap',
        'needs_review'
    )),
    phase TEXT NOT NULL CHECK(phase IN (
        'detected',
        'classified',
        'resolved',
        'routed',
        'reviewed',
        'rejected',
        'suppressed'
    )),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    relevant_passage TEXT NOT NULL,
    public_realm_basis TEXT NOT NULL,
    issue_tags_json TEXT NOT NULL DEFAULT '[]',
    place_guess TEXT,
    actor_guess TEXT,
    linked_entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
    linked_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
    confidence_score REAL NOT NULL CHECK(confidence_score >= 0 AND confidence_score <= 1),
    sensitivity_score REAL NOT NULL CHECK(sensitivity_score >= 0 AND sensitivity_score <= 1),
    route_state TEXT NOT NULL DEFAULT 'pending'
        CHECK(route_state IN ('pending', 'routed', 'held_for_review', 'rejected', 'suppressed')),
    visibility_scope TEXT NOT NULL DEFAULT 'workspace_private'
        CHECK(visibility_scope IN ('public', 'workspace_private', 'reviewer_only')),
    detected_at TIMESTAMPTZ NOT NULL,
    routed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(artifact_id, coverage_target_id, signal_type)
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_firehose_signals_coverage_detected
    ON firehose_signals(org_id, coverage_target_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_signals_route_state
    ON firehose_signals(route_state, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_firehose_signals_linked_entry
    ON firehose_signals(linked_entry_id, detected_at DESC);
```

### `firehose_routes`

```sql
CREATE TABLE IF NOT EXISTS firehose_routes (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL REFERENCES firehose_signals(id) ON DELETE CASCADE,
    destination_type TEXT NOT NULL CHECK(destination_type IN (
        'watch_digest',
        'review_queue',
        'api',
        'profile_timeline'
    )),
    destination_id TEXT,
    route_reason TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('active', 'rejected', 'suppressed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(signal_id, destination_type, destination_id)
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_firehose_routes_signal
    ON firehose_routes(signal_id);
CREATE INDEX IF NOT EXISTS idx_firehose_routes_destination
    ON firehose_routes(destination_type, destination_id);
```

## API Contract

Create `api/atlas/domains/discovery/api_org_firehose.py` and mount it in
`api/atlas/platform/http/router.py`:

```python
router.include_router(org_firehose_router, prefix="/api/orgs/{org_id}/firehose")
```

Every endpoint requires:

- `require_org_actor`
- `require_capability("monitoring.watchlists")`
- path `org_id` must match actor org id
- coverage targets must belong to the workspace

### Source Target Endpoints

`GET /api/orgs/{org_id}/firehose/source-targets`

Query params:

- `coverage_target_id: str | None`
- `enabled: bool | None`
- `limit: int = 100`

Returns:

```json
{
  "items": [
    {
      "id": "source-target-id",
      "org_id": "org-id",
      "coverage_target_id": "target-id",
      "label": "Detroit City Council RSS",
      "url": "https://example.test/feed.xml",
      "source_kind": "rss",
      "priority": "hot",
      "cadence_seconds": 30,
      "enabled": true,
      "safety_policy": "standard",
      "last_checked_at": "2026-07-05T12:00:00Z",
      "last_success_at": "2026-07-05T12:00:00Z",
      "next_check_at": "2026-07-05T12:00:30Z",
      "last_error": null,
      "last_http_status": 200,
      "consecutive_failures": 0,
      "created_by": "user-id",
      "created_at": "2026-07-05T11:59:00Z",
      "updated_at": "2026-07-05T12:00:00Z"
    }
  ],
  "total": 1
}
```

`POST /api/orgs/{org_id}/firehose/source-targets`

Request:

```json
{
  "coverage_target_id": "target-id",
  "label": "Detroit City Council RSS",
  "url": "https://example.test/feed.xml",
  "source_kind": "rss",
  "priority": "hot",
  "cadence_seconds": 30,
  "safety_policy": "standard"
}
```

Validation:

- URL must be `https://` unless environment is `dev`.
- `cadence_seconds` must be at least configured minimum.
- `source_kind` must match one supported connector.
- source target must be unique for `(org_id, coverage_target_id, url)`.

`PATCH /api/orgs/{org_id}/firehose/source-targets/{source_target_id}`

Patchable fields:

- `label`
- `priority`
- `cadence_seconds`
- `enabled`
- `safety_policy`

`DELETE /api/orgs/{org_id}/firehose/source-targets/{source_target_id}`

Soft behavior:

- Set `enabled = FALSE`.
- Clear `lease_owner` and `lease_expires_at`.
- Set `next_check_at = NULL`.
- Keep artifacts, signals, and routes for audit.
- Return `204 No Content`.

### Signal Endpoints

`GET /api/orgs/{org_id}/firehose/signals`

Query params:

- `coverage_target_id: str | None`
- `since: str | None`
- `route_state: str | None`
- `limit: int = 100`

Response:

```json
{
  "items": [
    {
      "id": "signal-id",
      "artifact_id": "artifact-id",
      "coverage_target_id": "target-id",
      "signal_type": "public_meeting",
      "phase": "routed",
      "title": "City council agenda includes tenant protections",
      "summary": "A new agenda item mentions tenant protections.",
      "relevant_passage": "Agenda item 14: Tenant protections...",
      "public_realm_basis": "public meeting agenda",
      "issue_tags": ["housing"],
      "place_guess": "Detroit, MI",
      "actor_guess": "Detroit City Council",
      "linked_entry_id": null,
      "confidence_score": 0.78,
      "sensitivity_score": 0.12,
      "route_state": "routed",
      "visibility_scope": "workspace_private",
      "detected_at": "2026-07-05T12:00:12Z",
      "routed_at": "2026-07-05T12:00:38Z",
      "source": {
        "url": "https://example.test/agenda",
        "title": "July 5 Agenda",
        "source_kind": "rss",
        "published_at": "2026-07-05T12:00:00Z"
      }
    }
  ],
  "total": 1,
  "newest_detected_at": "2026-07-05T12:00:12Z",
  "p95_route_latency_seconds": 26.0
}
```

`POST /api/orgs/{org_id}/firehose/source-targets/{source_target_id}/run-once`

Purpose:

- demo and test hook
- manually checks one source target
- returns artifacts/signals/routes created in that pass

This endpoint must be capability-gated and workspace-scoped.

## Backend Implementation Details

### Models

`api/atlas/domains/discovery/firehose/models.py` owns persistence only. Keep
fetching, classification, and routing out of this file.

Dataclasses:

```python
@dataclass(slots=True)
class FirehoseSourceTargetModel:
    id: str
    org_id: str
    coverage_target_id: str
    label: str
    url: str
    source_kind: Literal["rss", "atom", "web_page"]
    priority: Literal["hot", "warm"]
    cadence_seconds: int
    enabled: bool
    safety_policy: Literal["standard", "person_review_required", "review_all"]
    last_checked_at: str | None
    last_success_at: str | None
    next_check_at: str | None
    last_error: str | None
    last_http_status: int | None
    consecutive_failures: int
    created_by: str
    created_at: str
    updated_at: str
```

CRUD methods:

- `create_source_target`
- `get_source_target`
- `list_source_targets`
- `update_source_target`
- `disable_source_target`
- `claim_due_source_targets`
- `mark_source_target_success`
- `mark_source_target_failure`
- `insert_artifact_if_new`
- `get_artifact`
- `insert_signal_if_new`
- `update_signal_route_state`
- `list_signals`
- `insert_route_if_new`
- `release_source_target_lease`

`claim_due_source_targets` must be lease-based:

```sql
UPDATE firehose_source_targets
SET lease_owner = ?, lease_expires_at = ?
WHERE id IN (
    SELECT id
    FROM firehose_source_targets
    WHERE enabled = TRUE
      AND priority = 'hot'
      AND (next_check_at IS NULL OR next_check_at <= ?)
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    ORDER BY COALESCE(next_check_at, created_at), id
    LIMIT ?
)
```

Return claimed rows ordered by target age. Use the same connection and commit
before returning.

### Connectors

`api/atlas/domains/discovery/firehose/connectors.py` owns external fetching and
parsing.

Define:

```python
@dataclass(frozen=True, slots=True)
class FirehoseFetchRequest:
    source_target_id: str
    url: str
    source_kind: Literal["rss", "atom", "web_page"]
    etag: str | None
    last_modified: str | None
    timeout_seconds: float


@dataclass(frozen=True, slots=True)
class FirehoseFetchedItem:
    source_url: str
    canonical_url: str
    title: str
    source_kind: Literal["rss", "atom", "web_page"]
    published_at: str | None
    relevant_text: str
    raw_content: str | None
    content_hash: str
    fingerprint: str
    http_status: int
    etag: str | None
    last_modified: str | None
    metadata: dict[str, str]
```

Connector behavior:

- Use `httpx.AsyncClient(follow_redirects=True, timeout=timeout_seconds)`.
- Send `If-None-Match` when the target has `etag`.
- Send `If-Modified-Since` when the target has `last_modified`.
- Return no items on `304`.
- Treat 4xx/5xx as source target failures.
- RSS/Atom item fingerprint: stable hash of canonical URL plus published date
  plus title plus summary.
- Web page fingerprint: stable hash of canonical URL plus normalized extracted
  text.
- For RSS/Atom, parse feed XML with `xml.etree.ElementTree`.
- For web pages, use existing `trafilatura.extract`.
- Do not call the LLM in connector code.

### Classifier

`api/atlas/domains/discovery/firehose/classifier.py` creates provisional signal
proposals from artifacts.

Classifier inputs:

- artifact title
- artifact relevant text
- coverage target geography
- coverage target issue areas
- coverage target source types
- source kind

Classifier outputs:

```python
@dataclass(frozen=True, slots=True)
class FirehoseSignalProposal:
    signal_type: FirehoseSignalType
    title: str
    summary: str
    relevant_passage: str
    public_realm_basis: str
    issue_tags: list[str]
    place_guess: str | None
    actor_guess: str | None
    confidence_score: float
    sensitivity_score: float
```

MVP classifier rules:

- meeting words: `agenda`, `minutes`, `hearing`, `council`, `committee`,
  `board meeting`, `public comment` -> `public_meeting`.
- event words: `rally`, `town hall`, `forum`, `webinar`, `workshop`,
  `community meeting` -> `public_event`.
- filing words: `filing`, `form 990`, `registration`, `incorporated`, `fec`,
  `irs` -> `filing_update`.
- grant words: `grant`, `awarded`, `funding`, `rfp`, `notice of funding` ->
  `grant_award`.
- coalition words: `coalition`, `joined`, `partnership`, `alliance`, `endorsed`
  -> `coalition_update`.
- role words: `appointed`, `named`, `elected`, `resigned`, `executive director`,
  `spokesperson` -> `public_role_update`.
- otherwise -> `new_source`.

Sensitive indicators:

- `minor`, `student`, `victim`, `survivor`, `domestic violence`, `shelter`,
  `undocumented`, `medical`, `mental health`, `address`, `home address`,
  `arrested`, `alleged`.

If sensitive indicators appear, set `sensitivity_score >= 0.75`.

### Resolver

`api/atlas/domains/discovery/firehose/resolver.py` links signals to existing
Atlas records.

MVP resolution order:

1. If artifact canonical URL already exists in `sources`, use that source id.
2. If a source is linked through `entry_sources`, prefer that entry id.
3. Match exact entry names in title or relevant text.
4. Match coverage target linked entries if their names appear.
5. If multiple entries match, return no linked entry and add review reason.

Do not auto-create public people in MVP. If the classifier sees a person-like
name and no strong entry match, route to review.

### Gate

`api/atlas/domains/discovery/firehose/gate.py` decides visibility and route.

Return:

```python
@dataclass(frozen=True, slots=True)
class FirehoseGateDecision:
    route_state: Literal["routed", "held_for_review", "rejected", "suppressed"]
    visibility_scope: Literal["public", "workspace_private", "reviewer_only"]
    route_reason: str
    review_reason: str | None
```

Rules:

- `safety_policy == "review_all"` -> held for review.
- `safety_policy == "person_review_required"` and `linked_entry` type is
  `person` -> held for review.
- `sensitivity_score >= 0.75` -> held for review.
- `confidence_score < 0.45` -> held for review.
- ambiguous entity match -> held for review.
- source target disabled during processing -> rejected.
- otherwise route to workspace digest.

The MVP must not auto-publish Firehose signals to public routes. Use
`workspace_private` for routed workspace signals and `reviewer_only` for held
signals.

### Routing

`api/atlas/domains/discovery/firehose/routing.py` owns side effects outside
Firehose tables.

Routing behavior:

- Insert one `firehose_routes` row for every route.
- For routed workspace signals:
  - upsert or reuse a `sources` row with `extraction_method = 'autodiscovery'`;
  - set `linked_source_id` on the signal;
  - create an `org_change_events` row with event type `civic_signal`;
  - attach signal id, source target id, latency, confidence, sensitivity, and
    public realm basis in `metadata_json`.
- For held signals:
  - create a `review_queue` row with `kind = 'firehose_signal'`;
  - set `hold_reason` to the gate review reason;
  - create a `firehose_routes` row with destination type `review_queue`;
  - set signal `route_state = 'held_for_review'`.

Update `org_change_events` event type checks to include `civic_signal`.

### Worker

`api/atlas/domains/discovery/firehose/worker.py` owns the hot loop.

Public functions:

- `start_firehose_worker`
- `stop_firehose_worker`
- `run_firehose_once`
- `run_source_target_once`

Worker loop:

1. Claim due hot source targets.
2. Fetch each target concurrently up to configured concurrency.
3. Insert new artifacts.
4. Skip artifacts already seen.
5. Classify each new artifact.
6. Resolve linked source and entry.
7. Gate the signal.
8. Persist signal.
9. Route signal.
10. Mark target success or failure.
11. Schedule the next check.

Worker must be idempotent. Re-running the same source content should create no
duplicate artifacts, signals, routes, sources, or digest events.

Add settings:

- `firehose_hot_worker_enabled: bool`, env `FIREHOSE_HOT_WORKER_ENABLED`,
  default `False` in production until explicitly enabled, `False` in tests.
- `firehose_hot_poll_interval_seconds: int`, env
  `FIREHOSE_HOT_POLL_INTERVAL_SECONDS`, default `5`.
- `firehose_min_cadence_seconds: int`, env `FIREHOSE_MIN_CADENCE_SECONDS`,
  default `30`, minimum `15`.
- `firehose_source_timeout_seconds: float`, env
  `FIREHOSE_SOURCE_TIMEOUT_SECONDS`, default `8.0`.
- `firehose_max_concurrent_sources: int`, env `FIREHOSE_MAX_CONCURRENT_SOURCES`,
  default `8`.
- `firehose_hot_path_sla_seconds: int`, env `FIREHOSE_HOT_PATH_SLA_SECONDS`,
  default `60`.

Start and stop the worker in `api/atlas/main.py` alongside the existing
discovery worker. Keep the two workers independent.

## Frontend Product Surface

The MVP UI should make Firehose useful without becoming an intelligence console.

### Coverage Detail Page

Modify `app/src/domains/workspace/pages/coverage-detail-page.tsx`.

Add two sections:

1. `FirehoseSourceTargetsPanel`
   - Shows hot sources for the coverage target.
   - Lets a user add a source target.
   - Lets a user disable a source target.
   - Shows last checked, next check, and error state.

2. `FirehoseLiveSignalsPanel`
   - Shows recent signals for the coverage target.
   - Polls every 15 seconds when the tab is focused.
   - Shows source, detected time, signal type, confidence, review state, and
     relevant passage.
   - Links to the source URL.

Copy rules:

- Empty source state: `No hot sources.`
- Empty signal state: `No live signals.`
- Error state: `Live signals could not load.`
- Do not say "Atlas is scanning", "the pipeline is running", or "warming up".

### Watching Page

Modify `app/src/domains/workspace/pages/watches-page.tsx`.

Add a compact "Live signals" summary above the existing watched resources:

- newest detected signal time
- count of routed signals in the last 24 hours
- count of held signals in the last 24 hours

Do not replace the current watch list. The MVP should make the existing page
feel more alive without redesigning the workspace.

### Digest

Modify:

- `api/atlas/domains/access/models/watch_events.py`
- `api/atlas/domains/access/api/org_watch_digest.py`
- `app/src/domains/workspace/server/watch-digest.ts`
- `app/src/domains/workspace/hooks/use-workspace-watch-digest.ts`

Add `civic_signal` support and expose:

- signal id from `metadata_json`
- confidence score
- sensitivity score
- public realm basis
- route latency seconds

Frontend should render these only when present.

## Task Sequence

### Task 1: Add Firehose Schema

**Files:**

- Modify: `api/atlas/models/schema.sql`
- Modify: `api/atlas/models/database.py`
- Test: `api/tests/test_database_schema.py`

- [ ] Add the four MVP tables and indexes listed in "Database Model" to
      `api/atlas/models/schema.sql`.
- [ ] Add the same DDL to `api/atlas/models/database.py`.
- [ ] Update schema tests to assert the four Firehose tables exist.
- [ ] Update schema tests to assert event type `civic_signal` is accepted in
      `org_change_events`.
- [ ] Run:

```bash
cd api && uv run pytest tests/test_database_schema.py -v
```

Expected: schema tests pass.

- [ ] Commit only the schema/test files. Use a message file, not
      `git commit -m`.

Recommended commit subject:

```text
feat(api): Add Firehose MVP storage
```

Commit body must explain that this creates the source, artifact, signal, and
route state needed for minute-grade civic monitoring while keeping provenance
and review state attached.

### Task 2: Add Firehose Persistence Models

**Files:**

- Create: `api/atlas/domains/discovery/firehose/__init__.py`
- Create: `api/atlas/domains/discovery/firehose/models.py`
- Test: `api/tests/domains/discovery/firehose/test_models.py`

- [ ] Write tests for source target create/list/get/update/disable.
- [ ] Write tests that source targets retain `origin`, `origin_run_id`,
      `origin_worker_id`, `origin_artifact_hash`, and `origin_note`.
- [ ] Write tests for `claim_due_source_targets` lease behavior.
- [ ] Write tests for artifact idempotency by `(source_target_id, fingerprint)`.
- [ ] Write tests for signal idempotency by
      `(artifact_id, coverage_target_id, signal_type)`.
- [ ] Write tests for route idempotency.
- [ ] Implement dataclasses and CRUD methods in `models.py`.
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/firehose/test_models.py -v
```

Expected: tests pass.

- [ ] Run:

```bash
cd api && uv run ruff format atlas/domains/discovery/firehose tests/domains/discovery/firehose
cd api && uv run ruff check atlas/domains/discovery/firehose tests/domains/discovery/firehose
```

Expected: format and lint pass.

- [ ] Commit only Firehose model files and model tests.

Recommended commit subject:

```text
feat(api): Add Firehose persistence models
```

### Task 3: Add RSS, Atom, And Web Page Connectors

**Files:**

- Create: `api/atlas/domains/discovery/firehose/connectors.py`
- Test: `api/tests/domains/discovery/firehose/test_connectors.py`

- [ ] Write RSS fixture test with two items.
- [ ] Write Atom fixture test with two entries.
- [ ] Write web page fixture test using extracted text.
- [ ] Write `304 Not Modified` test.
- [ ] Write timeout/failure test that returns a typed failure.
- [ ] Implement connector request and fetched item dataclasses.
- [ ] Implement RSS/Atom parsing with `xml.etree.ElementTree`.
- [ ] Implement page extraction with `trafilatura.extract`.
- [ ] Implement stable SHA-256 fingerprint helpers.
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/firehose/test_connectors.py -v
```

Expected: connector tests pass without network access.

- [ ] Run:

```bash
cd api && uv run ruff format atlas/domains/discovery/firehose tests/domains/discovery/firehose
cd api && uv run ruff check atlas/domains/discovery/firehose tests/domains/discovery/firehose
```

Expected: format and lint pass.

- [ ] Commit connector files and tests.

Recommended commit subject:

```text
feat(api): Add Firehose hot source connectors
```

### Task 4: Add Rule-Based Classifier

**Files:**

- Create: `api/atlas/domains/discovery/firehose/classifier.py`
- Test: `api/tests/domains/discovery/firehose/test_classifier.py`

- [ ] Write tests for each MVP signal type.
- [ ] Write tests for issue tag extraction from coverage target issue areas.
- [ ] Write tests for sensitive indicator scoring.
- [ ] Write tests for relevant passage truncation.
- [ ] Implement `FirehoseSignalProposal`.
- [ ] Implement deterministic classifier rules.
- [ ] Ensure classifier does not call Anthropic.
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/firehose/test_classifier.py -v
```

Expected: classifier tests pass.

- [ ] Commit classifier files and tests.

Recommended commit subject:

```text
feat(api): Classify Firehose civic signals
```

### Task 5: Add Conservative Resolver

**Files:**

- Create: `api/atlas/domains/discovery/firehose/resolver.py`
- Test: `api/tests/domains/discovery/firehose/test_resolver.py`

- [ ] Write test for existing source URL resolution.
- [ ] Write test for entry resolution through `entry_sources`.
- [ ] Write test for exact entry-name match.
- [ ] Write test for multiple matches returning ambiguity.
- [ ] Write test that person-like unmatched mentions do not create entries.
- [ ] Implement resolver dataclasses.
- [ ] Implement resolution order exactly as specified in "Resolver".
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/firehose/test_resolver.py -v
```

Expected: resolver tests pass.

- [ ] Commit resolver files and tests.

Recommended commit subject:

```text
feat(api): Resolve Firehose signals conservatively
```

### Task 6: Add Firehose Gate

**Files:**

- Create: `api/atlas/domains/discovery/firehose/gate.py`
- Test: `api/tests/domains/discovery/firehose/test_gate.py`

- [ ] Write tests for `review_all`.
- [ ] Write tests for `person_review_required`.
- [ ] Write tests for high sensitivity.
- [ ] Write tests for low confidence.
- [ ] Write tests for ambiguous match.
- [ ] Write tests for normal routed workspace-private signal.
- [ ] Implement `FirehoseGateDecision`.
- [ ] Implement gate rules in priority order.
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/firehose/test_gate.py -v
```

Expected: gate tests pass.

- [ ] Commit gate files and tests.

Recommended commit subject:

```text
feat(api): Gate Firehose signal routing
```

### Task 7: Add Firehose Routing

**Files:**

- Create: `api/atlas/domains/discovery/firehose/routing.py`
- Modify: `api/atlas/domains/access/models/watch_events.py`
- Modify: `api/atlas/domains/access/api/org_watch_digest.py`
- Test: `api/tests/domains/discovery/firehose/test_routing.py`
- Test: existing watch digest tests under `api/tests/domains/discovery/` and
  `api/tests/domains/access/` if present.

- [ ] Add `civic_signal` to `WatchEventType`.
- [ ] Add `civic_signal` to database event type checks.
- [ ] Extend digest rows to include Firehose metadata when present.
- [ ] Write test that a routed signal creates one `org_change_events` row.
- [ ] Write test that routing the same signal twice is idempotent.
- [ ] Write test that held signal creates one `review_queue` row.
- [ ] Write test that metadata includes signal id, latency, confidence,
      sensitivity, public realm basis, and source target id.
- [ ] Implement `route_firehose_signal`.
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/firehose/test_routing.py -v
cd api && uv run pytest tests/domains/discovery/test_org_coverage_targets_api.py -v
```

Expected: routing and existing coverage-watch digest tests pass.

- [ ] Commit routing files and tests.

Recommended commit subject:

```text
feat(api): Route Firehose signals to watches and review
```

### Task 8: Add Worker And Settings

**Files:**

- Create: `api/atlas/domains/discovery/firehose/worker.py`
- Modify: `api/atlas/platform/config.py`
- Modify: `api/atlas/main.py`
- Modify: `api/.env.example`
- Modify: `.env.example`
- Test: `api/tests/domains/discovery/firehose/test_worker.py`
- Test: `api/tests/platform/test_production_config.py`

- [ ] Add Firehose settings listed in "Worker".
- [ ] Test env parsing and defaults.
- [ ] Test worker disabled by default in test settings.
- [ ] Test `run_source_target_once` creates artifact, signal, and route.
- [ ] Test repeated run on same source creates no duplicates.
- [ ] Test source failure updates error state and schedules next check.
- [ ] Test route latency is computed from detected/routed timestamps.
- [ ] Implement start/stop worker functions.
- [ ] Wire worker into FastAPI lifespan independently of discovery worker.
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/firehose/test_worker.py tests/platform/test_production_config.py -v
```

Expected: worker and config tests pass.

- [ ] Commit worker/settings files and tests.

Recommended commit subject:

```text
feat(api): Run Firehose hot source worker
```

### Task 9: Add Firehose Org API

**Files:**

- Create: `api/atlas/domains/discovery/api_org_firehose.py`
- Modify: `api/atlas/platform/http/router.py`
- Modify: `api/atlas/platform/openapi.py`
- Test: `api/tests/domains/discovery/test_org_firehose_api.py`

- [ ] Write API tests for source target create/list/patch/disable.
- [ ] Write API tests that source-target responses include Scout-origin metadata
      when a target came from synced Scout artifacts.
- [ ] Write API test that another org cannot access source targets.
- [ ] Write API test that missing capability is rejected.
- [ ] Write API test that signal list returns source metadata.
- [ ] Write API test that `run-once` creates and returns signals.
- [ ] Write API test that `https://` is required outside dev.
- [ ] Implement Pydantic request/response models.
- [ ] Include source-target origin fields in API request/response models without
      allowing normal users to forge `scout_sync` provenance.
- [ ] Implement endpoints listed in "API Contract".
- [ ] Mount router.
- [ ] Add OpenAPI tag text for Firehose.
- [ ] Run:

```bash
cd api && uv run pytest tests/domains/discovery/test_org_firehose_api.py -v
```

Expected: Firehose API tests pass.

- [ ] Commit API files and tests.

Recommended commit subject:

```text
feat(api): Expose Firehose workspace APIs
```

### Task 10: Regenerate OpenAPI And Frontend Client

**Files:**

- Modify: `openapi/atlas.openapi.json`
- Modify: `mintlify/openapi/atlas.openapi.json`
- Modify: `app/src/lib/generated/`

- [ ] Run:

```bash
pnpm run openapi
cd app && pnpm run api-client
```

Expected: generated OpenAPI and TypeScript client update with Firehose endpoints
and `civic_signal` digest event type.

- [ ] Run:

```bash
pnpm run contract:test
```

Expected: contract tests pass.

- [ ] Commit generated contract files separately from handwritten API code.

Recommended commit subject:

```text
chore: Regenerate Firehose API contracts
```

### Task 11: Add Frontend Firehose Data Layer

**Files:**

- Create: `app/src/domains/workspace/server/firehose.ts`
- Create: `app/src/domains/workspace/hooks/use-firehose-signals.ts`
- Create: `app/src/domains/workspace/hooks/use-firehose-source-targets.ts`
- Test: `app/tests/unit/domains/workspace/server/firehose.test.ts`

- [ ] Write server-function tests for source target list/create/update/disable.
- [ ] Write server-function tests for signal list.
- [ ] Implement input schemas with `zod`.
- [ ] Use `requestWorkspaceApi` and `requireActiveWorkspaceId`.
- [ ] Use TanStack Query keys:
  - `["workspace", "firehose", "source-targets", coverageTargetId]`
  - `["workspace", "firehose", "signals", coverageTargetId, limit]`
- [ ] Set signal query `refetchInterval` to 15 seconds when enabled.
- [ ] Run:

```bash
cd app && pnpm vitest run tests/unit/domains/workspace/server/firehose.test.ts
```

Expected: frontend data layer tests pass.

- [ ] Commit frontend data layer and tests.

Recommended commit subject:

```text
feat(app): Load Firehose workspace data
```

### Task 12: Add Coverage Detail Firehose Panels

**Files:**

- Create:
  `app/src/domains/workspace/components/firehose-source-targets-panel.tsx`
- Create: `app/src/domains/workspace/components/firehose-live-signals-panel.tsx`
- Modify: `app/src/domains/workspace/pages/coverage-detail-page.tsx`
- Test:
  `app/tests/unit/domains/workspace/components/firehose-source-targets-panel.test.tsx`
- Test:
  `app/tests/unit/domains/workspace/components/firehose-live-signals-panel.test.tsx`

- [ ] Write tests for empty source state.
- [ ] Write tests for source target error state.
- [ ] Write tests for add-source form validation.
- [ ] Write tests for disable-source action.
- [ ] Write tests for empty signal state.
- [ ] Write tests for signal row source link, confidence, route state, and
      relevant passage.
- [ ] Implement source target panel.
- [ ] Implement live signals panel.
- [ ] Place both panels on coverage detail page below the target summary and
      above secondary workflow sections.
- [ ] Run:

```bash
cd app && pnpm vitest run tests/unit/domains/workspace/components/firehose-source-targets-panel.test.tsx tests/unit/domains/workspace/components/firehose-live-signals-panel.test.tsx
```

Expected: component tests pass.

- [ ] Commit coverage detail UI files and tests.

Recommended commit subject:

```text
feat(app): Show live Firehose signals on coverage
```

### Task 13: Update Watching And Digest Surfaces

**Files:**

- Modify: `app/src/domains/workspace/pages/watches-page.tsx`
- Modify: `app/src/domains/workspace/server/watch-digest.ts`
- Modify: `app/src/domains/workspace/hooks/use-workspace-watch-digest.ts`
- Test: existing watch page and digest tests.

- [ ] Add digest metadata types for `civic_signal`.
- [ ] Render Firehose metadata when present.
- [ ] Add compact live signal summary on watching page.
- [ ] Keep existing watch resource list intact.
- [ ] Add tests for live summary counts.
- [ ] Add tests for civic signal digest row rendering.
- [ ] Run relevant app tests:

```bash
cd app && pnpm vitest run tests/unit/domains/workspace
```

Expected: workspace tests pass.

- [ ] Commit watching/digest UI files and tests.

Recommended commit subject:

```text
feat(app): Surface Firehose signals in watches
```

### Task 14: Add MCP/API Follow-Through

**Files:**

- Modify: `api/atlas/platform/mcp/data.py`
- Modify: `api/atlas/platform/mcp/server.py`
- Test: `api/tests/platform/test_mcp_data.py`
- Test: `api/tests/platform/test_mcp_server.py`

- [ ] Add a read-only `list_firehose_signals` MCP tool using the same org and
      entitlement boundary used by existing workspace-scoped MCP data.
- [ ] If the current MCP request context cannot determine an org safely, add the
      minimum request-context plumbing needed before exposing the tool.
- [ ] The tool must return source URL, detected time, signal type, summary,
      confidence, route state, visibility scope, and public realm basis.
- [ ] It must not return reviewer-only signals to normal clients.
- [ ] Run:

```bash
cd api && uv run pytest tests/platform/test_mcp_data.py tests/platform/test_mcp_server.py -v
```

Expected: MCP tests pass and the tool cannot return signals outside the caller's
authorized workspace.

- [ ] Commit MCP changes only if implemented.

Recommended commit subject:

```text
feat(api): Expose Firehose signals through MCP
```

### Task 15: Add Operations And Docs Updates

**Files:**

- Modify: `docs/design/firehose/collection-pipeline.md`
- Modify: `docs/design/firehose/storage-and-serving-model.md`
- Modify: `docs/design/firehose/governance-and-operations.md`
- Modify: `docs/deployment/production.md`
- Modify: `docs/deployment/staging.md`
- Modify: `api/.env.example`
- Modify: `.env.example`

- [ ] Document hot/warm/cold lanes.
- [ ] Document the 60-second SLA and when it begins.
- [ ] Document supported source kinds.
- [ ] Document Firehose settings.
- [ ] Document worker enablement for staging and production.
- [ ] Document the MVP cloud profile: Vercel, Cloudflare, Cloud Run API,
      separate Firehose hot worker, Neon Postgres by default, Artifact Registry,
      Secret Manager, Cloud Scheduler, and Cloud Logging/Monitoring.
- [ ] Document deferred cloud services and the thresholds for adding Pub/Sub,
      Cloud Tasks, Cloud Storage, BigQuery, Redis/Memorystore, or Cloud SQL.
- [ ] Document startup nonprofit cost guardrails, including hot/warm/cold
      cadence lanes, budget alerts, source caps, LLM hot-path exclusion, and
      operator cost-spike kill switches.
- [ ] Document the Scout boundary: `scout-dev` remains the local ingest path,
      Scout can seed and enrich Firehose through run-sync/review paths, and
      Scout workers must not be required for the 60-second hot path.
- [ ] Document source target safety policies.
- [ ] Document how to disable a bad source target.
- [ ] Document how to inspect held signals in review queue.
- [ ] Run:

```bash
pnpm exec prettier --check docs/design/firehose/*.md docs/deployment/production.md docs/deployment/staging.md docs/plans/2026-07-05-firehose-mvp-implementation-plan.md
```

Expected: docs formatting check passes or reports only existing unrelated
formatting issues.

- [ ] Commit docs and env examples.

Recommended commit subject:

```text
docs: Document Firehose MVP operations
```

### Task 16: End-To-End Verification

**Files:**

- Review all files touched by prior tasks.

- [ ] Run API Firehose suite:

```bash
cd api && uv run pytest tests/domains/discovery/firehose tests/domains/discovery/test_org_firehose_api.py -v
```

Expected: all Firehose API tests pass.

- [ ] Run broader API checks touched by this work:

```bash
cd api && uv run pytest tests/test_database_schema.py tests/platform/test_production_config.py tests/domains/discovery/test_org_coverage_targets_api.py tests/platform/test_mcp_server.py -v
```

Expected: all selected tests pass.

- [ ] Run API lint/type checks:

```bash
cd api && uv run ruff format .
cd api && uv run ruff check .
cd api && uv run mypy atlas
```

Expected: format, lint, and mypy pass.

- [ ] Run app workspace tests:

```bash
cd app && pnpm vitest run tests/unit/domains/workspace
```

Expected: workspace tests pass.

- [ ] Run app lint/type checks:

```bash
cd app && pnpm run format
cd app && pnpm run lint
cd app && pnpm tsc --noEmit
```

Expected: format, lint, and TypeScript checks pass.

- [ ] Run contract generation checks:

```bash
pnpm run openapi
cd app && pnpm run api-client
pnpm run contract:test
```

Expected: generated contracts are current and contract tests pass.

- [ ] Manual hot-path demo:
  - start API and app with `FIREHOSE_HOT_WORKER_ENABLED=true`;
  - create a workspace coverage target;
  - add a local test RSS source target;
  - publish a new RSS item in the fixture server;
  - confirm the signal appears in coverage detail or watching page within 60
    seconds;
  - confirm the signal source opens;
  - confirm repeated checks do not create duplicates;
  - confirm a sensitive/person-centered fixture routes to review.

- [ ] Closeout commit or PR body must name the end-user outcome: newsroom-grade
      source-backed civic signals appear quickly, preserve provenance, and route
      risky person-centered cases to review.

## Test Fixtures

Create deterministic fixtures inside tests rather than hitting the public
internet.

RSS fixture:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Detroit Civic Updates</title>
    <link>https://example.test/civic</link>
    <description>Public civic updates</description>
    <item>
      <title>City council agenda includes tenant protections</title>
      <link>https://example.test/agendas/tenant-protections</link>
      <guid>agenda-tenant-protections</guid>
      <pubDate>Sun, 05 Jul 2026 12:00:00 GMT</pubDate>
      <description>Agenda item 14 covers tenant protections.</description>
    </item>
    <item>
      <title>Transit coalition announces town hall</title>
      <link>https://example.test/events/transit-town-hall</link>
      <guid>transit-town-hall</guid>
      <pubDate>Sun, 05 Jul 2026 12:01:00 GMT</pubDate>
      <description>The coalition will host a public forum.</description>
    </item>
  </channel>
</rss>
```

Atom fixture:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>County Public Notices</title>
  <entry>
    <title>Notice of funding for housing stabilization</title>
    <link href="https://example.test/notices/housing-funding" />
    <id>housing-funding</id>
    <updated>2026-07-05T12:02:00Z</updated>
    <summary>County announces grant funding for housing stabilization.</summary>
  </entry>
</feed>
```

Web page fixture:

```html
<!doctype html>
<html>
  <head>
    <title>Public Meeting Agenda</title>
  </head>
  <body>
    <main>
      <h1>Public Meeting Agenda</h1>
      <p>Agenda item 8 discusses bus service restoration.</p>
    </main>
  </body>
</html>
```

## Acceptance Criteria

The MVP is complete when all of these are true:

- A workspace can create, list, update, and disable Firehose source targets for
  its own coverage targets.
- The hot worker can claim due source targets with leases.
- RSS, Atom, and exact web page source targets are fetched without public
  network calls in tests.
- New artifacts are fingerprinted and stored idempotently.
- Repeated source checks do not duplicate artifacts, signals, routes, sources,
  or digest events.
- Signals are classified without an LLM in the hot path.
- Signals preserve source URL, title, detected time, relevant passage,
  confidence, sensitivity, public realm basis, and route state.
- Existing Atlas records can be linked conservatively.
- Person-centered, sensitive, ambiguous, or low-confidence signals are held for
  review.
- Low-risk workspace signals route into `org_change_events` as `civic_signal`.
- Coverage detail shows hot sources and live signals.
- Watching/digest surfaces show Firehose signal context.
- API consumers can list recent signals with provenance attached.
- The manual demo can show a new RSS item appearing in the product within 60
  seconds of source reachability.
- OpenAPI and generated TypeScript client are current.
- Focused backend tests, focused frontend tests, lint, type checks, and contract
  tests pass.

## Non-Negotiable Guardrails

- Every visible signal must link back to a source.
- Every person-centered signal must have a public-realm basis.
- Do not infer private ideology, vulnerability, personality, or susceptibility.
- Do not collect hidden, private, credentialed, or scraped personal data.
- Do not strip provenance from API, MCP, digest, or export responses.
- Do not use vague user-facing copy about internal collection state.
- Do not let customer workspace routing bypass trust and safety rules.
- Do not auto-create public person profiles from hot-path signals.
- Do not add a raw public firehose page in the MVP.

## Implementation Order For Multiple Agents

Recommended parallelization:

- Agent A: Tasks 1, 2, 8.
- Agent B: Tasks 3, 4, 5, 6.
- Agent C: Tasks 7, 9, 10.
- Agent D: Tasks 11, 12, 13.
- Agent E: Task 15 and final docs cleanup.

Coordination rules:

- Task 1 must land before Tasks 2, 7, 8, or 9.
- Task 2 must land before Tasks 7, 8, or 9.
- Tasks 3 through 6 can run after Task 2 starts if dataclass names are stable.
- Task 7 must land before Task 13.
- Task 9 must land before Task 10 and Task 11.
- Task 10 must land before frontend code imports generated Firehose types.
- Task 16 runs after all other tasks.

## Rollback Plan

If hot worker behavior is unsafe in staging or production:

1. Set `FIREHOSE_HOT_WORKER_ENABLED=false`.
2. Disable affected source targets by setting `enabled = FALSE`.
3. Keep API reads available so existing signals remain inspectable.
4. Suppress unsafe signals by setting `route_state = 'suppressed'` and
   `visibility_scope = 'reviewer_only'`.
5. Keep review queue rows for audit.
6. File a follow-up issue with source target id, signal id, connector kind,
   failure mode, and user-facing impact.

## Closeout Checklist

- [ ] `git status --short` shows only intended Firehose files or known unrelated
      local work.
- [ ] `git diff --check` passes.
- [ ] Placeholder scan passes:

```bash
bad_firehose="fire""bhose"
bad_detailing="dea""iling"
bad_granularity="granul""airty"
forbidden_pattern="UNFILLED_MARKER|UNFILLED_SECTION|as[ ]any|${bad_firehose}|${bad_detailing}|${bad_granularity}"
rg -n "$forbidden_pattern" \
  docs/plans/2026-07-05-firehose-mvp-implementation-plan.md \
  docs/design/firehose \
  api/atlas/domains/discovery/firehose \
  app/src/domains/workspace
```

- [ ] API tests listed in Task 16 pass.
- [ ] App tests listed in Task 16 pass.
- [ ] OpenAPI and generated app client are current.
- [ ] Manual hot-path demo is recorded in PR notes.
- [ ] PR explains the end-user experience: a newsroom or civic team can see
      source-backed public civic signals quickly, inspect why they matched, and
      trust that risky signals are routed to review.
