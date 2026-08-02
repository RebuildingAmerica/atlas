# CI Cache Resource Control Design

## Goal

Reduce routine Atlas CI resource use without weakening release verification.
App-only changes must not run Python tests, Python-only changes must not run
frontend tests, and production releases must continue to run the complete test
graph.

## Design

The existing changed-surface classifier remains the source of truth. The test
job will map its two outputs to three explicit paths: both outputs run the full
Turbo test graph, Python-only runs the existing `python:test` selector set, and
app-only runs the app test plus its workspace dependencies through Turbo's
validated `@rebuildingamerica/atlas-app...` filter. The independent
`entity-widgets-mcp` package is selected explicitly because it belongs to the
app surface but is not in the app's dependency graph.

The local Turbo cache stored by GitHub Actions will use a key scoped by job,
ref, commit, and task-graph inputs. Job scope prevents parallel writers from
racing; commit scope permits each successful run to save newly produced entries;
restore prefixes reuse the newest compatible cache for the same job and branch.

The currently rejected Vercel remote-cache credential will no longer be injected
into CI. GitHub Actions cache becomes the working cache path until a separately
verified remote-cache credential is intentionally restored. This removes failed
authentication calls and keeps deployment independent of manual Vercel CLI
sessions.

## Verification

Repository workflow-contract tests will assert all three routing paths,
cache-key isolation, and absence of remote-cache credentials. Turbo dry runs
will prove the app filter includes the app's relevant workspace dependencies and
excludes Python test suites. Production profile classification will remain
covered as a forced full run.
