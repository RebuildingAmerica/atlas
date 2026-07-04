# Atlas UI/UX Architecture

Status: Draft
Date: 2026-07-04
Owner: Rebuilding America Project

## Purpose

This document defines the full Atlas product experience if the current product
suite is implemented. It is not a sitemap. Routes are implementation details.
The architecture that matters is the experience model: how a normal person
arrives, asks a civic question, trusts what they see, explores related people
and organizations, and takes a useful next action.

Atlas is the civic discovery platform. Rebuilding America is a flagship client
and reference implementation built on Atlas. Other shows, newsrooms,
documentary projects, nonprofits, civic educators, and public directories should
be able to use the same product primitives without inheriting Rebuilding
America-specific assumptions.

## Experience Thesis

Atlas should feel like a calm, source-backed civic discovery environment.

It should not feel like:

- A CRM.
- A research operations dashboard.
- A generic enterprise SaaS app.
- A raw database browser.
- A sponsor-controlled microsite platform.
- A show-only companion site.

The core product loop is:

```text
Ask a civic question
  -> Atlas interprets place, issue, actor, and source intent
  -> User scans understandable results
  -> User opens a profile, place, issue, source, directory, or collection
  -> User inspects evidence
  -> User continues exploring or takes one clear action
```

Everything else exists to support that loop.

## Product Layers

Atlas has seven experience layers. They should be connected, but not collapsed
into one cluttered interface.

### 1. Public Discovery Shell

The public discovery shell is the front door for ordinary users.

It includes:

- Search.
- Browse.
- Results.
- Place explorer.
- Issue explorer.
- Directory explorer.
- Collection explorer.
- Profile and source entry points.

Primary user outcome: a person can find civic information without knowing Atlas
internals or being part of a workspace.

### 2. Civic Object System

Atlas is organized around reusable civic objects:

- Profiles.
- People.
- Organizations.
- Initiatives.
- Places.
- Issues.
- Sources.
- Claims.
- Evidence.
- Directories.
- Collections.

Every surface should reuse these objects instead of creating page-specific
copies. A profile in search, a collection, a directory, a workspace list, an API
response, and a Rebuilding America client experience should all point back to
the same canonical civic object.

### 3. Trust And Evidence Layer

Trust is not a page. It is a reusable layer across the whole product.

It includes:

- Trust summary.
- Source count.
- Latest source date.
- Confidence state.
- Freshness state.
- Claim support state.
- Disputed, stale, unknown, subject-provided, suppressed, and under-review
  states.
- Evidence drawer on desktop.
- Evidence sheet on mobile.
- Correction and source-submission entry points.

Primary user outcome: a person can understand why Atlas says something and how
carefully to treat it.

### 4. Action Layer

Actions should appear where they are useful, not as a giant command center.

Public actions:

- Open profile.
- Inspect source.
- Share.
- Submit source.
- Report correction.
- Claim profile.
- Search related place or issue.

Signed-in personal actions:

- Follow.
- Save.
- Manage identity.
- Track submitted corrections or claims.

Workspace actions:

- Add to list.
- Add note.
- Start brief.
- Watch.
- Add to coverage.
- Export.

Workspace actions must be visually secondary on public pages and hidden from
signed-out users unless they are useful as a scoped sign-in prompt.

### 5. Collections And Story Experiences Layer

Collections are reusable, source-linked civic story experiences built from
Atlas objects.

They include:

- Episode companions.
- Issue guides.
- Place guides.
- Source trails.
- People and organization field guides.
- Timelines.
- Map stories.
- Public briefings.

Rebuilding America uses this layer as the first flagship client. Another show
or publisher should be able to use the same layer with different branding,
objects, templates, and editorial framing.

Primary user outcome: a person can enter through a story and keep moving into
Atlas discovery with evidence intact.

### 6. Personal Civic Layer

The personal layer is for signed-in public users.

It includes:

- Personal civic home.
- Following.
- Saved profiles or collections.
- Notification preferences.
- Identity settings.
- Claim and correction status.

It should feel like keeping track of civic life the user cares about, not
monitoring people.

### 7. Workspace And Operator Layer

The workspace layer is a private utility layer for teams. The operator layer is
for Atlas review, safety, and governance.

Workspace includes:

- Research.
- Briefs.
- Lists.
- Coverage.
- Watching.
- Activity.
- Organization settings.

Operator includes:

- Claim review.
- Correction review.
- Source submission review.
- Suppression review.
- Safety flags.
- Federation records.
- Profile merge and taxonomy maintenance.

Primary user outcome: teams and reviewers can improve source-backed civic
outputs without turning the public product into a back-office console.

## Primary Public Shell

The public product should use one dominant shell:

```text
Atlas mark and compact public nav
Global search
Recognized context chips
Main object or result area
Trust and evidence layer
Contextual actions
```

The public top navigation should stay small:

- Search.
- Browse.
- Places.
- Issues.
- Directories.
- Collections.

Profiles, sources, claims, corrections, methodology, safety, developer docs,
and settings are reachable from context, footer, search, or object pages. They
do not need to crowd the top navigation.

Rebuilding America can be featured as a client collection or branded deployment.
It should not be a permanent core Atlas navigation pillar unless the current
deployment context is specifically the Rebuilding America client experience.

## Attention Hierarchy

Every public screen should answer these questions in order:

1. What am I looking at?
2. Why is it relevant to my question?
3. How trustworthy is it?
4. What sources support it?
5. What can I do next?
6. What deeper tools exist if I need them?

If a screen leads with workspace status, account administration, package
capabilities, research operations, or internal data mechanics, it has the wrong
attention hierarchy for public Atlas.

## Screen Archetypes

### Discovery Home

The discovery home is a start surface, not a marketing homepage.

Primary elements:

- Large civic search input.
- Plain example searches.
- Place, issue, actor type, and "near me" entry points.
- Browse by place.
- Browse by issue.
- Featured collections or directories when useful.

Avoid:

- Oversized product-marketing claims.
- Sales package language.
- Internal pipeline explanations.
- A first screen that asks users to choose between many product modules.

### Search Results

Search results are the core Atlas experience.

Primary elements:

- Query interpretation bar.
- Active filter chips.
- Result list as default.
- Map toggle when geography is useful.
- Source mode when the user searches sources directly.
- No-results recovery path.

Result card anatomy:

- Name.
- Actor type.
- Place.
- Issue tags.
- Short summary.
- Match reason.
- Trust summary.
- Source count.
- Latest source date.
- Open profile.
- Inspect sources.
- Correct.
- Follow or save when signed in.

The match reason and trust summary are not decoration. They are the product
difference between Atlas and a generic database.

### Profile

A profile is a civic identity page with receipts.

Recommended anatomy:

1. Header: name, actor type, place, issues, trust summary, claim state, primary
   action.
2. About: concise description and subject-managed fields when available.
3. Civic work: source-backed activities, initiatives, roles, and focus areas.
4. Evidence: grouped source receipts and claim support.
5. Connections: related actors, organizations, initiatives, places, and issues.
6. Contact: public contact or subject-preferred channel when safe.
7. Stewardship: claim state, correction path, and profile history signals.

The first screen should answer who this is, what civic work they are connected
to, where, on what evidence, and what the user can safely do next.

### Place And Issue Explorer

The explorer helps a user understand a civic landscape.

Primary elements:

- Place or issue header.
- Plain-language definition or summary.
- Coverage and trust state.
- Search within current context.
- List view.
- Map view when useful.
- Actor groups.
- Related places and issues.
- Coverage gaps.
- Source submission path.

Map/list parity is required. The user must be able to use the explorer without
the map.

### Evidence Drawer Or Sheet

Evidence should open in place on desktop and in a full-height sheet on mobile.

Primary elements:

- Claim or profile context.
- Supporting source.
- Publisher.
- Published or observed date.
- Retrieved date.
- Confidence.
- Review state.
- Staleness.
- Open original source.
- Report source issue.

Unknown, stale, disputed, and single-source states are legitimate states. They
should be visible, calm, and understandable.

### Collection Experience

Collections are interactive civic stories built from Atlas objects.

Recommended anatomy:

1. Collection header: title, client/steward, collection type, place, issue,
   source and trust summary, primary exploration action.
2. Story frame: short editorial context and optional chapters.
3. Civic object sections: people, organizations, initiatives, places, issues,
   and sources.
4. Interactive modules: map/list, timeline, source trail, related actors, and
   follow-up searches.
5. Trust layer: evidence drawer, source states, claim support, disputed or stale
   markers.
6. Action layer: open profile, inspect source, follow, submit source, report
   correction, claim profile, or continue search.

Collections should feel editorial and exploratory without breaking the Atlas
trust model. The story can have voice. The evidence cannot become optional.

### Collection Builder

The builder is for producers, publishers, and client teams.

It should feel like a source-aware story builder, not a generic CMS.

Builder flow:

1. Create collection.
2. Choose collection type.
3. Add client/steward, place, issue, and summary.
4. Add Atlas objects.
5. Add narrative cards.
6. Arrange modules.
7. Review evidence and safety warnings.
8. Preview public page.
9. Submit for review or publish.
10. Track corrections, source submissions, and claims.

The builder must flag weak evidence, stale sources, disputed claims, high-risk
profiles, public-source gaps, and unsupported implication of endorsement.

### Personal Civic Home

The personal home is for signed-in public users.

Primary elements:

- Followed places.
- Followed issues.
- Followed profiles.
- Followed directories and collections.
- Meaningful source-backed changes.
- Saved profiles or collections.
- Mute and notification controls.

It should not use surveillance language or turn followed people into a tracking
feed.

### Workspace Home

Workspace is a separate mode for team utility.

Primary elements:

- Recent briefs.
- Lists.
- Watches.
- Coverage targets.
- Saved profiles.
- Clear next actions: search, start research, open list, open brief.

Workspace UI can be denser than public UI, but public profiles, sources, places,
issues, directories, and collections remain canonical.

## Progressive Disclosure

Atlas has many capabilities, but the UI should reveal them by context:

- Search first.
- Trust state visible immediately.
- Evidence one click away.
- Claim and correction available from the object being claimed or corrected.
- Workspace tools only after sign-in and only near relevant objects.
- Creator tools only in collection workspace.
- Operator tools only in review surfaces.

No public screen should try to show every capability.

## Navigation Rules

- Search is available from every public screen.
- Public navigation is compact.
- Object pages use contextual tabs or sections.
- Evidence opens as a drawer or sheet, not a disconnected destination.
- Related objects link to canonical Atlas pages.
- Client experiences link back to reusable Atlas objects.
- Workspace mode has its own navigation.
- Operator mode has its own navigation.
- Rebuilding America appears as a client experience, collection, or branded
  deployment, not as a hardcoded Atlas product pillar.

## Mobile Architecture

Mobile is not a reduced desktop dashboard. It is a primary Atlas experience.

Mobile priorities:

- Search input.
- Active context chips.
- Result cards.
- Evidence sheet.
- Profile summary.
- Claim and correction start.
- Map/list toggle with list parity.
- Collection story sections.
- Follow and save actions.

Filters should live in sheets. Trust states need accessible text. Long names,
source titles, and issue labels must wrap cleanly.

## Copy Rules

Atlas copy should use plain civic language.

Do:

- Say what is listed.
- Say what is known.
- Say what is disputed, stale, weak, or unknown.
- Say what the user can do next.

Do not:

- Explain internal pipelines.
- Describe collection or discovery machinery to public users.
- Use enterprise labels in public discovery.
- Overstate coverage.
- Hide uncertainty.
- Treat sponsor or client framing as evidence.

## Relationship To Rebuilding America

Rebuilding America should prove that Atlas can power excellent interactive
civic storytelling. It should not define the boundaries of Atlas.

Correct relationship:

```text
Atlas core graph
  -> Atlas public discovery
  -> Atlas trust and evidence layer
  -> Atlas Collections
  -> Rebuilding America reference client
  -> Other shows, publishers, educators, nonprofits, and directories
```

Rebuilding America-specific brand, episode structure, editorial voice, and
distribution paths belong in client configuration and collection content. Atlas
owns the reusable civic objects, evidence model, collection templates, builder,
claim/correction flows, and safety rules.

## Implementation Implications

The product architecture implies these implementation boundaries:

- Build reusable object components before client-specific pages.
- Build the evidence layer as shared infrastructure for search, profiles,
  directories, collections, workspaces, exports, API, and MCP.
- Model collections as first-class objects.
- Treat Rebuilding America as seed content and reference configuration.
- Keep public, personal, workspace, creator, and operator shells separate.
- Preserve source and trust metadata through generated API clients and mapping
  layers.
- Do not create show-specific routes, schemas, or components where a collection
  primitive would serve the same user experience.

## Acceptance Criteria

- A first-time public user can search by place and issue, open a profile, and
  inspect evidence without understanding Atlas internals.
- Public screens prioritize civic discovery, trust, evidence, and next action
  over workspace or business concepts.
- Rebuilding America can publish collection experiences without hardcoded
  product assumptions.
- Another show or publisher can use the same collection primitives.
- Profiles, sources, places, issues, directories, collections, workspaces, APIs,
  and ATProto records reuse canonical Atlas objects.
- Workspace and operator tools improve the public product without overtaking
  the public UI.
