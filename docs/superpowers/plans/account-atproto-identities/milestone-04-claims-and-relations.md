# Milestone 04: Claims and Public Relation Hydration

**Status:** Complete

## Objective

Authorize claims through active identity control and derive public ATProto
fields from verified profile relations while retaining claim provenance.

## Scope

- Person and organization claim submission.
- Reviewer evidence and verification policy.
- Relation-backed public profile hydration.
- Revalidation and attention propagation.

## Delivered

- [x] Replaced ownership assumptions in claim and review paths.
- [x] Required active control for submitted identity IDs.
- [x] Kept person claims reviewable and organization trust thresholds intact.
- [x] Derived public handle, DID, verification time, and status from relations.
- [x] Preserved claim/proof records across handoff and refresh.

## Acceptance criteria

- A disconnected or attention-required identity cannot support a new claim.
- OAuth control alone never auto-verifies a person profile.
- Organization shared-service handles still require corroborating proof.
- Public stale handles are hidden while the relationship remains auditable.

## Evidence

- Primary commit: `c4779be0`.
- Harness handoff fix: `d3490843`.
- Tests: `test_profile_claim_atproto_freshness.py`,
  `test_profile_claim_atproto_pairing.py`, and profile response suites.
