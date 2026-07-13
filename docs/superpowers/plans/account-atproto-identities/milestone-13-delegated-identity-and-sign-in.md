# Milestone 13: Delegated Identity and ATProto Sign-In

**Status:** In progress

## ATProto-first sign-in

Atlas now offers ATProto as an alternate sign-in path only for a previously
created Atlas account. The callback proves the provider handle and DID, asks the
internal API for an active controller, and passes that user ID directly to
Better Auth's server-only session endpoint.

That endpoint rejects HTTP callers, requires a verified email and at least one
registered passkey, then uses Better Auth's own cookie/session implementation.
Unknown, disconnected, conflict, unverified, and passkey-less identities all
receive the same unavailable outcome.

## Remaining work

- Present account and organization identity selection with Atlas PDS as the
  default and external-PDS connection as the parallel path.
- Add organization delegate controls and immediate revocation feedback.
- Run browser, staging, and production verification after the full user-facing
  flows are complete.
