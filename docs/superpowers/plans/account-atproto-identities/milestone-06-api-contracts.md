# Milestone 06: OpenAPI and Generated Contracts

**Status:** Complete

## Objective

Make the independent identity lifecycle available through checked-in OpenAPI and
generated TypeScript contracts without exposing retired schema fields.

## Scope

- FastAPI schema export.
- Root and Mintlify OpenAPI artifacts.
- Orval client regeneration.
- Contract drift validation.

## Delivered

- [x] Exported lifecycle and steward operations.
- [x] Added identity, control-status, resolution-status, and profile summaries.
- [x] Removed retired ownership fields and routes.
- [x] Regenerated the TypeScript client and barrel exports.
- [x] Kept root and documentation artifacts byte-aligned.

## Acceptance criteria

- Each operation ID appears exactly once.
- `AtprotoIdentityResponse` contains no `user_id`.
- Checked-in artifacts reproduce from the application schema.
- App typecheck consumes only generated request and response shapes.

## Evidence

- Primary commit: `5f42754a`.
- Artifacts: `openapi/atlas.openapi.json` and
  `mintlify/openapi/atlas.openapi.json`.
- Contract gate: `scripts/contract-test.sh` and 14 OpenAPI tests.
