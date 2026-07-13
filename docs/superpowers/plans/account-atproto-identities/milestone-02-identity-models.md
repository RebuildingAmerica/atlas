# Milestone 02: Identity, Control, and Profile-Link Models

**Status:** Complete

## Objective

Make the independent identity graph the only runtime model and resolve identity
health by DID rather than by a mutable handle.

## Scope

- Global identity CRUD.
- User-control connect, reconnect, disconnect, and conflict transitions.
- Profile-link attach, replace, remove, and attention transitions.
- DID-first handle and PDS refresh.

## Delivered

- [x] Added focused control and profile-link model modules.
- [x] Centralized identity matching and lifecycle transitions.
- [x] Propagated successful resolution to current identity metadata.
- [x] Marked failed resolution and dependent profile links for attention.
- [x] Removed the retired user-owned runtime path.

## Acceptance criteria

- Reconnecting the same DID restores the existing control relation.
- A second user receives a privacy-safe conflict instead of duplicate control.
- Refresh starts from the DID and verifies the current handle forward.
- Resolution failure preserves relationships and provenance.

## Evidence

- Primary commit: `36f03d0d`.
- Runtime hardening: `bdfbe187`, `b35ec6be`.
- Tests: `api/tests/domains/catalog/test_atproto_identity_service.py`.
