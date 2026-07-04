# Profile And Evidence PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A user can open a civic profile, quickly understand who or what it represents,
see why Atlas believes the information, and decide whether to trust, contact,
share, follow, claim, correct, or continue exploring.

## Problem

Atlas publishes claims about real people and organizations. A thin directory row
is not enough, and a confident profile without evidence is dangerous. Profiles
must feel useful, human, and careful. Evidence should be close enough to inspect
without overwhelming the first screen.

## Users

- Public visitor evaluating a person or organization.
- Subject of a profile.
- Organizer or journalist finding allies or sources.
- Workspace user building lists or briefs.
- Reviewer resolving corrections and trust issues.

## Core Requirements

1. Profile summary
   - Show name, actor type, place context, issue context, short description,
     source count, latest source date, confidence state, and claim/steward
     state.
   - Keep the first screen focused on identity, civic work, place, trust, and
     the most useful action.

2. Claim-level evidence
   - Important factual claims link to evidence.
   - Evidence includes source title, publisher when known, URL, published or
     observed date, retrieved date when available, confidence, review state, and
     claim relationship.
   - Claims can be corroborated, partial, single-source, stale, disputed,
     subject-provided, unknown, or suppressed.

3. Evidence Pack
   - Each profile has an evidence section or drawer that groups sources by
     claim, relationship, issue, and freshness.
   - Users can open original sources.
   - Users can see which claims have weak or missing support.
   - Exports and API responses preserve evidence metadata.

4. Relationship previews
   - Show source-backed links to related people, organizations, initiatives,
     campaigns, events, places, and issues.
   - Each relationship has a source or explicit unknown state.
   - Do not imply endorsement or membership without evidence.

5. User actions
   - Public actions: inspect sources, share, report correction, claim profile,
     browse related actors.
   - Signed-in actions: follow, save to list, submit source.
   - Workspace actions: add note, add to brief, add to coverage, watch.

6. Freshness and gaps
   - Show latest source date and freshness state.
   - Show important known gaps without apologetic product narration.
   - Stale profiles remain useful but visually distinct.

## Profile Layout

Recommended structure:

1. Header: identity, actor type, place, issues, trust summary, primary actions.
2. About: concise description and subject-managed fields when available.
3. Civic work: source-backed activities, initiatives, roles, and focus areas.
4. Evidence: grouped source receipts and claim support.
5. Connections: related actors, organizations, initiatives, places, and issues.
6. Contact surface: public contact or subject-preferred channel when safe.
7. Stewardship: claim state, correction path, and profile history signals.

## Data And Interfaces

Profile response fields:

- Stable profile id and slug.
- Actor type.
- Display name and aliases.
- Summary.
- Places and approximate location state.
- Issues.
- Public contact fields.
- Claim state.
- Steward fields.
- Trust summary.
- Claim list.
- Evidence pack.
- Relationship summaries.
- Freshness state.
- Correction and claim URLs.

Evidence fields:

- Evidence id.
- Claim id.
- Source id or URL.
- Source title.
- Publisher.
- Published or observed date.
- Retrieved date.
- Evidence type.
- Confidence.
- Review state.
- Staleness state.
- Related profile ids.

## UX Details

- Evidence opens in-place on desktop and in a full-height sheet on mobile.
- Trust states include accessible labels and plain text.
- The claim CTA is visible but not louder than the profile identity.
- Subject-managed fields are clearly labeled as subject-provided.
- Suppressed or removed sensitive fields leave a plain explanation when a user
  needs context.
- Long source titles wrap without breaking action rows.
- "Unknown" is treated as a legitimate state, not an error.

## Safety And Privacy

- Do not show precise personal addresses.
- Do not display unreviewed sensitive contact information.
- Do not surface private notes or internal reviewer comments.
- Do not show weak allegations as profile facts.
- Do not imply relationships, affiliations, or endorsement from follows,
  reposts, likes, or social proximity alone.
- Profiles about vulnerable people may require extra review before public
  display, export, or monitoring.

## Metrics

- Profile-to-source-inspection rate.
- Correction starts per profile view.
- Claim starts per eligible profile view.
- Profiles with current source date.
- Profiles with claim-level evidence coverage.
- Disputed or stale claim resolution time.

## Acceptance Criteria

- A public user can open a profile and inspect evidence without sign-in.
- Every important claim has evidence, confidence, or explicit unknown state.
- Stale, weak, disputed, and subject-provided claims are visually distinct.
- Profile actions are grouped by public, signed-in, workspace, and subject use.
- Related actors never imply unsupported endorsement.
- Mobile evidence inspection is usable.
