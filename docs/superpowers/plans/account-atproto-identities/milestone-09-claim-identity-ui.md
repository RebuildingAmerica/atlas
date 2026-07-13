# Milestone 09: Person and Organization Claim Identity Selection

**Status:** Complete

## Objective

Let person and organization claimants select an identity already controlled in
Account settings or connect another identity without losing claim work.

## Scope

- Shared identity selector.
- Person and organization claim policy integration.
- Same-tab draft persistence and restoration.
- Callback error recovery and explicit cancellation.

## Delivered

- [x] Replaced the organization-only handle field with a shared selector.
- [x] Filtered out disconnected and unhealthy identities.
- [x] Added Connect another account with claim-route return context.
- [x] Persisted all public and private draft fields through OAuth.
- [x] Cleared drafts after submission or cancellation.

## Acceptance criteria

- A restored identity remains selected after OAuth.
- A person claim submits for review rather than being intercepted by the UI.
- Organization proof requirements remain visible and enforced.
- Corrupt, primitive, incomplete, and server-side draft storage are safe.

## Evidence

- Primary commit: `865fb673`.
- End-to-end and storage coverage: `b44648c3`, `0964f09e`, `ecee5f24`.
- Tests: claim route, submission panel, draft, and acceptance suites.
