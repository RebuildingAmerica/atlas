# Atlas-managed ATProto Identity Design

## Decision

Atlas becomes a monorepo that runs a version-pinned upstream `@atproto/pds`
service alongside the existing web and API services. Atlas does not fork the
PDS. The PDS remains the protocol authority for repos, handles, DIDs, and
sessions; Atlas remains the authority for Atlas accounts, passkeys, workspace
membership, profile stewardship, and audit history.

## Boundaries

- An Atlas user may connect an existing external PDS account through the current
  ATProto OAuth flow, or provision an Atlas-managed identity.
- A managed identity is still represented by the existing global DID row and
  account-control relation. `pds_url` identifies its PDS; a provider field
  records whether Atlas manages the lifecycle.
- The default organization identity is an Atlas-managed PDS identity. An
  organization administrator can instead attach a verified external DID using
  the same OAuth proof flow as a personal connection.
- Organization identity ownership is distinct from personal control. A member
  grants a workspace-scoped delegation; an owner or admin accepts it and may use
  the identity only for that organization. Revocation is immediate and
  auditable.
- ATProto-first sign-in is an alternate account-recovery/sign-in method, not
  account creation. Atlas resolves the DID only after a passkey-backed Atlas
  account has previously linked it. It creates the normal Better Auth session
  only after that identity is verified.

## Service topology

`compose.yaml` gains `atlas-pds`, backed by its own named volume and exposed
through Caddy at `ATLAS_PDS_PUBLIC_URL`. The PDS image and configuration live in
`services/atproto-pds/`; all secrets remain runtime environment variables. The
service owns PDS data and has an explicit health endpoint. Atlas API and web
never read PDS database tables or retain PDS passwords.

## Control plane

The API adds dedicated `organization_atproto_identities` and
`atproto_identity_delegations` relations. Both reference the existing global
identity table. A delegation records the granting account control, organization,
role, status, grant/revoke timestamps, and actor audit data. API mutation
handlers enforce owner/admin membership before accepting an organization link or
delegation and enforce an active delegation before a member acts for an
organization identity.

The app keeps OAuth token handling in `atproto-oauth.ts`. It receives a typed
return context for personal, organization, and sign-in flows. A separate PDS
provisioning adapter calls the configured PDS administrative endpoint and
returns only DID, handle, and PDS URL to the shared persistence path.

## Sign-in safety model

The sign-in page does not advertise ATProto sign-in until the visitor begins the
alternate flow. The callback accepts only an already-linked active control, then
verifies that the corresponding Atlas account is account-ready and has a
passkey. Unknown DIDs, disconnected controls, and passkey-less accounts all
receive the same non-enumerating error. The callback rotates into the existing
Better Auth session rather than inventing a parallel session format.

## Verification

Each milestone adds a focused red/green test before implementation, updates its
plan record, and lands as one focused commit. The final gate includes SQLite and
PostgreSQL migration tests, compose validation, OpenAPI contract tests, app unit
tests, PDS configuration tests, and browser acceptance for personal linking,
organization linking, delegation/revocation, managed provisioning, and the
passkey-gated sign-in path.
