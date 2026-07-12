# Account-First ATProto Identities Mac Studio Handoff

**Branch:** `feature/account-atproto-identities`

**Handoff point:** Task 1 of the external-provider milestone is complete. Task 2
is next. Atlas-managed PDS accounts and Atlas-hosted handles remain deferred.

## Product boundary

Ship external ATProto linking first. A signed-in user will manage external
identities from Account settings, then use those identities to claim person or
organization profiles. Profile stewardship and workspace membership remain
separate.

The approved architecture stores one global identity per DID, explicit
user-control relationships, and explicit profile-representation relationships.
This keeps public identity provenance stable through handle changes, account
changes, and staff turnover.

## Read first

- Design:
  `docs/superpowers/specs/2026-07-12-account-atproto-identities-and-profile-claims-design.md`
- Execution plan:
  `docs/superpowers/plans/2026-07-12-account-atproto-identities-milestone-1.md`

## Completed on this branch

- `a5b9aa14` defines the account-first identity and profile-claim design.
- `ecb33586` defines the 11-task external-provider implementation plan.
- `679bb705` adds the global identity graph and automated legacy migration.
- `def10702` adds real PostgreSQL migration coverage and CI PostgreSQL setup.
- `35fd03cf` reconciles duplicate-DID controls and locks claim/proof evidence.
- `99759324` includes restored controllers in conflict decisions and serializes
  concurrent PostgreSQL initialization before schema inspection.

Task 1 passed independent specification and code-quality review. Its migration
coverage includes fresh and legacy SQLite/PostgreSQL behavior, partial
deployments, corrupt rollback, duplicate controllers, verified proof provenance,
concurrent initialization, source locking, foreign-key integrity, and
idempotency.

Most recent verification:

```text
Focused local migration suite: 33 passed, 6 skipped
New real-PostgreSQL conflict/concurrency/lock regressions: 3 passed
Ruff: passed
Mypy: 258 files passed
Git diff check and pre-commit hook: passed
```

PostgreSQL-only tests skip locally unless `ATLAS_TEST_POSTGRES_URL` is set. CI
supplies PostgreSQL 16 and runs them automatically.

## Intentionally broken until Task 2

The schema no longer contains `atproto_identities.user_id` or
`entries.linked_atproto_*`. Existing runtime models and helpers still query
those columns. This is deliberate sequencing, not a compatibility path to
restore.

The focused runtime baseline currently reports `9 failed, 10 passed`:

```bash
cd api
uv run --extra dev pytest --no-cov \
  tests/domains/catalog/test_atproto_identity_service.py \
  tests/domains/catalog/test_profile_atproto_api.py -q
```

Failures are `no such column: user_id` and `no such column: linked_atproto_did`.
Do not add dual reads or recreate the retired columns.

## Resume on the Mac Studio

```bash
git fetch origin
git switch --track origin/feature/account-atproto-identities
pnpm install --frozen-lockfile
```

If the branch already exists locally:

```bash
git switch feature/account-atproto-identities
git pull --ff-only
```

Do not merge `origin/main` into this branch. At handoff, the feature branch is
linear but has diverged from `origin/main`; inspect local-main ownership and
rebase only when intentionally synchronizing.

## Next task

Implement Task 2 from the execution plan using test-driven development:

- Rewrite `api/atlas/domains/catalog/models/atproto_identities.py` as global DID
  storage.
- Add `atproto_identity_controls.py` for account control transitions.
- Add `profile_atproto_links.py` for verified profile representation.
- Replace boolean-only refresh behavior in `services/atproto_identity.py` with
  DID-first resolution.
- Rewrite `test_atproto_identity_service.py` first and observe the expected
  runtime failures before changing production code.

Do not start the lifecycle API or Account UI until Task 2 passes its
specification and code-quality reviews.

## Remaining milestone sequence

1. Global identity/control/profile-link models and DID-first refresh.
2. Account identity lifecycle API.
3. Claims, review, revalidation, and public responses on relations.
4. Verified-steward attach/remove API.
5. OpenAPI and generated client.
6. Safe OAuth returns.
7. Account Identity UX.
8. Person and organization claim selector with draft recovery.
9. Steward management and provider-neutral public display.
10. Browser acceptance, product-plan alignment, and complete verification.
