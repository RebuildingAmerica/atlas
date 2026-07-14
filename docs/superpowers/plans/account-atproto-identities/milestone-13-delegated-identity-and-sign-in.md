# Milestone 13: Delegated Identity and ATProto Sign-In

**Status:** Local browser delegated-identity coverage and staging deploy/smoke
verified; signed-in hosted staging and production verification pending

## ATProto-first sign-in

Atlas now offers ATProto as an alternate sign-in path only for a previously
created Atlas account. The callback proves the provider handle and DID, asks the
internal API for an active controller, and passes that user ID directly to
Better Auth's server-only session endpoint.

That endpoint rejects HTTP callers, requires a verified email and at least one
registered passkey, then uses Better Auth's own cookie/session implementation.
Unknown, disconnected, conflict, unverified, and passkey-less identities all
receive the same unavailable outcome.

## Organization administration

An owner or admin can make an existing controlled DID the organization identity,
create-and-attach an Atlas-managed DID, grant a workspace member delegated
administration, and revoke that grant immediately. An active delegate can remove
that organization's public DID association without gaining account-level DID
control or authority over profile content. The removal remains auditable and the
underlying identity stays connected to its controller. A revoked delegate is
denied on the next removal attempt.

The UI reads active identity and delegation state from the typed organization
contract. It exposes identity selection and delegation controls only to owners
and admins, while an active delegate sees only their scoped removal action. API
authorization remains the enforcement boundary.

## Verification added after UI closeout

- Local browser acceptance now signs in through the real auth setup flow,
  upgrades the workspace to team mode, creates an Atlas-managed organization
  identity through the workspace page, attaches it to the organization, and
  confirms the active organization handle is visible. The browser run uses the
  explicit ATProto E2E harness for credential-free managed identity creation so
  production and staging continue to require the real hosted PDS.
- Local browser acceptance now also seeds a second verified workspace member
  through an E2E-only, one-run-secret-gated server route, grants that member
  delegated organization identity administration from the owner account, signs
  the member into a separate browser context, removes the organization identity
  through the delegated UI, reattaches a new managed organization identity,
  revokes the member's delegation, and confirms the revoked member no longer
  sees delegated identity controls.
- The managed-PDS adapter has focused unit coverage proving that the E2E harness
  returns only public DID, handle, and fixture PDS URL data without constructing
  an `AtpAgent` account session.

## Remaining work

- In staging, create and link a managed organization identity against the hosted
  PDS, then verify the passkey-gated sign-in path and the delegated
  grant/removal/revocation journey against the hosted routes.
- Repeat the same route-level proof in production after staging is healthy.

## Hosted staging evidence

- 2026-07-14 staging run
  [`29364644020`](https://github.com/RebuildingAmerica/atlas/actions/runs/29364644020)
  completed successfully for `cf63aace0f22407ae0a1895555a84c6564998e3c`,
  including CI, `deploy-api`, `deploy-pds`, and `hosted-smoke`.
- Hosted smoke verified public ATProto OAuth client metadata, fail-closed
  malformed ATProto sign-in start, staging PDS health, MCP challenge metadata,
  and Cloudflare-backed API health.
- That evidence proves the hosted public route and deploy contract, not the
  signed-in account journey. The remaining staging check must exercise an
  account with a passkey, managed organization identity creation through the
  hosted PDS, delegated grant/removal/revocation, and ATProto-first sign-in.
