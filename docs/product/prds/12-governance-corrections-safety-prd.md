# Governance, Corrections, And Safety PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

Users, profile subjects, partners, and Atlas operators have clear paths to
correct errors, dispute claims, report harm, resolve review queues, and prevent
Atlas from becoming a tool for harassment, surveillance, or unsupported claims
about real people.

## Problem

Atlas publishes civic information about named people and organizations. Trust is
the core experience. Wrong, stale, unsupported, or dangerous information shown
confidently is the worst product failure. Governance cannot be hidden in
operations; it must be visible in the product.

## Users

- Public user reporting an error.
- Profile subject requesting correction or suppression.
- Atlas reviewer.
- Partner contributor.
- Workspace customer using exports or monitoring.
- Public reader evaluating profile trust.

## Core Requirements

1. Correction flow
   - Available from profiles, result cards, directories, collections, and
     evidence packs.
   - Supports wrong fact, outdated fact, missing context, harmful exposure,
     duplicate profile, wrong relationship, and source problem.
   - Gives submitter a status path when signed in or email is provided.

2. Dispute and review states
   - Claims can be disputed, under review, corrected, suppressed, rejected, or
     confirmed.
   - Public UI visibly distinguishes disputed claims.
   - Reviewer decisions preserve audit history.

3. Source suppression request
   - Subjects can request removal or hiding of unsafe, irrelevant, or
     misapplied sources.
   - Reviewers decide based on public interest, safety, relevance, and evidence
     quality.
   - Suppression does not erase internal history.

4. Restricted use handling
   - Deny or escalate requests involving doxxing, harassment, intimidation,
     law-enforcement surveillance, private-person targeting, stripped-provenance
     resale, or unsupported allegations.
   - Campaign and political use must remain public-source civic landscape
     intelligence.

5. Moderation queue
   - Reviewers see correction reports, claim requests, source submissions,
     disputed claims, suppressed-source requests, and restricted-use flags.
   - Queue supports severity, type, affected profile, source, submitter, review
     state, and decision.

6. Public safety page
   - Explains what Atlas will and will not do.
   - Explains correction, claiming, source submission, and safety review paths.
   - Uses plain language and avoids legalistic opacity.

## Data And Interfaces

Correction report:

- Report id.
- Reporter user id or contact.
- Affected object type and id.
- Report type.
- Description.
- Evidence URL when supplied.
- Severity.
- Review state.
- Decision.
- Created, updated, and decided timestamps.

Claim review:

- Claim id.
- Profile id.
- Requesting user id.
- Proof path.
- Risk state.
- Review state.
- Decision reason.

Safety flag:

- Object type and id.
- Flag type.
- Severity.
- Restricted-use category when applicable.
- Reviewer id.
- Resolution state.

## UX Requirements

- Correction links are easy to find but not alarmist.
- Correction forms ask for the minimum useful context.
- Public disputed states are calm and clear.
- Review states never expose private reporter information.
- Denied or restricted requests receive plain, safe explanations.
- Subject and public users can understand what happened next.

## Safety Rules

Atlas must not support:

- Doxxing.
- Harassment.
- Intimidation.
- Law-enforcement surveillance.
- Private-person targeting.
- Bulk exposure of vulnerable organizers.
- Unsupported allegations about named people.
- Data resale detached from provenance.
- Opposition research that strips context or safety.

Atlas may support:

- Public-source landscape intelligence.
- Source-backed local reporting.
- Coalition discovery.
- Civic actor directories.
- Public corrections.
- Subject stewardship.
- Safe monitoring of places, issues, organizations, and reviewed records.

## Metrics

- Correction submission rate.
- Correction resolution time.
- Disputed claim age.
- Source suppression decisions.
- Claim dispute decisions.
- Restricted-use denials.
- Repeat error categories.
- Public trust state coverage.

## Acceptance Criteria

- Users can report errors from public profiles and directories.
- Claims can render disputed, corrected, suppressed, or under-review states.
- Reviewers can resolve correction, claim, source, and safety queue items.
- Public UI does not show unsupported claims confidently.
- Restricted use cases are denied or escalated.
- Safety decisions preserve audit history.
