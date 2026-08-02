# Production ATProto Proof Gate Design

Status: Approved by the active production-recovery directive

## Goal

Make the production hosted-identity release check exercise ATProto-first sign-in
without turning the synthetic OAuth provider into a public authentication path.
Ordinary production visitors must continue to use real ATProto OAuth.

## User experience protected

Atlas users must be able to trust that signing in with an ATProto handle proves
control of that identity. Release automation may verify the browser journey, but
it must not weaken that proof for real users or allow an anonymous request to
create an Atlas session.

## Design

The sign-in start route decides whether a request may use the hosted provider
harness. Local test runs may use the existing explicit harness flag. A public
deployment may use the harness only when the request passes the existing hosted
E2E guard: the helper is enabled, the production gate is enabled for public
origins, and the `x-atlas-hosted-e2e-secret` header matches.

The decision is passed explicitly to the OAuth service and stored with the
random, expiring OAuth state. A synthetic callback is accepted only when the
stored sign-in state says that exact flow was created for the harness. Supplying
the public harness callback parameters without such state must never create a
session.

The hosted Playwright test adds the secret only to the same-origin
`/api/atproto/sign-in/start` navigation. It does not install the secret as a
global browser header, so redirects to an external provider cannot receive it.
Production continues to leave `ATLAS_ATPROTO_OAUTH_E2E_HARNESS` unset.

## Rejected approaches

- Enabling the global harness flag in production is rejected because every
  sign-in request would bypass real provider proof.
- Driving a real external PDS account from release CI is rejected for this
  incident because it introduces persistent provider credentials and a more
  brittle third-party dependency into the deployment gate.
- Removing the production hosted-identity job is rejected because production
  identity proof is an existing release contract.

## Failure behavior

- A public sign-in request without the hosted secret starts real ATProto OAuth.
- A wrong, missing, or disabled hosted credential cannot select the harness.
- A synthetic callback without matching harness-marked state fails without
  creating a session.
- The harness state remains random, expires through the existing 15-minute OAuth
  store TTL, and is deleted after successful use.

## Verification

Behavioral tests cover the public request gate, explicit OAuth-state marker, and
callback refusal. The focused app tests and repository quality gates must pass
locally. Staging CI must be fully green before a new release tag is created, and
the tagged production workflow must finish with deploy, hosted smoke, and hosted
identity all green. Final verification checks the public staging and production
web, API, and PDS endpoints.
