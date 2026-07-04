# Public Civic Discovery PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A person who is not an Atlas customer, researcher, or insider can find useful
civic data by typing what they care about, scanning understandable results, and
opening source-backed profiles.

## Problem

Civic information is scattered across local news, organization websites, public
records, podcast pages, event listings, and social platforms. Search engines can
find pages, but they do not organize people, organizations, initiatives, places,
issues, relationships, and evidence into a civic discovery experience.

Atlas must make public discovery feel easier than manual search while being
more trustworthy than a black-box answer.

## Users

- Resident looking for people doing work in their community.
- Viewer coming from Rebuilding America.
- Local organizer looking for allies.
- Journalist or creator finding sources.
- Student or researcher learning a local civic ecosystem.
- Person or organization checking whether they appear in Atlas.

## Jobs To Be Done

- "I care about this issue and want to know who is doing work near me."
- "I heard about someone on the show and want to find related people."
- "I am moving to a new city and want to understand the civic landscape."
- "I need a source for a story and want credible local voices."
- "I want to know why Atlas says this person or organization is relevant."

## Core Requirements

1. Plain-language search
   - Accept natural phrases containing place, issue, actor type, organization,
     person, or civic concern.
   - Parse recognized entities into visible filter chips.
   - Preserve the user's original wording.
   - Never require advanced operators.

2. Guided search
   - Offer starting chips for place, issue, actor type, and "near me."
   - Use civic language like housing, care, labor, climate, democracy, transit,
     education, food, safety, and local news.
   - Let users remove or edit chips without restarting.

3. Result modes
   - List mode is the default for scanning.
   - Map mode is available when results include geography.
   - Source mode lets users search sources directly.
   - Issue and place landing pages can preconfigure result mode.

4. Result cards
   - Show actor name, actor type, place, issues, summary, source count, latest
     source date, trust state, and match reason.
   - Include actions: open profile, inspect sources, save or follow when signed
     in, share, correct.
   - Keep workspace actions secondary.

5. Sorting and filtering
   - Sort by relevance, recently sourced, strongest evidence, nearest place,
     and actor type.
   - Filter by place, issue, actor type, confidence, freshness, source type, and
     claimed profile state.
   - Show the active query in a compact summary.

6. No-results recovery
   - State the plain fact that no matching records were found.
   - Offer broader place, nearby place, fewer filters, related issue, source
     submission, and directory browse paths.
   - Do not mention pipeline state or future ingestion.

7. Public action path
   - Public users can open and share results without login.
   - Sign-in prompts appear only for actions that require identity: follow,
     save, claim, or workspace handoff.
   - Users can submit a source or correction from no-results and profile pages.

## Information Architecture

Primary public discovery routes:

- `/search`
- `/browse`
- `/places`
- `/places/:slug`
- `/issues`
- `/issues/:slug`
- `/profiles/people/:slug`
- `/profiles/organizations/:slug`
- `/profiles/initiatives/:slug`
- `/sources`
- `/directories/:orgId`

Search should be reachable from the public home, show companion pages,
directories, profile pages, place pages, issue pages, and no-results states.

## Data And Interfaces

Search API inputs:

- Query text.
- Place filters.
- Issue filters.
- Actor type filters.
- Source type filters.
- Confidence filters.
- Freshness filters.
- Claimed or stewarded profile filters.
- Pagination and sort.

Search API result fields:

- Entity id and canonical slug.
- Display name.
- Actor type.
- Short summary.
- Place labels and approximate geography state.
- Issue labels.
- Match reasons.
- Trust summary.
- Source count.
- Latest source date.
- Claim or steward state.
- Correction availability.

Generated client and front-end mapping must avoid silent defaults. Missing trust
or source fields should render explicit unknown states.

## UX Details

- The search box keeps focus after a submitted search on desktop.
- Mobile search collapses filters into a sheet with active chips visible above
  results.
- Filter counts update without layout shift.
- Result cards keep stable heights for badges and actions.
- Long organization names wrap cleanly.
- Trust badges use accessible text, not color alone.
- Source drawer opens from result cards without navigating away.
- Place and issue breadcrumbs make it easy to broaden or narrow scope.

## Safety And Trust

- A person result cannot be treated as strongly matched unless the issue or
  place connection is source-backed.
- Sensitive people or high-risk topics can be downranked, hidden, or routed to
  correction/review states based on governance rules.
- Public search must not expose private workspace notes, customer annotations,
  or internal reviewer notes.
- Bulk contact collection is not a public discovery feature.

## Metrics

- Search-to-profile-open rate.
- Profile-open-to-source-inspection rate.
- No-results recovery action rate.
- Correction and source-submission rate.
- Mobile search completion rate.
- Repeat public discovery sessions.
- Percentage of result cards with non-empty trust summaries.

## Acceptance Criteria

- A user can search "housing organizers in Phoenix" and get result cards with
  source-backed actor summaries.
- A user can search by person or organization name and reach a profile.
- A user can remove filters and recover from no results.
- A user can inspect sources from a result card and profile.
- A mobile user can search, filter, open a profile, and inspect evidence.
- Search results do not display workspace, package, customer, or pipeline
  language.
