# Milestone 03: Account Identity Lifecycle API

**Status:** Complete

## Objective

Expose protected account-level identity operations without leaking internal user
ownership or coupling identity state to a workspace.

## Scope

- Internal OAuth completion.
- Account identity listing.
- Refresh, disconnect, and reconnect behavior.
- Linked-profile summaries and no-store responses.

## Delivered

- [x] Added `/api/atproto/identities` lifecycle routes.
- [x] Removed the retired profile-owned API surface.
- [x] Added one response shape for Account, claims, and management.
- [x] Enforced authenticated ownership and internal completion boundaries.
- [x] Returned conflict and needs-attention states explicitly.

## Acceptance criteria

- External callers cannot invoke internal OAuth completion.
- Responses never expose `user_id`.
- Wrong-user identity operations are rejected without disclosing ownership.
- Disconnect retains the global identity and verified profile provenance.
- Account lists include current status and affected public profiles.

## Evidence

- Primary commit: `fb2fdf43`.
- Tests: `api/tests/domains/catalog/test_atproto_identity_api.py`.
- Router: `api/atlas/domains/catalog/api/atproto_identities.py`.
