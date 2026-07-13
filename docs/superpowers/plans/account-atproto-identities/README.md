# Account-First ATProto Identities Plan Set

**Status:** In progress — managed-identity continuation

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
