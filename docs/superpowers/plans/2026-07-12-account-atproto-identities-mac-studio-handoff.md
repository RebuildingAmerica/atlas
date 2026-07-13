# Account-First ATProto Identities Mac Studio Handoff

**Status:** Archived — implementation complete

**Branch:** `feature/account-atproto-identities`

This file records the original Task 1 handoff. It is no longer an execution
queue. The runtime incompatibilities described in the original handoff were
resolved by Milestone 02, and all 11 external-provider milestones are complete.

## Current sources of truth

- [Master milestone index](2026-07-12-account-atproto-identities-milestone-1.md)
- [Dedicated plan set](account-atproto-identities/README.md)
- [Approved design](../specs/2026-07-12-account-atproto-identities-and-profile-claims-design.md)

## Historical handoff result

The original handoff completed the independent identity graph and instructed the
next worker to replace runtime reads of retired `user_id` and entry identity
columns. That work shipped, followed by lifecycle APIs, relation-backed claims,
steward actions, generated contracts, safe OAuth returns, Account and claim UX,
public display, and browser acceptance.

Do not use this file to infer incomplete tasks. Reopen work only through the
relevant dedicated milestone plan, with new failing evidence and updated
acceptance criteria.
