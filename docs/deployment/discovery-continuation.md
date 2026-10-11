# Durable discovery preparation

Registry preparation can now retain completed public-source research across
worker invocations. This protects the directory's evidence trail: resuming a run
keeps the same ordered organization candidates, selected IRS returns, role
dates, and source citations instead of repeating earlier requests or discarding
them. The existing Node and Scout pipeline entry points remain unchanged.

`advance_registry_discovery` is an opt-in preparation primitive. Each call
performs at most one registry page, organization filing-list request, archive
catalog request, archive-directory read, return read, or officer classification.
It persists typed progress in the existing discovery checkpoint table under a
registry-specific key. It requires an active job lease with a unique invocation
owner, and checks that lease again before committing new evidence. Cancellation
or ownership replacement prevents the old invocation from saving its result.
Completed work survives a fresh database connection and JSON rehydration.

The caller must retain the original research date and job inputs across all
invocations. Changed inputs or budgets fail explicitly. Raw provider page
limits, first-EIN selection, hundred-organization filing batches, newest/prior
return selection, raw-officer budget stopping, and business-name exclusions
match the existing pipeline. Expected unavailable sources retain the existing
provider's skip behavior. Unexpected failure or cancellation leaves the
unfinished unit replayable; it does not repeat completed units.

`publish_registry_mention` adds an opt-in transaction boundary for one prepared
organization or person. It uses the existing resolution and review rules, defers
helper commits, and commits catalog/source/role/review writes together with a
receipt under the active job lock. A person requires a completed organization
receipt with matching evidence, issue areas, and research date. A retry after a
lost response returns the recorded counts without reapplying changes, preserving
curator decisions made since that commit. Changed evidence under the same unit
key fails explicitly. Unit keys must be stable across invocations.

Publication exceptions and expired leases roll back every write in the unit. A
lost commit acknowledgement requires a fresh connection: its receipt resolves
whether the unit committed. The caller must supply an invocation-owned
connection with no unrelated pending writes. The boundary is database-only and
must not contain provider calls. Cross-run identity concurrency still follows
the existing catalog constraints and resolver rules.

The production discovery consumer remains explicitly paused until its exact
release is accepted and enabled. A provider unit is a bounded number of
operations, not a proven bound on synchronous parsing CPU, archive size,
classifier memory, or checkpoint payload size. Actual hosted limits still
require evidence. Ranking and deduplication retain the existing whole-run
comparison against at most 1,000 catalog entries. Alarm scheduling and hosted
resource validation remain required before production activation.

Local verification uses real ZIP bytes served through byte ranges, compares
resumed filing selection with the existing provider, and restarts between
operations. Database tests cover fresh connections, lease reassignment,
cancellation during a source request, input changes, timeout replay, zero
budgets, and raw-officer batch stopping on both SQLite and disposable
PostgreSQL. Publication tests on both databases exercise rollback after nested
helper commits, commit acknowledgement loss, concurrent retries, exact
organization dependencies, changed inputs and ownership, expired leases, and
preserved curator decisions. These checks are local implementation evidence, not
hosted acceptance or cutover.

`publish_web_entry` applies the existing web trust and duplicate gates in the
same transaction as its receipt, source links, identity keys, and review hold.
The original research date supplies missing observation dates. Its receipt binds
the exact ranked candidate, source evidence, duplicate signal and date.

`finalize_discovery_job` requires the exact web and registry publication
receipts for the prepared bundle. It commits statistics, the existing
source-linked research summary, cleared job ownership, completed queue status
and a final receipt together. Lost final commit acknowledgements can be resolved
by reading the matching terminal receipt; failed or cancelled jobs cannot be
revived. Registry units use stable org:N/person:N keys in preparation order.
These are opt-in primitives; existing Node and Scout execution remains
unchanged.

`advance_claimed_discovery_job` connects these primitives for existing search
and direct URL jobs. A scheduler claims with `checkpointed=True`, uses a fresh
owner and connection, and advances one turn. Successful turns persist progress
and return the job to queued without consuming a retry. Provider failures retain
attempt costs and existing retry/backoff limits; cost-ceiling stops fail the run
and job together. Cancellation and replaced/expired ownership prevent late
writes or requeue. Credentials remain invocation-owned. A terminal receipt
resolves a lost final response without retrying or reopening the job.

Enrollment is stored before provider work. Updated legacy claimers exclude
enrolled jobs so they cannot restart partial work through the monolithic runner.
All active claimers must run this exclusion before enrolling production jobs.
Unenrolled Node and Scout jobs keep their existing path. No polling process or
hosted alarm is enabled by these changes.

The turn consumer accepts both declared queue modes: search and direct_url.
Direct seeds are frozen into the checkpoint fingerprint, deduplicated after
Scout URL normalization, and expanded one page per turn. They do not generate
search queries or broaden the request into unrelated registry research.
Empty-target search jobs (the existing queue's seeded/evidence capability) do
not invent place queries. Canonical artifacts now allow that exact untargeted
input while still requiring a complete location, state and issue list for
targeted research.

The hosted continuation separates source extraction into the existing identify
and enrich passes. Each turn makes at most one model request, with SDK retries
disabled; every attempt is reserved in the cost ledger before I/O. Completed
passes survive restarts. Each pass keeps its existing three-attempt limit and
source grounding. Credentials are invocation-owned, and model clients close at
the end of the turn. Unfinished attempts may be replayed after a lost response;
the replay is charged independently. Changed ownership cannot publish a late
model response.

Hosted source fetching uses `HostedRuntime.public_source_fetch`, an
invocation-owned `PublicSourceFetcher`. Each call returns an async response
context with its status, headers and a stream of decoded bytes. The provider
must make one global public-egress request with manual redirects, and closing
the context must release/cancel the underlying stream. Search-result pages and
direct seeds both use this capability; a hosted runtime missing it fails
explicitly before fetching. Ordinary Node source clients keep their existing
path.

Atlas validates every redirect, supplies only fresh source-fetch headers for
each hop, and limits a source read to 8 MiB of decoded content, 20 redirects and
20 seconds total. It rejects credentials, ambiguous URL characters, local
hostnames, private/reserved address literals and disguised numeric hosts. Tests
cover concurrent runtime isolation, redirects, body limits, cancellation,
timeouts and closing each response. Syntax checks do not pin DNS.

The provider wrapper and hosted public-egress proof remain required.
Cloudflare's
[strict-public global fetch flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
prevents same-zone origin/security bypass; that statement alone is not a test of
all SSRF or DNS-rebinding cases. Its
[TCP socket restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#troubleshooting)
also exclude Cloudflare IPs, so replacing HTTP fetch with raw sockets would lose
legitimate sources. The ordinary Python path currently checks URL syntax and
literals, and does not claim DNS pinning.

Direct jobs now retain a breadth-first same-host crawl in `crawl_checkpoints`.
The defaults match Scout: depth 2 and 20 enqueued pages per seed, including the
seed itself and failed/filtered pages. All roots are reserved before children;
URL deduplication is global. Sparse pages still contribute their links. Every
turn fetches at most one page, checks the existing budget/kill switch first, and
commits page evidence and its updated frontier together under the active lease.
It yields before any model call. Lost commit acknowledgements reuse the saved
page; a replaced or cancelled owner cannot overwrite newer evidence.

The shared `atlas_discovery_engine.web_content` rules now serve both Scout and
the direct continuation. They preserve Scout's HTML link order, 50-word quality
floor, login/paywall filter, tables, JSON-LD/OpenGraph metadata, source type,
title, publication, and publication date. Page artifacts retain seed, parent,
depth, stable URL task identity, filter/failure reasons and extraction counts.
Original publication timestamps stay in source metadata; observation dates use
the corresponding calendar date. Existing publication receipts and review holds
still control whether discovered entries become visible. No schema change or new
parser dependency is required.

Local verification includes 242 shared-engine tests at 100% coverage, 77 Scout
compatibility tests, and focused API coverage at 100% for crawl, direct
transport and web checkpoints. SQLite and disposable PostgreSQL tests prove
restart, concurrent lease replacement, cancellation, lost commit
acknowledgement, depth, page-count and deduplication behavior. A complete direct
job test verifies metadata/artifacts, model attempt charges and the existing
uncorroborated-source review hold. These are local results, not hosted crawl
acceptance.

The continuation fingerprint changes with these semantics. Previously enrolled
checkpoints cannot be silently reused under the new behavior; production jobs
must not be enrolled until the exact consumer release is accepted. Ordinary Node
and Scout execution retain their existing entry points. Search-query page
fetching retains its existing API behavior; this change expands explicit direct
seeds only.

Structured-resource/PDF parsing, resource-index link discovery and browser
rendering remain explicit feature-parity blockers. Page-count and byte limits
also do not prove bounded synchronous HTML parsing CPU or aggregate checkpoint
memory on Cloudflare. Provider egress, exact hosted resource usage, scheduling,
and all remaining research modes still require acceptance before activation. No
mode is removed from the public API or the existing Scout consumer.

## Production search consumer and queue handoff

`services/api-cloudflare/production/production_discovery.py` exports
`DiscoveryRuntime`; its named object is `application`. Direct Worker requests
are forbidden. The protected operations edge can read `/__atlas/release`,
`/__atlas/consumers` and `/health`. The shared consumer control requires the
internal secret and exact release SHA for state changes. A fresh object or a
changed release starts paused. Pausing waits for the complete in-flight unit,
retains producer receipts and removes the alarm. Enabling arms an initial alarm
before persisting enabled state, which discovers search jobs already in the
queue without requiring a new producer request.

The production adapter needs the explicit `HYPERDRIVE`, `ATLAS_API_SETTINGS`,
release/schema receipt bindings, verified package assets and the sibling
`API_RUNTIME` Firehose wake capability. It loads the verified discovery packages
only when an enabled alarm runs. Construction, release reads and paused alarms
perform no SQL, migration or background polling. Schema installation remains a
separate release operation.

`DiscoveryAlarmAdapter` rescues itself before database I/O, reaps at most one
expired search lease and claims at most one search job with a fresh owner. It
runs the existing checkpointed continuation with invocation-owned settings,
vendor credentials, database connections and public-source transport. Every
connection closes on success, failure or cancellation. It schedules the next
queued/retry time or active lease expiry; an empty queue without unresolved
producer receipts deletes its alarm instead of polling PostgreSQL.

Central job creation prepares a durable receipt before inserting a hosted search
job, commits the queue record, then confirms the receipt. Preparation failure
rolls back; a lost commit acknowledgement retains the receipt for
reconciliation. The alarm reconciles committed IDs from PostgreSQL. Unresolved
receipts remain durable with bounded backoff and are never silently expired.
Ordinary Node job creation keeps its existing behavior, and hosted direct URL
jobs do not enroll or wake the search consumer. This one central hook covers
REST, scheduled runs and MCP producers.

Catalog publication can produce Firehose observations inside a transaction that
defers helper commits. The discovery alarm therefore defers Firehose wake
confirmations until all of its database resources have closed after the outer
transaction. A cancelled/rolled-back transaction can then release its receipt
without racing a later commit; a failed connection close retains the receipt for
recovery. Source observations and their outbox writes remain atomic.

Local tests exercise paused receipt retention, release-bound initial handoff,
search/Scout lane isolation, precommit preparation, lost acknowledgements, retry
and lease scheduling, cancellation, connection cleanup and publication wake
ordering. Provider deployment, exact hosted execution and consumer enable remain
separate acceptance actions. This implementation does not enable a consumer or
change any provider account.
