# Milestone 05: Verified-Steward Profile APIs

**Status:** Complete

## Objective

Let a verified profile steward attach, replace, or remove a controlled identity
from a public profile without changing account control or workspace membership.

## Scope

- Explicit attach and remove endpoints.
- Replacement confirmation semantics.
- Verified-claim authorization.
- Independent account and profile lifecycle behavior.

## Delivered

- [x] Added steward-only attach and detach operations.
- [x] Required an active controlled identity for attachment.
- [x] Required explicit replacement when a profile already has a link.
- [x] Kept account control intact when a public link is removed.
- [x] Invalidated account and entry caches after mutations.

## Acceptance criteria

- Unverified claimants and unrelated users cannot mutate a profile link.
- Attach rejects disconnected, conflicted, or attention-required identities.
- Replace preserves historical provenance and removes only the active display.
- Remove does not disconnect the identity from Account settings.

## Evidence

- API delivery is included in `fb2fdf43` and relation work in `c4779be0`.
- App hooks and steward behavior: `ac5e1cab`.
- Tests: `api/tests/domains/catalog/test_profile_manage_api.py`.
