# Account-First ATProto Identities Plan Set

**Status:** Staging deploy, hosted smoke, and signed-in hosted identity-flow
proof verified; production proof still pending

This directory is the execution record for the external-provider ATProto
identity milestone. The approved design remains in
`../../specs/2026-07-12-account-atproto-identities-and-profile-claims-design.md`.
The files here divide that design into independently reviewable milestones.

## Milestones

1. [Independent identity graph](milestone-01-identity-graph.md)
2. [Identity, control, and profile-link models](milestone-02-identity-models.md)
3. [Account identity lifecycle API](milestone-03-lifecycle-api.md)
4. [Claims and public relation hydration](milestone-04-claims-and-relations.md)
5. [Verified-steward profile APIs](milestone-05-steward-apis.md)
6. [OpenAPI and generated contracts](milestone-06-api-contracts.md)
7. [Safe OAuth return and persistence](milestone-07-oauth-return.md)
8. [Account Identity experience](milestone-08-account-identity-ui.md)
9. [Person and organization claim selection](milestone-09-claim-identity-ui.md)
10. [Steward management and public display](milestone-10-profile-identity-ui.md)
11. [Acceptance and product alignment](milestone-11-acceptance-and-closeout.md)
12. [Atlas-managed PDS foundation](milestone-12-managed-pds.md)
13. [Delegated identity and ATProto sign-in](milestone-13-delegated-identity-and-sign-in.md)

## Boundary

Milestones 1–11 shipped external ATProto providers. The managed-identity
continuation adds Atlas PDS hosting, workspace-owned identity authorization,
delegated administration, and a passkey-gated ATProto sign-in path. Federated
publishing remains explicitly deferred.

## Completion rule

A milestone is complete only when its production behavior, focused tests,
contract implications, and cross-database or browser evidence are present.
Commit hashes identify the branch evidence; they are not substitutes for the
acceptance criteria recorded in each file.

## Latest hosted evidence

- 2026-07-14/15 staging run
  [`29384065031`](https://github.com/RebuildingAmerica/atlas/actions/runs/29384065031)
  deployed branch head `f0b3b98fba2da7e8c47a3b658948fa0bcb249c9d`. CI, API
  deploy, PDS deploy, hosted smoke, and hosted identity verification all
  completed successfully.
- The `hosted-smoke` job verified 7 hosted checks against the Cloudflare-backed
  staging API and `https://atlas-pds-staging.rebuildingus.org`.
- The `hosted-identity` job ran `app/tests/e2e/atproto-identity-hosted.spec.ts`
  against the hosted staging app. Its single serial browser proof passed in 1.4
  minutes, exercising run-scoped passkey-backed accounts, managed account
  identity creation, managed organization identity creation, delegated
  organization identity removal/revocation, and ATProto-first username sign-in
  without using a developer browser session.
- 2026-07-14 staging run
  [`29364644020`](https://github.com/RebuildingAmerica/atlas/actions/runs/29364644020)
  deployed branch head `cf63aace0f22407ae0a1895555a84c6564998e3c`. CI, API
  deploy, PDS deploy, and hosted smoke all completed successfully.
- The post-deploy staging PDS health probe passed against
  `https://atlas-pds-staging.rebuildingus.org/xrpc/_health` with upstream PDS
  version `0.4.5009`.
- Hosted smoke currently proves public ATProto OAuth client metadata,
  fail-closed malformed ATProto sign-in start, staging PDS health, MCP OAuth
  challenge metadata, and Cloudflare-backed API health. It does not replace the
  remaining signed-in staging proof for managed identity creation, delegated
  organization identity administration, or passkey-gated ATProto-first sign-in.
- Commit `94cd2091` adds the staging `hosted-identity` workflow lane and commit
  `812df566` adds the Playwright suite it runs. That suite prepares run-scoped,
  synthetic passkey-backed accounts through a staging-only helper route, drives
  the hosted UI for managed account and organization identities, proves
  delegated organization identity administration, and exercises ATProto-first
  username sign-in without using a personal browser session. Run `29384065031`
  is the first passing GitHub Actions evidence for that lane. Production route
  proof is still required before this plan can be marked production-ready.
