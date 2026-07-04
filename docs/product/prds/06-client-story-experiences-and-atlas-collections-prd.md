# Client Story Experiences And Atlas Collections PRD

Status: Draft
Date: 2026-07-04
Owner: Rebuilding America Project

## User Outcome

A visitor can enter a source-backed civic story, guide, episode companion, map,
or directory and move naturally into Atlas discovery: profiles, places, issues,
sources, evidence, corrections, claims, and follow-up search.

## Product Position

Atlas is the civic discovery platform. Rebuilding America is a flagship client
and reference implementation that uses Atlas. It is not a hardcoded product
section, exclusive home, or special-case data model.

The reusable product primitive is an Atlas Collection: a curated, source-linked
civic experience assembled from Atlas objects. Collections let shows,
newsrooms, documentary teams, nonprofits, civic educators, and partner
organizations publish interactive public experiences without weakening Atlas's
trust, evidence, claim, correction, and safety standards.

Collections must make Atlas more useful for ordinary public users. They must not
turn Atlas into a generic CMS, a sponsor-controlled microsite platform, or a
show-only wrapper.

## Users

- Public visitor arriving from a story, episode, guide, directory, or shared
  link.
- Viewer of a client show such as Rebuilding America.
- Producer assembling a source-linked companion experience.
- Journalist, creator, or documentary team publishing a civic story.
- Nonprofit or civic institution publishing a focused public guide.
- Civic actor represented inside a collection.
- Atlas reviewer checking evidence, corrections, and safety.

## Core Concept

An Atlas Collection is a curated civic experience built from reusable Atlas
objects:

- Profiles.
- Places.
- Issues.
- Sources.
- Evidence packs.
- Initiatives, campaigns, events, and civic projects.
- Public search links.
- Directories.
- Maps and timelines.
- Narrative cards.
- Correction and source-submission paths.

The collection provides editorial context. Atlas objects provide the trust
backbone. A collection can explain why a story matters, but named civic claims
still need evidence, review states, and correction paths.

## Collection Types

1. Episode companion
   - Used by shows, podcasts, video series, and audio projects.
   - Connects an episode to people, organizations, places, issues, sources, and
     follow-up searches.
   - Rebuilding America should start here as the first reference client.

2. Issue guide
   - Helps a public user understand who is working on an issue in a place.
   - Combines plain-language framing with source-backed profile groups,
     coverage state, sources, and next searches.

3. Place guide
   - Explains a local civic landscape.
   - Combines map/list exploration, key profiles, issues, sources, and coverage
     gaps.

4. Source trail
   - Shows the receipts behind a story, segment, claim, or public guide.
   - Groups sources by profile, claim, place, issue, segment, or time period.

5. People and organizations field guide
   - Presents a curated set of actors in a field, place, issue, or story.
   - Links every entry back to canonical Atlas profiles and evidence.

6. Timeline
   - Explains a campaign, initiative, public project, or issue over time.
   - Connects events to sources, actors, places, and disputed or stale claims.

7. Map story
   - Provides a place-based story with chapters, map/list parity, profile
     previews, and approximate geography labels.

8. Public briefing
   - Turns research output into a public, readable, source-linked memo.
   - Keeps known gaps and confidence visible.

## Visitor Experience

Every collection should answer six questions in this order:

1. What is this about?
2. Where does it happen?
3. Who is involved?
4. What issues does it touch?
5. What evidence supports it?
6. What can I explore or do next?

Recommended page anatomy:

1. Collection header
   - Title.
   - Client, steward, or publisher.
   - Collection type.
   - Primary place and issue context.
   - Source and trust summary.
   - Primary exploration action.

2. Story frame
   - Short editorial context.
   - Chapter or segment navigation when needed.
   - Plain distinction between editorial framing and Atlas evidence.

3. Civic object sections
   - People.
   - Organizations.
   - Initiatives or campaigns.
   - Places.
   - Issues.
   - Sources.

4. Interactive modules
   - Map/list view.
   - Timeline.
   - Source trail.
   - Related actor groups.
   - Follow-up search prompts.

5. Trust layer
   - Evidence drawer or sheet.
   - Source count.
   - Latest source date.
   - Confidence and freshness states.
   - Disputed, stale, subject-provided, unknown, or suppressed states.

6. Action layer
   - Open profile.
   - Inspect source.
   - Search this issue elsewhere.
   - Follow place, issue, profile, directory, or collection.
   - Submit source.
   - Report correction.
   - Claim profile when eligible.

## Creator Experience

The creator workflow should feel like a source-aware story builder, not a
generic page builder.

Creator flow:

1. Create collection.
2. Choose collection type.
3. Add title, client/steward, place, issue, and public summary.
4. Add Atlas objects: profiles, places, issues, sources, directories, lists,
   briefs, or search links.
5. Add narrative cards and section labels.
6. Arrange modules.
7. Review evidence coverage and safety warnings.
8. Preview public experience.
9. Submit for review or publish if authorized.
10. Track corrections, source submissions, and profile claims.

The builder should warn creators when:

- A named person appears without enough evidence.
- A relationship is weak, stale, disputed, or unsupported.
- A profile is high-risk or requires review.
- A source cannot be shown publicly.
- A collection implies endorsement without evidence.
- A collection lacks correction or source-submission paths.

## Rebuilding America Reference Implementation

Rebuilding America should be the first polished client using Atlas Collections.
It should prove that Atlas can power high-quality interactive civic storytelling
without becoming a show-only product.

Reference collection types for Rebuilding America:

- Episode companion.
- Season guide.
- Guest and source trail.
- Issue explainer.
- City or region civic map.
- Follow-up research packet.
- Viewer action guide.

Viewer journey:

1. Viewer opens a Rebuilding America companion experience.
2. The page identifies the story, place, issue, and key civic actors.
3. The viewer opens a profile, source, map point, or timeline item.
4. The viewer inspects evidence and trust state.
5. The viewer continues into broader Atlas search, a place page, an issue page,
   or another collection.

This same journey must be reusable by other shows and publishers with different
branding, templates, and editorial framing.

## Information Architecture

Atlas should expose collections as a reusable public surface:

- Collections index.
- Collection detail page.
- Collection type pages when useful.
- Client or steward profile page.
- Embed surface for partner sites.
- Creator workspace for authorized users.

Public navigation can feature collections, directories, or a specific reference
client when strategically useful. Rebuilding America should not be a permanent
default navigation pillar in the core Atlas product.

Implementation route examples are secondary to the IA, but the route model
should support:

- Canonical Atlas-hosted collections.
- Client-branded collection pages.
- Embedded collection modules.
- Custom-domain or partner-domain deployments.
- Public routes that link back to canonical Atlas profiles, places, issues, and
  sources.

## Data And Interfaces

Collection:

- Collection id and slug.
- Collection type.
- Title.
- Short summary.
- Client or steward id.
- Publisher disclosure.
- Branding theme within Atlas bounds.
- Primary places.
- Primary issues.
- Linked profile ids.
- Linked organization ids.
- Linked initiative ids.
- Linked source ids.
- Linked directory ids.
- Linked search queries.
- Narrative sections.
- Map items.
- Timeline items.
- Evidence coverage summary.
- Trust summary.
- Correction URL.
- Source submission URL.
- Published state.
- Review state.

Collection section:

- Section id.
- Collection id.
- Section type.
- Title.
- Body text.
- Linked Atlas object ids.
- Sort order.
- Visibility state.

Collection item:

- Item id.
- Collection id.
- Object type and id.
- Inclusion reason.
- Editorial note.
- Evidence requirement state.
- Review state.
- Display order.

Client/steward:

- Client id and slug.
- Display name.
- Disclosure text.
- Public contact or website.
- Branding permissions.
- Allowed collection types.
- Reviewer requirements.

## UX Requirements

- Collections must feel editorial and exploratory, not like a database export.
- Every named actor links to a canonical Atlas profile or a reviewed unknown
  state.
- Every important claim either links to evidence or displays an explicit trust
  state.
- Source inspection must be available without sign-in.
- Map modules always have list equivalents.
- Collection pages must not use workspace, billing, package, or customer
  operations language.
- Client branding can be present but cannot hide Atlas provenance, correction
  paths, source metadata, or trust states.
- The first viewport should make the story understandable and provide one clear
  civic exploration action.
- Long collections need chapter navigation, but short collections should remain
  simple.
- Mobile collection pages should prioritize story context, object cards,
  evidence sheets, and next exploration actions.

## Safety And Governance

- Client editorial framing must be distinguishable from Atlas evidence.
- Sponsors, clients, and publishers cannot directly publish unsupported claims.
- Directory inclusion, guest appearance, or collection inclusion must not imply
  endorsement unless a source supports it.
- Sensitive profiles and sources can require review before appearing in a
  collection.
- Collections must keep correction, claim, and source-submission paths visible
  where relevant.
- Private workspace notes and client-only context must never leak into public
  collections.
- Collections cannot be used for doxxing, harassment, intimidation, stripped
  provenance resale, or unsupported allegations.

## Metrics

- Collection view to profile open rate.
- Collection view to source inspection rate.
- Collection view to broader Atlas search rate.
- Follow-up place or issue exploration rate.
- Source submissions from collections.
- Corrections and claims from collection-linked profiles.
- Collection reuse by client type.
- Evidence coverage per collection.
- Mobile completion and interaction rate.

## Acceptance Criteria

- Rebuilding America can publish an episode companion as an Atlas Collection
  without hardcoded product assumptions.
- Another show or publisher can use the same collection model with different
  branding and objects.
- A public visitor can move from a collection into canonical Atlas profiles,
  places, issues, sources, and search.
- Collection pages distinguish editorial framing from Atlas evidence.
- Every collection provides source inspection, correction, and source
  submission paths where relevant.
- Creator workflows surface evidence gaps, stale claims, disputed claims, and
  safety review requirements before publication.
