# Cloudflare-only runtime validation

Evidence for the
[Cloudflare-only hosting plan](../superpowers/plans/2026-10-10-cloudflare-only-hosting.md).
The user authorized immediate cutover on October 10, 2026, waiving the 24-hour
staging and 72-hour production waits. Functional, privacy, rollback and
Free-plan checks remain required. Atlas production has not cut over; the
organization website has completed its Cloudflare cutover. The waiver changes
the waiting periods, not the evidence required to protect existing users.

## Organization website

`rebuildingus.org` and `www.rebuildingus.org` now use Cloudflare Worker
`rebuilding-america-website`. The latest verified deployment has version prefix
`0e132a50` and website source prefix `5fecdc0`. The apex preserves its 307
redirect, including paths and queries. Home, About, assets, robots, missing-page
behavior, rendered navigation and contact links passed; mail DNS remained
unchanged.

The
[production workflow](https://github.com/RebuildingAmerica/website/actions/runs/38115026693)
passed using a scoped Cloudflare credential. Retained-version rollback and
restoration were exercised. The website repository documents deployment and
rollback in `docs/operations/hosting.md`. The old website Vercel project is
paused, disconnected from Git, and has no attached domains. Atlas is the
remaining active dependency on the shared paid Vercel subscription; website
retirement alone does not establish cancellation of that charge.

## Python API and native packages

The protected Python candidate runs in a SQLite Durable Object with uncached
Hyperdrive to the existing PostgreSQL database. A JavaScript edge dispatcher
keeps Python work within the object's separate runtime limits.

[Wheel build 38111236789](https://github.com/RebuildingAmerica/atlas/actions/runs/38111236789)
passed all nine targets, including exact locked XML, cryptography, validation,
archive and name-parser native dependencies. Artifact hashes are verified before
installation. No Atlas dependency was downgraded. Large unchanged classifier
tables are compiled with Python 3.14 to avoid runtime compiler memory spikes.
Deployed Deflate64 decoding returned the expected 4,017 bytes; person, bank and
annotated-name classifications retained their existing results.

Full API dependencies exceeded the provider's upload limit when bundled as
ordinary files. Pure packages now use an immutable compressed asset, verified by
SHA-256 before zipimport. Native libraries remain filesystem modules. Babel
locale data retains identical decompressed bytes and formatting behavior.

Earlier version `65084634-6cc9-4a90-a17d-a548f722155e`, source
`c3cc1c5d48930dd9bcc8046f472725864e1a185a`, deployed the complete package graph.
Its probes established health, UTC PostgreSQL conversion, connection closure and
unauthenticated Access rejection, but Atlas construction rejected missing
production auth audiences. Existing Cloud Run API settings were then recovered
read-only and checked against the web service's database and internal
authentication secret.

Version prefix `44b88f`, source `234848ff`, exposed unsupported thread creation
in synchronous FastAPI dependencies. The hosted adapter now explicitly adapts
the six nonblocking dependencies to async calls; the Node runtime keeps its
existing behavior. The complete API suite passed 2,456 tests with 100% branch
and statement coverage before subsequent discovery continuation changes.

The hosted framework snapshot at `2026-10-11T06:39:31Z` uses version
`e072d15b-f7ac-4d1d-800d-acc4841cc995`, source `99b6c798`. Health, UTC
PostgreSQL conversion and connection closure pass; anonymous Access requests are
rejected. Catalog listing, nonempty housing search and empty search now return
HTTP 200. Both nonempty responses contain two complete entity records; entity
detail and slug resolution identify the expected entity and retain its two
linked sources. Private lists reject anonymous application requests with
HTTP 401. This is API evidence, not acceptance of profile SSR, sign-in,
workspaces or MCP.

The database fix uses unnamed prepared statements after materializing each
result, avoiding the named-statement cleanup that previously closed the
Hyperdrive connection during nonempty search. Four real PostgreSQL tests
preserve cursor shapes, transactions, cancellation and cleanup while verifying
zero named-statement resources. The deployed search results validate the fix
through Hyperdrive too.

JWT libraries now load only after a bearer token and configured audience are
present; six focused helper tests and 211 access tests pass. The extraction SDK
now loads only when extraction has a key and source content. Existing two-pass
extraction, grounding and retries pass seven tests. Hosted application module
count fell from 2,174 to 1,149, and application construction fell from 7.8 to
6.4 seconds. Some requests retain the same application/object/isolate: one warm
empty search took 478ms and an anonymous private-list check took 665ms. Other
catalog/source requests still take roughly 9–10 seconds and show cold
reconstruction. These observations do not pass the latency or quota gates.
Provider logs record roughly 8.1–8.4 seconds of CPU for earlier catalog calls;
they show successful outcomes, without an explicit memory-limit failure. Do not
infer zero memory pressure from that absence.

The cryptography preload experiment was rejected with error 10021,
`Top-level await in module is unsettled`. After JWT imports became lazy, a full
`atlas.main` snapshot was instead rejected with error 10027, exceeding the 64
MiB uncompressed Worker size limit. Both rejected deployments left the then-live
candidate unchanged. The deployed candidate retains the accepted
Pydantic/FastAPI/HTTPX snapshot. DNS is bundled with core packages; extraction
assets remain available but ordinary HTTP does not fetch them when configured
inline discovery is disabled. No product dependency was removed.

Sanitized probe evidence is retained in ignored
`.atlas/python-smoke/unnamed-api-probe-results.json`,
`.atlas/python-smoke/lazy-model-sdk-api-probe-results.json` and
`.atlas/python-smoke/lazy-model-sdk-journeys.json`. Original responses and
provider attributes remain private. Cloudflare operations use the new `cf` CLI
with a single in-memory credential session; it does not repeatedly read macOS
Keychain for every provider command.

Twelve concurrent database adapter probes passed through the provider. Local
PostgreSQL tests cover cursor shapes, dates, JSON, commit visibility, rollback
and cancellation cleanup. MCP HTTP requests use request-owned session managers;
HTTP startup must not initialize schema or start process polling loops.

## Canceled timers and idle duration

Pyodide 314.0.7 canceled Python handles without clearing their retained
JavaScript timers. An asyncpg deadline could therefore keep an otherwise
completed object invocation alive for 30 seconds. The adapter now clears the JS
timer and releases its callback proxy on cancellation, only on the selected
Pyodide loop.

A hosted fixed probe completed with 26ms CPU and **27ms object wall time**; its
JavaScript edge used 0ms CPU and 54ms wall time. The baseline retained deadlines
extended a subsequent invocation to 29,784ms. These are controlled timer probes,
not whole-application performance measurements. Sanitized evidence is retained
in ignored `.atlas/python-smoke/timer-comparison.json`.

## Shared usage and remaining gates

The authenticated dashboard observation at `2026-10-11T05:21:32Z` showed 18,850
Workers requests for the displayed day and 22.08k for October 1–11. Durable
Objects showed 249 GB-seconds and 1.66k requests for the displayed day. The
sanitized observation is retained in ignored
`.atlas/python-smoke/shared-free-usage-dashboard.json`. These are cumulative
snapshots with provider aggregation delays, not historical peak measurements or
a complete doubled-traffic forecast. Earlier lower readings are superseded by
this observation; successful probes alone do not establish Free-plan headroom.

Both retained PDS VMs are running and their public health endpoints respond
successfully. Google billing remains closed. Actual API search/profile/MCP,
identity isolation, bounded resumable discovery, firehose delivery, full web
journeys, runtime latency/memory/quota forecasts and coordinated rollback still
need hosted acceptance. Local discovery checkpoint storage now retains web
evidence between worker invocations. That does not establish a complete
resumable hosted discovery run; the existing 10–20 minute pipeline still needs
bounded execution and recovery acceptance. Do not silently disable that
capability or claim it is migrated.

Commit `234848ff` connects hosted observation producers to an instance-owned
Firehose alarm. Local tests cover atomic observation/outbox commits, concurrent
duplicate producers, rollback, lost acknowledgements and restart reconciliation;
123 Firehose tests passed with 100% coverage of the three changed API modules,
and 44 hosted tests passed. No hosted delivery is claimed. Existing rows still
need an explicit initial wake on the selected production object; the current
`application` and evaluation `compatibility` object names have separate wake
storage. The process-worker enable flag does not pause hosted alarms. Safe
activation, old-consumer handoff and recovery of abandoned wake receipts remain
operational work.

The shared Vercel subscription remains active. Completion requires Atlas's
production cutover and confirmed cancellation or downgrade of that charge.
