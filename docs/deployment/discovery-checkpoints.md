# Durable discovery preparation

Interrupted research must retain its source evidence so visitors can eventually
find the same sourced people and organizations without paying to repeat
completed model calls. `advance_web_discovery` implements the first durable
boundary for the existing search pipeline. It is opt-in; the existing worker and
HTTP routes continue to use the full pipeline.

## Implemented boundary

An invocation performs at most one new search query, including that query's page
fetches, or one source extraction. Completed outputs live in
`discovery_web_checkpoints`, keyed by queue job and unit. A manifest freezes
query order and the research date. The input fingerprint includes the run,
location, state, issue areas, research goal, query cap, and checkpoint format
version. Changing these inputs requires a new run instead of mixing research
targets.

The caller opens and closes its own connection and supplies its active job
lease. Each database read, spend reservation, and checkpoint write verifies the
job ID, run ID, unique owner, active status, and unexpired lease. Short row
locks fence checkpoint writes against reassignment and cancellation; no database
transaction spans external provider work. The caller must discard the connection
on an unhandled database error.

Each new provider unit has a 120-second asynchronous deadline. Completed units
are reused after a new connection or worker owner resumes the job. Duplicate
URLs are extracted once, retaining the first fetched source and all existing
source date/context fields. An unfinished unit may repeat after a crash; each
attempt reserves its estimated spend before calling the provider. Completed
units incur no additional ledger charge. The existing cost ceiling and kill
switch still gate every new attempt. This does not claim exactly-once vendor
billing.

The checkpoint table contains source outputs, not credentials or live clients.
Its rows are internal and have no HTTP endpoint; deleting the owning job
cascades to its checkpoints. It is additive in both bundled database schemas.
Run normal database initialization through the existing operational migration
path before using it with an existing database; HTTP handling does not create
the table.

`None` means more preparation remains. A returned `WebDiscovery` can be passed
as `prepared_web` to `run_discovery_pipeline`. That bypasses completed web calls
and their ledger charges while retaining registry lookup, identity resolution,
ranking, source persistence, review holds, and publication gates. The normal
worker does not activate this path automatically.

## Required before a full discovery alarm can be enabled

1. Checkpoint registry searches by term, preserving organization ordering and
   budgets. Checkpoint filing lookup inside its IRS archive-directory scan and
   return reads. A timeout around `filings_for` alone repeats its archive scan
   and is insufficient for a repeatedly slow archive.
2. Make publication units atomic with their checkpoint and ownership fence.
   Existing resolution, entry, source, review, and summary helpers commit
   internally. Replaying their partially completed finalization is not yet
   guaranteed to preserve review history and aggregate counts exactly.
3. Connect queue enqueue/claim/release to durable wake receipts and alarms. A
   deliberate checkpoint yield must release/requeue without consuming a retry;
   cancellation, transient failure, and exhausted retries retain their existing
   meanings. Keep a rescue alarm before database or network work and reconcile
   committed jobs after isolate loss. Firehose's separate alarm is not a
   discovery scheduler.
4. Validate production-shaped source sizes, Python import/parse CPU, memory,
   PostgreSQL concurrency, and timeout/cancellation on the hosted Free runtime.
   `asyncio.timeout` bounds awaited work; it cannot preempt synchronous parsing.
   Completed evidence is currently rehydrated to compose the full prepared web
   result, so memory remains proportional to the run's retained sources.

This change does not deploy a discovery alarm, select a paid provider plan,
change Google billing, or make the monolithic registry/publication path safe
under the alarm wall-time limit.
