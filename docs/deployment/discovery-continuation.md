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
require evidence. The caller still owns deliberate lease release, alarm
scheduling, retry policy, web-candidate publication, and final run completion.
Ranking and deduplication also retain their existing whole-run behavior.

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
