# Public Directories / Atlas For X PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A visitor can use a partner-backed public directory to find source-linked civic
actors in a focused field, place, or issue area, while still understanding that
the records follow Atlas trust standards.

## Problem

Partners can help fund and maintain coverage, but public directories must not
become sponsor-controlled microsites or disconnected datasets. Atlas for X
should let partners publish useful scoped views while preserving source
evidence, correction paths, methodology, and commons contribution rules.

## Users

- Public visitor browsing a focused directory.
- Partner organization sponsoring or maintaining a directory.
- Civic actor represented in a directory.
- Atlas reviewer handling partner submissions.
- Developer or researcher using directory data.

## Core Requirements

1. Directory configuration
   - Title.
   - Sponsor or steward.
   - Scope: place, issue, actor type, source type, and inclusion rules.
   - Methodology.
   - Contact and correction links.
   - Commons exchange status.

2. Public directory page
   - Search within directory.
   - Filter by issue, place, actor type, confidence, source freshness, and
     claimed profile state.
   - Map/list toggle where geography is useful.
   - Methodology panel.
   - Sponsor disclosure.
   - Correction and source submission paths.

3. Directory result cards
   - Same trust summary rules as public search.
   - Explain directory inclusion when relevant.
   - Link to canonical Atlas profile pages.

4. Partner contribution intake
   - Partners can submit source candidates, profile corrections, and directory
     inclusion suggestions.
   - Submissions enter review before public records change.
   - Accepted records preserve contributor and evidence metadata.

5. Commons exchange
   - Directory records can contribute reviewed, source-backed improvements to
     shared Atlas data.
   - Public UI explains whether records are shared with the commons, limited to
     a directory, or under review.

6. Public impact report
   - Partners can see coverage added, records reviewed, sources accepted,
     corrections resolved, and known gaps.
   - Impact reporting does not hide weak or stale coverage.

## Data And Interfaces

Directory config:

- Directory id and slug.
- Title.
- Sponsor name.
- Sponsor disclosure.
- Scope filters.
- Methodology text.
- Branding bounds.
- Correction URL.
- Source submission URL.
- Commons status.
- Published state.

Directory result:

- Profile summary.
- Directory inclusion reason.
- Trust summary.
- Source count.
- Latest source date.
- Correction state.
- Canonical profile URL.

Contribution:

- Contribution id.
- Directory id.
- Submitted by.
- Submission type.
- Source URL or ATProto record when applicable.
- Suggested profile or claim changes.
- Review state.
- Accepted source or evidence ids.

## UX Requirements

- Partner branding can be present but must not hide Atlas provenance.
- Sponsor disclosure is visible but not visually dominant.
- Public search and profile links remain available.
- Methodology is written for public readers.
- Empty states state that no matching records are listed in this directory.
- Directory pages do not use workspace or sales package language.

## Safety And Governance

- Sponsors cannot directly publish unsupported claims.
- Directory inclusion must not imply endorsement.
- Partner-submitted sources must be reviewed.
- Corrections from subjects and the public must be available.
- Directories for sensitive topics can require stricter review before records
  appear.

## Metrics

- Directory search usage.
- Directory result to canonical profile open rate.
- Source inspection rate.
- Source submissions and accepted sources.
- Corrections resolved.
- Coverage gaps closed.
- Commons contributions accepted.

## Acceptance Criteria

- A directory visitor can search, filter, inspect sources, and open canonical
  Atlas profiles.
- Sponsor and methodology are visible.
- Partner contributions enter review before changing public records.
- Directory records carry trust summaries and source metadata.
- Directory UI shows commons exchange state.
- Public correction and source submission paths are available.
