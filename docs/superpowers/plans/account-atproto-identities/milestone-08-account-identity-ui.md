# Milestone 08: Account Identity Experience

**Status:** Complete

## Objective

Make Account settings the primary home for connecting and maintaining external
ATProto identities, independent of workspace administration.

## Scope

- Identity settings navigation and empty state.
- Connect, check, reconnect, and disconnect actions.
- Attention and linked-profile states.
- Technical details disclosure.

## Delivered

- [x] Added Identity between Profile and Security.
- [x] Added provider-neutral handle connection.
- [x] Listed connection health, dates, and affected profiles.
- [x] Added confirmation-aware disconnect and reconnect behavior.
- [x] Kept DID and PDS details secondary.

## Acceptance criteria

- The surface works with Bluesky and custom PDS handles.
- Connecting or disconnecting never changes the active workspace.
- Attention-required identities provide a reconnect path.
- Disconnect confirmation explains effects on public profiles.
- OAuth success and failure notices clear transient callback parameters.

## Evidence

- Primary commit: `2e58c73d`.
- Coverage commits: `4b622d65`, `95590a48`, `2b012aea`.
- Tests: Account page, identity component, and identity hook suites.
