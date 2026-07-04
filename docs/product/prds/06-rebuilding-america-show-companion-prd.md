# Rebuilding America Show Companion PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A viewer who watches or hears a Rebuilding America segment can open Atlas,
explore the people, organizations, places, issues, and sources connected to the
story, and continue into broader civic discovery.

## Product Position

The show is a flagship use case, distribution channel, and proof point for
Atlas. It is not Atlas's only home. Show companion pages must use reusable Atlas
objects: profiles, sources, places, issues, directories, lists, and public
search. They should make the show better while making Atlas more useful outside
the show.

## Users

- Viewer curious after an episode.
- Guest or profiled civic actor.
- Producer preparing source-linked companion material.
- Journalist or creator reusing a source trail.
- Public user discovering Atlas through shared show content.

## Core Requirements

1. Episode page
   - Episode title.
   - Short episode summary.
   - Primary place and issue context.
   - Guest and profiled actor links.
   - Source list.
   - Related Atlas profiles.
   - Related places and issues.
   - Follow-up search entry.

2. Segment pages or sections
   - Focus on one story, issue, guest, place, or civic question.
   - Link to Atlas profiles and sources.
   - Offer "keep exploring" paths into public discovery.

3. Episode map
   - Show places and actors referenced by the episode.
   - Provide list fallback.
   - Label approximate geography.
   - Avoid visual clutter and show-only dead ends.

4. Guest and source pages
   - Guests link to public Atlas profiles when appropriate.
   - Sources used in the episode link to source records or evidence packs.
   - Profile claim and correction paths remain available.

5. Viewer actions
   - Open profile.
   - Inspect source.
   - Search the issue in another place.
   - Follow issue or place.
   - Submit a source.
   - Share an episode-linked Atlas object.

6. Producer workflow
   - Producers can assemble episode companion pages from existing profiles,
     sources, places, issues, and lists.
   - Missing records become source submissions or research requests rather than
     show-only content.

## Information Architecture

Recommended public routes:

- `/rebuilding-america`
- `/rebuilding-america/episodes`
- `/rebuilding-america/episodes/:slug`
- `/rebuilding-america/topics/:slug`

Show routes must link out to reusable Atlas routes:

- Profile pages.
- Place pages.
- Issue pages.
- Source pages.
- Public search.
- Public directories.

## UX Requirements

- The first viewport should clearly identify the episode or topic and show the
  most useful civic discovery action.
- Do not bury the Atlas search path under media promotion.
- Keep media context and civic exploration in the same flow.
- Share cards should point to source-linked Atlas objects where possible.
- Show pages should not use workspace or customer language.

## Data And Interfaces

Episode companion object:

- Episode id and slug.
- Title.
- Published date.
- Summary.
- Media URL or embed metadata.
- Linked profile ids.
- Linked source ids.
- Linked place ids.
- Linked issue ids.
- Curated search links.
- Correction and source submission links.

Producer assembly workflow:

- Select existing Atlas objects.
- Create missing source submission.
- Preview public page.
- Publish when all public claims have evidence or explicit unknown states.

## Safety And Trust

- A guest appearing in an episode does not automatically imply endorsement of
  every related issue or actor.
- Episode pages must distinguish editorial narrative from Atlas evidence.
- Claims about named people must follow the same evidence rules as profiles.
- Sensitive sources and vulnerable actors require review before being featured.

## Metrics

- Episode page to Atlas search rate.
- Episode page to profile open rate.
- Source inspection rate from episode pages.
- Follow or save actions from show traffic.
- Source submissions from viewers.
- Claim and correction actions from featured profiles.

## Acceptance Criteria

- A viewer can move from an episode to profiles, sources, places, and issues.
- Episode pages reuse Atlas objects instead of duplicating show-only records.
- A viewer can continue exploring outside the show section.
- Producers can assemble a companion page without creating unsupported claims.
- Profile claim and correction paths remain visible for featured actors.
