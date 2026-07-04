# Find My People / Alignment PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A user can find people and organizations aligned with their civic interests
based on public work, issues, places, roles, and source-backed relationships,
without Atlas inferring private ideology, personality, or susceptibility.

## Problem

People often arrive with a human question: "Who is doing the kind of work I care
about?" A conventional directory makes them pick filters. A social platform
pushes opaque recommendations. Atlas needs a better pattern: alignment by
public civic work with receipts.

## Users

- Public visitor looking for allies or local organizations.
- Viewer motivated by a Rebuilding America episode.
- Organizer looking for people working on the same issue.
- Journalist looking for credible local voices.
- Claimed profile steward looking for adjacent organizations.
- Workspace user creating a research list.

## Product Definition

Alignment in Atlas means source-backed similarity or relevance across public
civic work. It can be based on:

- Shared issue area.
- Shared place or nearby place.
- Similar organization type.
- Shared initiative, campaign, event, or coalition.
- Similar public role, such as organizer, reporter, advocate, service provider,
  researcher, educator, worker center, mutual aid group, or local newsroom.
- Shared source context.
- Source-backed relationship.

Alignment must not be based on:

- Inferred ideology without public evidence.
- Personality scoring.
- Private demographic inference.
- Follows, likes, reposts, or social proximity alone.
- Persuadability, vulnerability, or targeting likelihood.
- Customer-uploaded private notes.

## Core Requirements

1. Find my people entry
   - Public page or module asks for issue and place first.
   - Optional actor type and role filters refine results.
   - Language is plain: "Find people and groups working on this."

2. Alignment explanations
   - Every recommendation explains the public basis for the match.
   - Examples: "Works on tenant organizing in Nevada," "Connected to two
     source-backed transit initiatives," "Local newsroom covering water access."
   - Explanations link to evidence where possible.

3. Alignment lenses
   - Issue lens.
   - Place lens.
   - Role lens.
   - Initiative or campaign lens.
   - Organization type lens.
   - Source-backed relationship lens.
   - Show topic lens.

4. Result groups
   - People.
   - Organizations.
   - Initiatives and campaigns.
   - Sources and stories.
   - Places to explore next.

5. User actions
   - Open profile.
   - Inspect alignment evidence.
   - Follow actor, issue, or place.
   - Save to list when signed in.
   - Share a result.
   - Submit a missing source or correction.

## UX Requirements

- Do not ask users to create a personality profile.
- Do not label people as "matches" without explaining the public basis.
- Prefer "also working on," "connected through," or "source-backed overlap" over
  vague affinity language.
- Let users tune place, issue, role, and actor type without clutter.
- Show diversity of actor types rather than only the most connected entities.
- Keep "why this appears" visible and inspectable.

## Data And Interfaces

Alignment query inputs:

- Place.
- Issue.
- Actor type.
- Role.
- Initiative or campaign id.
- Source id.
- Seed profile id.
- Result limit.

Alignment result fields:

- Profile summary.
- Alignment reasons.
- Evidence links.
- Trust summary.
- Distance or place relation when applicable.
- Relationship type when applicable.
- Public actions.

Alignment reason object:

- Reason type.
- Human label.
- Source-backed claim ids.
- Evidence ids.
- Confidence state.

## Ranking

Ranking should prefer:

- Strong source support.
- Current evidence.
- Local specificity.
- Meaningful issue overlap.
- Actor diversity.
- Claimed or stewarded profile signals when trust is otherwise equal.

Ranking should avoid:

- Pure popularity.
- Social-media virality.
- National organizations crowding out local actors.
- Unsupported relationship inference.

## Safety

- Alignment results must not create target lists for harassment.
- High-risk people can be excluded from broad recommendation modules.
- Bulk export is workspace-governed, not public alignment behavior.
- Campaign use must stay within public civic context and governance rules.
- Users should be able to report harmful or incorrect alignment.

## Metrics

- Alignment result open rate.
- "Why this appears" inspection rate.
- Follow or save rate.
- Correction rate on alignment explanations.
- Local actor diversity per query.
- Percentage of alignment results with source-backed reasons.

## Acceptance Criteria

- A user can find profiles by issue plus place without knowing taxonomy terms.
- Every recommended actor has at least one public alignment reason.
- Users can inspect evidence behind alignment reasons.
- Atlas never uses private notes, personality inference, or unsupported social
  proximity for public alignment.
- Alignment flows connect naturally to profiles, place pages, issue pages,
  follow, save, source submission, and correction.
