# Milestone 10: Steward Management and Public Display

**Status:** Complete

## Objective

Let verified stewards manage the identity displayed on a public profile and
render that identity in provider-neutral, provenance-aware language.

## Scope

- Public identity management field.
- Attach, replace, remove, and connect-another actions.
- Person and organization public labels.
- Attention and verification-date presentation.

## Delivered

- [x] Added identity selection to verified profile management.
- [x] Required confirmation for replacement and removal.
- [x] Preserved account control when removing public display.
- [x] Rendered handles as identity text rather than fabricated Bluesky links.
- [x] Hid stale handles and tolerated absent or malformed verification dates.

## Acceptance criteria

- Only active, verified controlled identities are selectable.
- Cancelled and failed mutations leave the existing public identity intact.
- Organization profiles say `Representative ATProto account`; people say
  `ATProto account`.
- Needs-attention state never publishes the stale handle.

## Evidence

- Primary commit: `ac5e1cab`.
- Behavior coverage: `e2a4a78a`, `9e97404f`, `782d4000`, `1d4dace9`, `079953b4`.
- Tests: manage route and profile data-quality suites.
