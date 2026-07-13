# Milestone 11: Acceptance and Product Alignment

**Status:** Complete

## Objective

Prove the external-provider identity experience end to end, align product
documentation with the shipped account-first boundary, and leave reproducible
quality gates.

## Scope

- Browser acceptance across account, claim, and steward journeys.
- SQLite and PostgreSQL API verification.
- OpenAPI drift and generated-client verification.
- Product roadmap, inventory, transition, and PRD alignment.

## Delivered

- [x] Covered Bluesky and custom-provider connection.
- [x] Covered refresh, disconnect, reconnect, and unchanged workspace context.
- [x] Covered person claim submission, organization proof, draft restoration,
      callback recovery, and steward replacement/removal.
- [x] Updated product documents to separate identity, stewardship, and
      workspace.
- [x] Made PostgreSQL test URL propagation explicit in the API Turbo task.

## Acceptance criteria

- Account, claim, callback-recovery, and steward journeys pass in a real
  browser.
- SQLite and PostgreSQL suites prove the same identity invariants.
- Generated API clients and both checked-in OpenAPI artifacts show no drift.
- Product documents describe Account ownership, profile stewardship, and
  workspace membership as separate relationships.
- The complete pre-push gate passes without skipped PostgreSQL coverage.

## Verification record

- App behavior: 2,453 tests passed after rebase.
- API: 2,130 tests passed with 100% coverage using PostgreSQL 16.
- Scout: 960 tests passed.
- Contract: 14 OpenAPI tests passed.
- ATProto browser acceptance: Account and claim/steward suites passed.
- Pre-push: all 19 Turbo tasks passed.

## Evidence

- Acceptance commit: `7ccf6c94`.
- Product alignment: `f108b027`.
- Test-environment closeout: `c1298e67`, `1874dfdd`.
- Product sources: `docs/product/atproto-native-identity-transition.md` and PRDs
  03 and 07.

## Deferred follow-on milestones

Atlas-managed PDS hosting, ATProto-first sign-in, workspace identity ownership,
delegated administration, and federated publishing require new approved plans;
they are not incomplete work in this milestone.
