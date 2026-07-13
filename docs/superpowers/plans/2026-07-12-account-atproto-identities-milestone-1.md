# Account-First ATProto Identities Milestone 1

**Status:** Complete

## Goal

Ship the complete external-provider ATProto identity experience: users manage
identities in Account settings, people and organizations use controlled
identities for profile verification, and verified public links remain
trustworthy across handle changes and staff turnover.

## Architecture

The catalog stores one global identity per DID plus explicit user-control and
profile-representation relations. The app server remains the short-lived OAuth
client; FastAPI owns durable identity state. Account, claim, and profile
management share generated API contracts and one TanStack Query identity cache.

## Plan set

The detailed execution and completion evidence now live in dedicated milestone
plans:

1. [Independent identity graph](account-atproto-identities/milestone-01-identity-graph.md)
2. [Identity, control, and profile-link models](account-atproto-identities/milestone-02-identity-models.md)
3. [Account identity lifecycle API](account-atproto-identities/milestone-03-lifecycle-api.md)
4. [Claims and public relation hydration](account-atproto-identities/milestone-04-claims-and-relations.md)
5. [Verified-steward profile APIs](account-atproto-identities/milestone-05-steward-apis.md)
6. [OpenAPI and generated contracts](account-atproto-identities/milestone-06-api-contracts.md)
7. [Safe OAuth return and persistence](account-atproto-identities/milestone-07-oauth-return.md)
8. [Account Identity experience](account-atproto-identities/milestone-08-account-identity-ui.md)
9. [Person and organization claim selection](account-atproto-identities/milestone-09-claim-identity-ui.md)
10. [Steward management and public display](account-atproto-identities/milestone-10-profile-identity-ui.md)
11. [Acceptance and product alignment](account-atproto-identities/milestone-11-acceptance-and-closeout.md)

The [plan-set index](account-atproto-identities/README.md) defines the shared
boundary and completion rule.

## Approved design

The experience and identity model are defined in
[Account-First ATProto Identities and Profile Claims](../specs/2026-07-12-account-atproto-identities-and-profile-claims-design.md).

## Milestone boundary

This milestone includes every external-provider capability in the approved
design. It excludes Atlas-managed PDS accounts, ATProto-first sign-in,
workspace-owned identities, delegated identity administration, and federated
publishing. Those require separate future plans rather than unchecked items in
this completed plan.

## Final verification

- App: 2,453 tests passed after rebasing onto `origin/main`.
- API: 2,130 tests passed with 100% coverage on PostgreSQL 16.
- Scout: 960 tests passed.
- OpenAPI contract: 14 tests passed.
- ATProto browser acceptance covered Account lifecycle, person and organization
  claims, callback recovery, draft restoration, and steward replacement/removal.
- Repository pre-push: 19 of 19 Turbo tasks passed.

The repository-wide app coverage threshold remains separate historical debt; all
statements changed by this feature were covered during closeout.
