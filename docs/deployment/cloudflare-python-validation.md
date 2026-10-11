# Cloudflare-only runtime validation

Evidence for the
[Cloudflare-only hosting plan](../superpowers/plans/2026-10-10-cloudflare-only-hosting.md).
The user authorized immediate cutover on October 10, 2026, waiving the 24-hour
staging and 72-hour production waits. Functional, privacy, rollback and
Free-plan checks remain required. Atlas is still on Vercel; the organization
website has completed its Cloudflare cutover.

## Organization website

`rebuildingus.org` and `www.rebuildingus.org` now use Cloudflare Worker
`rebuilding-america-website`, version `99e891b7-7bc9-420a-af18-fb437bcf68a0`,
website source `7931a35de9c9034a17954d18f9ee25589edc67d1`. The apex preserves
its 307 redirect, including paths and queries. Home, About, assets, robots,
missing-page behavior, rendered navigation and contact links passed; mail DNS
remained unchanged.

The
[production workflow](https://github.com/RebuildingAmerica/website/actions/runs/38112472922)
passed using a scoped Cloudflare credential. Retained-version rollback and
restoration were exercised. The website repository documents deployment and
rollback in `docs/operations/hosting.md`. Its old Vercel project remains until
Atlas and the shared subscription can be retired together.

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

Version `65084634-6cc9-4a90-a17d-a548f722155e`, source
`c3cc1c5d48930dd9bcc8046f472725864e1a185a`, successfully deployed the complete
package graph. Health, UTC PostgreSQL conversion, connection closure and
unauthenticated Access rejection passed. Importing Atlas reached application
construction, then correctly rejected missing production auth audiences. This
was not a successful application-route check. The original Cloud Run API
settings have since been recovered read-only and verified against the web
service's database and internal authentication secret; hosted integration is
pending.

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

Dashboard observations showed 18,682 Workers requests on October 11 against the
100,000 daily allowance, with October 1–11 total displayed as 21.91k. Durable
Objects showed 64.7 GB-seconds and 1.49k requests at one read; a later Python
object read showed 81.54 GB-seconds over 24 hours. Different observation times
and aggregation delays mean these figures do not establish historical peaks or a
complete doubled-traffic forecast.

Both retained PDS VMs are running and their public health endpoints respond
successfully. Google billing remains closed. Actual API search/profile/MCP,
identity isolation, bounded resumable discovery, firehose delivery, full web
journeys, runtime latency/memory/quota forecasts and coordinated rollback still
need hosted acceptance. The discovery pipeline currently keeps intermediate
state in memory across 10–20 minute runs; wrapping it in an alarm alone would
not provide safe checkpoints. Do not silently disable that capability or claim
it is migrated.

The shared Vercel subscription remains active. Completion requires Atlas's
production cutover and confirmed cancellation or downgrade of that charge.
