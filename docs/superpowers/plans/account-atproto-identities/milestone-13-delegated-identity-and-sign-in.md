# Milestone 13: Delegated Identity and ATProto Sign-In

**Status:** Local browser delegated-identity coverage, staging deploy/smoke, and
signed-in hosted verification verified; production proof still pending

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
- Hosted signed-in verification no longer depends on a developer's browser
  session. The staging-only hosted identity helper prepares run-scoped,
  synthetic passkey-backed accounts and the `test:hosted-identity` Playwright
  suite drives the hosted UI through managed account identity creation, managed
  organization identity creation, delegated grant/removal/revocation, and
  ATProto-first username sign-in.

## Remaining work

- Repeat the same route-level proof in production after staging is healthy.

## Hosted staging evidence

- 2026-07-15 staging run
  [`29395971561`](https://github.com/RebuildingAmerica/atlas/actions/runs/29395971561)
  completed successfully for `7751b8d35075d53a72366370456560dba4f13fc5`,
  including `deploy-api`, `deploy-pds`, `hosted-smoke`, and `hosted-identity`
  against the fresh staging-target preview
  `https://atlas-p453uqrvf-rebuilding-america-project.vercel.app`.
- The `hosted-identity` job ran the signed-in browser proof against that hosted
  preview and passed in 1.2 minutes. It exercised managed account identity
  creation, managed organization identity creation, delegated organization
  identity administration, delegated removal/revocation, and ATProto-first
  username sign-in through the shared “Email or username” sign-in field.
- 2026-07-14/15 staging run
  [`29384065031`](https://github.com/RebuildingAmerica/atlas/actions/runs/29384065031)
  completed successfully for `f0b3b98fba2da7e8c47a3b658948fa0bcb249c9d`,
  including CI, `deploy-api`, `deploy-pds`, `hosted-smoke`, and
  `hosted-identity`.
- The `hosted-identity` job ran the signed-in browser proof against the hosted
  staging app and passed in 1.4 minutes. It exercised managed account identity
  creation, managed organization identity creation, delegated organization
  identity administration, delegated removal/revocation, and ATProto-first
  username sign-in through the shared “Email or username” sign-in field.
- 2026-07-14 staging run
  [`29364644020`](https://github.com/RebuildingAmerica/atlas/actions/runs/29364644020)
  completed successfully for `cf63aace0f22407ae0a1895555a84c6564998e3c`,
  including CI, `deploy-api`, `deploy-pds`, and `hosted-smoke`.
- Hosted smoke verified public ATProto OAuth client metadata, fail-closed
  malformed ATProto sign-in start, staging PDS health, MCP challenge metadata,
  and Cloudflare-backed API health.
- Run `29384065031` added the first signed-in staging proof for a passkey-backed
  account, managed organization identity creation through the hosted PDS,
  delegated grant/removal/revocation, and ATProto-first sign-in. Run
  `29395971561` re-proves that path on the latest branch head.
