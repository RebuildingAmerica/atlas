# Milestone 13: Delegated Identity and ATProto Sign-In

**Status:** Browser organization managed-identity coverage added; staging and
production verification pending

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
- The managed-PDS adapter has focused unit coverage proving that the E2E harness
  returns only public DID, handle, and fixture PDS URL data without constructing
  an `AtpAgent` account session.

## Remaining work

- Deploy the paired API and app contract to staging, create and link a managed
  organization identity against the hosted PDS, verify the passkey-gated sign-in
  path, then exercise grant, delegated removal, and revocation denial through
  the browser.
- Repeat the same route-level proof in production after staging is healthy.
