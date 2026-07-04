# Experience Architecture PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A first-time visitor can open Atlas, understand where to start, search for civic
information in ordinary language, inspect a profile, and trust what they see
without learning Atlas internals or entering an enterprise workspace.

## Problem

Atlas has powerful research, brief, coverage, workspace, and business-planning
surfaces. Those are useful, but they can pull the product toward generic
enterprise software. The core product must instead feel like a civic discovery
experience for real people: calm, clear, source-linked, and immediately useful.

## Users

- Public visitor looking for people or organizations working on an issue.
- Viewer arriving from a client story, including a Rebuilding America episode.
- Civic actor checking how they appear in Atlas.
- Journalist, organizer, researcher, or creator starting from public search.
- Workspace user who needs deeper tools after discovery.

## Experience Principles

- Public discovery is the front door.
- Search, browse, profiles, sources, places, issues, claiming, and corrections
  are first-class public surfaces.
- Workspace, admin, sales, and entitlement concepts stay behind authenticated
  routes.
- Every screen answers what the user can see, trust, understand, or do.
- The interface should feel practical and generous, not like a control room.
- No public route should require understanding pipelines, research jobs,
  coverage targets, packages, ARR, CRM, or account administration.

## Information Architecture

Primary public navigation:

- Search
- Browse
- Places
- Issues
- Profiles
- Sources
- Directories
- Collections
- Claim profile
- About methodology

Authenticated workspace navigation:

- Research
- Briefs
- Lists
- Coverage
- Watching
- Activity
- Organization settings
- API and integrations

Global IA rules:

- Public routes can invite sign-in only when it helps the current user task.
- Search is available from every public page.
- Profiles always provide source inspection, correction, and claim paths.
- Client story and collection pages reuse public Atlas routes and never trap
  users inside a client-only section.
- Workspace pages can link back to public profiles, places, and sources.

## Core Requirements

1. Public home or start surface
   - Lead with a search-first civic discovery interface.
   - Support plain-language examples like "housing organizers in Phoenix" and
     "transit advocates near Las Vegas."
   - Offer place, issue, actor type, and source-backed browse paths.
   - Avoid product-marketing hero copy when the user can start searching.

2. Global search pattern
   - Accept plain text, place tokens, issue tokens, person names, organization
     names, and civic concerns.
   - Show recognized filters before results without forcing advanced syntax.
   - Keep search input visible on result, place, issue, and profile pages.

3. Trust-first result layout
   - Each result card shows name, actor type, place, issue tags, source count,
     latest source date, confidence state, and one plain reason it matched.
   - Weak, stale, disputed, or single-source results look different from
     corroborated results.
   - Every result links to evidence or a source drawer.

4. Navigation from discovery to action
   - Public users can open a profile, inspect sources, share a result, follow a
     topic, submit a correction, or start a claim.
   - Signed-in users can save to list, watch, create a brief, or add notes from
     the same entity without changing the public page into a workspace page.

5. Copy and content
   - Use plain civic language.
   - Do not describe internal collection, indexing, or pipeline state.
   - Do not use enterprise labels on public pages.
   - Empty states state what is absent and offer a next search, place, issue, or
     correction path.

6. Responsive behavior
   - Mobile first search, result scanning, profile evidence, claim, and
     correction flows.
   - Map views must always have a list equivalent.
   - Touch targets, filters, and evidence drawers must be usable on phones.

## UI And UX Feature Inventory

The architecture must support these focused UX features without putting all of
them on every screen:

1. Persistent public search.
2. Place-plus-issue quick filters.
3. Civic concern chips in plain language.
4. Near-me place entry.
5. Browse by issue.
6. Browse by place.
7. Browse by actor type.
8. Result reason text.
9. Source count badge.
10. Latest source date.
11. Confidence state.
12. Stale data warning.
13. Disputed claim warning.
14. Source drawer.
15. Correction link.
16. Claim profile link.
17. Shareable profile cards.
18. Map/list toggle.
19. Keyboard-accessible list view.
20. Empty-state recovery suggestions.
21. Quiet loading state.
22. Plain error state.
23. Related actors.
24. Related places.
25. Related issues.
26. Follow topic.
27. Follow place.
28. Follow actor.
29. Save to list for signed-in users.
30. Start brief from public profile for authorized users.
31. Methodology page.
32. Public safety page.
33. Directory sponsor disclosure.
34. Client story links into reusable Atlas objects.
35. Public profile preview in claim flow.
36. Claim status tracker.
37. Subject-managed contact preference.
38. Source suppression request.
39. Alignment explanations.
40. Approximate-location label.
41. Coverage gap indicator.
42. Source density indicator.
43. Evidence pack export.
44. Print-friendly profile.
45. Mobile evidence sheet.
46. Filter summary chips.
47. Remove-all-filters control.
48. Screen-reader labels for trust states.
49. Route-level title and description metadata.
50. No-results source submission.
51. ATProto identity badge after verification.
52. Public contribution review state.
53. User-friendly issue taxonomy labels.
54. Place hierarchy breadcrumbs.
55. Profile relationship preview.
56. Sign-in prompt scoped to the current action.
57. Workspace-only actions visually separated from public actions.
58. Public API link where appropriate.
59. Date-as-of language for claims.
60. Profile steward attribution where available.

## Interfaces

The experience architecture depends on shared front-end models:

- `DiscoveryQuery`: text, recognized place, issue filters, actor types, source
  types, confidence filters, freshness filters, and sort.
- `SearchResultCard`: actor summary, match reason, trust summary, and available
  actions.
- `TrustSummary`: source count, latest source date, confidence, review state,
  freshness, disputed state, and known gaps.
- `PrimaryActionSet`: public actions, signed-in actions, workspace actions, and
  subject actions.

Back-end and generated client work must preserve these fields in public search,
profile, directory, source, and workspace APIs.

## Safety And Privacy

- Do not surface private workspace notes on public pages.
- Do not imply a person endorses an issue, organization, or show unless a
  source supports that relationship.
- Do not show precise home-like locations for people.
- Do not promote bulk export from public pages.
- Do not rank people by inferred ideology, vulnerability, or persuadability.

## Acceptance Criteria

- A first-time user can search by place and issue from the public entry point.
- A result card explains why it matched and how strongly it is supported.
- A public profile can be inspected for sources without sign-in.
- A subject can find claim and correction paths from the public profile.
- Client story and collection pages link into Atlas public objects.
- Workspace-only labels and package names do not appear in public discovery.
- Mobile users can complete search, profile inspection, claim start, and
  correction start.
