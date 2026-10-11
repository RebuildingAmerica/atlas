# Cloudflare-only hosting implementation plan

> For agentic workers: use superpowers:executing-plans to implement this plan
> inline, with hosted verification before completion.

**Goal:** Keep search, trustworthy source-linked profiles, sign-in, workspaces,
billing, and discovery available without Vercel or reopening Google billing.

**Architecture:** Cloudflare serves exact static assets and routes dynamic web
requests to a SQLite-backed Durable Object. Evaluate the existing FastAPI app in
Python Workers and Python Durable Objects, with PostgreSQL through uncached
Hyperdrive. Replace process polling with durable, resumable job execution.
Existing PostgreSQL, PDS identities, records, and public URLs remain intact.

**Tech stack:** TanStack Start, React, Vite, Python/FastAPI, PostgreSQL,
Hyperdrive, Workers, SQLite Durable Objects, and the pinned new `cf` CLI.

**Spec:** The user's original migration plan, amended on October 10, 2026 to
permit moving API and discovery compute to Cloudflare and evaluating each
runtime against its own limits. This supersedes the original requirement to
preserve Google-hosted compute and apply a whole-app 8ms CPU gate to Durable
Objects. The user subsequently authorized immediate cutover on October 10 and
migration of the organization website, waiving the 24-hour staging and 72-hour
production waiting periods. Privacy, runtime compatibility, and functional
checks still protect usable sites.

## Global constraints

- Cloudflare Free only; Google billing stays closed. No paid fallback.
- Use `cf` for every Cloudflare provider operation. No Wrangler CLI or raw
  Cloudflare API client. Build tools may produce cf Build Output locally.
- Preserve existing functionality and data. No replacing missing native
  dependencies with lower-quality extraction or silently disabling jobs.
- Keep local Node/SQLite and Python deployments usable. Hosted migrations are
  serialized release jobs; no schema creation in HTTP handlers.
- Keep secrets out of bundles, manifests, command arguments, and logs. Protect
  hosted candidates with Access before attaching a public hostname.
- Measure edge Workers, app objects, API, and jobs separately, including memory,
  startup, duration, database queries, subrequests, and shared account usage. An
  edge CPU measurement does not stand in for application CPU.
- Require twice-current workload below 80% of all applicable Free allowances.
  Unknown usage remains a release blocker. Budget alerts are not spending caps.
- Cut over as soon as hosted functional checks and rollback pass, without a
  timed staging or production observation window. Migrate the organization
  website as well and verify the recurring Vercel charge has ended.

## Review focus

Review concurrent identity isolation, private cache behavior, ASGI lifespan and
MCP streams, PostgreSQL transactions, job leases/checkpoints, source fidelity,
native package compatibility, idle object duration, artifact provenance, and
rollback compatibility. Public HTTP 200s alone do not satisfy acceptance.

## 1. Prove the Python runtime before porting the API

**Files:** `services/api-cloudflare/`, `scripts/deploy/api-cloudflare-*.mjs`,
deployment tests, and `docs/deployment/web-hosting-validation.md`.

**Interface:** A reproducible secret-free cf Build Output artifact and a
non-promotable hosted compatibility report tied to its source and digest.

- [x] Build a minimal Python candidate using cf's Python module manifest.
- [x] Deploy behind Access with the existing uncached Hyperdrive binding.
- [x] Prove FastAPI, asynchronous PostgreSQL through `asyncpg`, UTC conversion,
      request cleanup, and Python Durable Object dispatch on the provider. The
      `psycopg` candidate failed because `libpq` was unavailable.
- [ ] Prove concurrent database reads, cancellation cleanup, and the complete
      runtime package imports on the provider.
- [ ] Resolve the full API and discovery dependency graph for the target Pyodide
      runtime. Exercise native extraction/name parsing/archive decoding; record
      precise unsupported packages rather than assuming compatibility.
- [x] Commit the repeatable build/probe interface and
      [measured evidence](../../deployment/cloudflare-python-validation.md).

## 2. Restore search, profiles, and MCP through the existing API

**Files:** `api/atlas/main.py`, `api/atlas/models/database.py`,
`api/atlas/platform/config.py`, new runtime adapter, and API behavioral tests.

**Interface:** Existing OpenAPI and MCP contracts; request-owned Hyperdrive
connections; explicit hosted release schema version.

- [ ] Inject immutable provider configuration without mutating shared process
      environment between requests. Preserve UTC conversion and SQL semantics.
- [ ] Separate ASGI startup from migrations and process background workers; keep
      MCP lifespan correct through response completion and cancellation.
- [ ] Preserve auth introspection, rate limiting, trusted forwarding headers,
      CORS, health, documentation, entity and profile route behavior.
- [ ] Run API coverage and deployed search/profile/MCP contract checks against
      existing PostgreSQL without destructive fixture writes.
- [ ] Bind only API-owned routes from the web candidate to the API service.

## 3. Move discovery and delivery off process polling

**Files:** discovery job worker, firehose delivery worker, scheduler adapters,
Cloudflare job entrypoint/configuration, and lease/retry behavioral tests.

**Interface:** Existing durable PostgreSQL job records, lease ownership,
idempotency keys, status/progress/cancellation and delivery contracts.

- [ ] Inventory every scheduled/background service and PDS dependency before
      claiming Google independence; preserve records and cryptographic
      identities.
- [ ] Use durable alarms and bounded checkpointed work. Never keep an idle
      polling loop alive or rely on a request's in-memory task for job
      durability.
- [ ] Preserve extraction, source attribution, deduplication, moderation and
      delivery behavior; split work only at durable transaction boundaries.
- [ ] Test termination, retry, lease loss, duplicate wakeups, cancellation, long
      invitations, and a representative hosted discovery/delivery run.
- [ ] Measure CPU, duration, memory, queries and upstream costs per job, then
      forecast the complete shared account at current and twice-current traffic.

## 4. Make Cloudflare the sole hosted release path

**Files:** release/doctor/promotion/rollback scripts, GitHub deployment
workflows, runtime manifests, `docs/deployment/web-hosting.md`.

**Interface:** A single release manifest pins web/API/job artifacts, versions,
bindings, schema and digests; secret values remain external.

- [ ] Choose object topology from measured load and idle duration rather than
      retaining the four-shard diagnostic configuration by default.
- [ ] Enforce runtime-specific CPU/startup/memory and shared quota gates. Keep
      the original latency and complete journey gates; no CPU-limit failures.
- [ ] Automate provisioning, secrets/config validation, staging, promotion,
      migration, rollback, quota telemetry and alerts using `cf`.
- [ ] Verify full quality/coverage/workflow and hosted identity, search, maps,
      SSR, mobile, SSO, email, invitation and Stripe journeys without weakened
      gates.
- [ ] Remove obsolete hybrid/Vercel deployment dependencies after selection;
      retain the Node/self-hosted build.

## 5. Cut over and end the Vercel charge

- [ ] Complete hosted functional checks and a cross-service rollback drill; the
      user waived the timed staging window.
- [ ] Capture Vercel routes and deployment, switch the existing production
      domain, and immediately verify sign-in, profiles, workspaces and billing.
- [ ] Verify production immediately; roll back for broken journeys, privacy
      failures or failed performance/quota gates. The user waived the timed
      production observation window.
- [ ] Resolve the shared `rap-website` project dependency before cancelling or
      downgrading the team subscription; verify the recurring charge has ended.

Until these gates pass, Vercel remains the production web host. A compatibility
candidate is evidence toward the migration, never a production release.
