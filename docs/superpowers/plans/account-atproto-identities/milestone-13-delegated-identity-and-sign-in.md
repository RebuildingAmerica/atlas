# Milestone 13: Delegated Identity and ATProto Sign-In

**Status:** Ready for live verification

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
administration, and revoke that grant immediately. The UI reads its active
identity and delegation state from the typed organization contract; API
authorization remains the enforcement boundary.

## Remaining work

- Run browser, staging, and production verification after the full user-facing
  flows are complete.
