# Firehose Analysis And Resolution Pipeline

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## Purpose

This document defines how Firehose converts collected public artifacts into
civic signals, resolves those signals to Atlas records, proposes claims and
relationships, scores trust and relevance, and routes uncertain or sensitive
items to review.

Analysis is where Firehose stops being a feed and becomes Atlas intelligence.

## Pipeline Overview

```text
Normalized Artifact
  -> Artifact Preflight
  -> Candidate Extraction
  -> Signal Classification
  -> Public Realm Basis Detection
  -> Entity, Place, And Issue Resolution
  -> Claim Extraction
  -> Relationship Extraction
  -> Signal Scoring
  -> Safety And Trust Gate
  -> Route Proposal
```

Every stage should be inspectable. A reviewer should be able to see the input,
the output, the model or rule version, and the source passage behind any
decision.

## Artifact Preflight

Preflight answers whether an artifact is analyzable:

- Is it public?
- Does it have source metadata?
- Is content readable?
- Is the language supported?
- Is it within coverage scope?
- Is it duplicate or unchanged?
- Does source policy allow analysis?
- Does it contain likely civic content?

Preflight can end in:

- `continue`.
- `skip_non_civic`.
- `skip_duplicate`.
- `hold_source_policy`.
- `hold_unreadable`.
- `hold_sensitive_source`.

## Candidate Extraction

Extraction identifies possible civic signal candidates from the artifact.

Candidate types include:

- `public_meeting`.
- `public_comment`.
- `agenda_item`.
- `vote_or_decision`.
- `rulemaking_or_comment_window`.
- `public_event`.
- `mobilization`.
- `coalition_announcement`.
- `grant_award`.
- `filing_update`.
- `organization_update`.
- `public_role_update`.
- `news_mention`.
- `relationship_signal`.
- `source_freshness_change`.
- `coverage_gap`.
- `correction_or_dispute`.

Each candidate must preserve:

- Source artifact id.
- Relevant passage.
- Structured fields when available.
- Candidate summary.
- Candidate type.
- Mentioned names.
- Mentioned organizations.
- Mentioned places.
- Mentioned issues.
- Dates.
- Public realm basis.
- Extraction version.

## Public Realm Basis Detection

Firehose should explicitly record why a person or organization is in scope.

Allowed public realm bases:

- Public meeting participation.
- Public comment.
- Public filing.
- Public office or appointed role.
- Public campaign or candidacy.
- Public organizational role.
- Public event participation.
- Public news mention.
- Public grant, award, or contract record.
- Public coalition or campaign affiliation.
- Public statement in a civic context.

Rejected or review-gated bases:

- Private address exposure without civic necessity.
- Private contact discovery.
- Private family or relationship inference.
- Rumor or unsupported allegation.
- Personal social content unrelated to civic work.
- Identity ambiguity involving a named person.
- Sensitive context with thin sourcing.

Public realm basis is not only a safety field. It is user-facing context. Atlas
should be able to explain why a person appears in a signal.

## Entity Resolution

Resolution links candidates to existing Atlas records or proposes new ones.

Resolution should use this order:

1. Stable identifiers: EIN, FEC id, government id, filing id, official domain,
   known social handle, public registry id.
2. Exact or normalized name plus strong context: organization, place,
   jurisdiction, role, source class, and date.
3. Existing Atlas relationships: same organization, same source, same public
   office, same campaign, same event.
4. Fuzzy matching only inside a tight blocking set.
5. Human review when ambiguity remains.

Resolution outputs:

- Existing entry id.
- Proposed new entry.
- Candidate duplicate set.
- Confidence score.
- Explanation.
- Review requirement.

Resolution must not silently merge two public people with similar names. It is
better to hold for review than to create a false relationship.

## Place And Issue Resolution

Place resolution should prefer canonical place ids where possible:

- Source jurisdiction.
- Meeting body jurisdiction.
- Venue.
- Organization service area.
- Event location.
- Article dateline.
- Explicit city, county, state, district, or region.

Issue resolution should combine:

- Atlas taxonomy terms.
- Source tags.
- Meeting agenda language.
- Organization mission language.
- Candidate text.
- Linked entry issue areas.

Issue tags should carry confidence and evidence. A signal can be relevant to
housing because a meeting item says "tenant protections," not because a model
guessed from weak context.

## Claim Extraction

Claims are factual statements that can attach to an entry, source, place, issue,
or relationship.

Claim examples:

- Person holds a public role.
- Person spoke at a public meeting.
- Organization sponsored an event.
- Organization joined a coalition.
- Organization received a grant.
- Organization launched a campaign.
- Public body scheduled a hearing.
- Public source updated a profile fact.

Claim outputs:

- Claim subject.
- Attribute.
- Value.
- Source id.
- Relevant passage.
- As-of date.
- Confidence.
- Public realm basis.
- Extraction version.
- Review state.

The claim should distinguish direct source assertion from Atlas inference. For
example, "Jane Smith is listed as executive director" is a direct claim if the
source says it. "Jane Smith is a housing advocate" may be inferred and should
carry lower confidence unless the source says it directly.

## Relationship Extraction

Relationships connect Atlas actors.

Relationship types include:

- `staff`.
- `board_member`.
- `officer`.
- `candidate_for`.
- `elected_to`.
- `appointed_to`.
- `speaker_at`.
- `public_commenter_at`.
- `sponsor_of`.
- `organizer_of`.
- `member_of`.
- `partner`.
- `coalition_member`.
- `funder`.
- `grantee`.
- `endorser`.
- `opposes_or_contests`.
- `mentioned_with`.

Relationships should carry:

- Source id.
- Relevant passage.
- Direction.
- Valid date or event date.
- Confidence.
- Public realm basis.
- Review state.

High-risk relationship types, such as allegation, opposition, contestation, or
person-centered political relationships, should route to review unless backed by
strong public sources and safe context.

## Signal Scoring

Firehose should produce separate scores instead of one opaque rank.

Recommended scores:

- `source_quality`: official, primary, local news, organization self-published,
  secondary, social/platform, unknown.
- `identity_confidence`: confidence that named entities resolve correctly.
- `claim_confidence`: confidence that the claim is directly supported.
- `civic_relevance`: usefulness for Atlas discovery and field intelligence.
- `freshness`: how current the signal is.
- `novelty`: whether this changes what Atlas already knew.
- `coverage_value`: whether this fills a known gap.
- `sensitivity`: risk introduced by displaying or routing the signal.
- `customer_relevance`: match to a workspace watch or coverage target.

Routing should use score combinations, not a single magic threshold.

## Safety And Trust Gate

The gate decides whether a signal can be:

- Published to public surfaces.
- Added to a profile timeline.
- Used in place or issue activity.
- Sent to a personal follow.
- Sent to a workspace watch.
- Offered as a brief lead.
- Used only as private workspace context.
- Held for review.
- Rejected.
- Suppressed.

Default routing guidance:

- Official organization or public-meeting signals can publish when identity and
  source quality are strong.
- Public-person signals can publish when the person is acting in a clear public
  role and the source is strong.
- Sensitive public-person signals should route to review.
- Allegations, vulnerable-person exposure, minors, private addresses, or unclear
  identity should hold or reject.
- Customer watches should not bypass public trust rules; private workspace
  context can exist, but it cannot make a public claim true.

## Route Proposal

A route proposal includes:

- Signal id.
- Destination type.
- Destination id.
- Visibility scope.
- Route reason.
- Required capability or entitlement.
- Safety status.
- Review status.
- Expiration or freshness window.

Common route reasons:

- New source for followed profile.
- New public role activity.
- New related actor in watched issue.
- Coverage gap filled.
- Coverage gap detected.
- Brief lead for target.
- Public profile timeline update.
- Public graph changelog item.
- Workspace digest item.

## Human Review

Reviewers should see:

- Original source.
- Normalized text.
- Relevant passage.
- Candidate summary.
- Public realm basis.
- Proposed entity matches.
- Proposed claims.
- Proposed relationships.
- Scores.
- Route proposal.
- Prior related signals.
- Suppression or correction history.

Review decisions:

- Approve route.
- Approve with edited wording.
- Hold for more sources.
- Request corroboration.
- Merge or split entity.
- Suppress source.
- Reject signal.
- Escalate safety.

## Experience Outcome

A user benefits from analysis when Atlas can say:

- This is what changed.
- This is who or what it connects to.
- This is why the person or organization is in scope.
- This source proves the signal.
- This is what Atlas knows, what it infers, and what remains uncertain.
- This is why the signal is visible, held, or excluded.
