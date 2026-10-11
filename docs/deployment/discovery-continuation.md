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

This is not an activated discovery alarm. A provider unit is a bounded number of
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
jobs. A scheduler claims with `checkpointed=True`, uses a fresh owner and
connection, and advances one turn. Successful turns persist progress and return
the job to queued without consuming a retry. Provider failures retain attempt
costs and existing retry/backoff limits; cost-ceiling stops fail the run and job
together. Cancellation and replaced/expired ownership prevent late writes or
requeue. Credentials remain invocation-owned. A terminal receipt resolves a lost
final response without retrying or reopening the job.

Enrollment is stored before provider work. Updated legacy claimers exclude
enrolled jobs so they cannot restart partial work through the monolithic runner.
All active claimers must run this exclusion before enrolling production jobs.
Unenrolled Node and Scout jobs keep their existing path. Direct/evidence modes
are not accepted by this initial turn consumer; their existing consumers remain
unchanged, and their hosted continuation is still required before replacing
those consumers. No polling process or hosted alarm is enabled by these changes.
