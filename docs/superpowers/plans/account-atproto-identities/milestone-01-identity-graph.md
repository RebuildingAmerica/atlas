# Milestone 01: Independent Identity Graph

**Status:** Complete

## Objective

Replace user-owned ATProto rows and entry-level identity columns with one global
identity per DID, explicit user-control records, and explicit profile links.

## Scope

- Fresh SQLite and PostgreSQL schemas.
- Transactional migration of legacy identities and entry links.
- Duplicate-controller conflict handling.
- Idempotent and resumable initialization.
- Preservation of claim and proof provenance.

## Delivered

- [x] Added `user_atproto_controls` and `profile_atproto_links` in both
      dialects.
- [x] Removed `user_id` ownership from global identities.
- [x] Removed legacy entry identity columns after verified backfill.
- [x] Preserved unresolved links as `reverification_required`.
- [x] Covered partial, corrupt, concurrent, and entry-only migrations.

## Acceptance criteria

- A DID has one canonical global row.
- At most one user has active control; competing legacy controllers conflict.
- Profile links retain claim/proof provenance and survive handle changes.
- Failed migrations roll back without dropping legacy data.
- Repeated initialization is safe on SQLite and PostgreSQL.

## Evidence

- Primary commits: `99b9c310`, `16991d4d`, `dbe47eee`, `96356c96`.
- Hardening commits: `7b1aafd2`, `0cc550f4`.
- Tests: `api/tests/platform/test_database_atproto_schema.py` and
  `api/tests/platform/test_database_atproto_migration_edges.py`.
