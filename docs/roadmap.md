# Atlas Roadmap

This document is the living source of truth for Atlas product direction
and milestones.

If another roadmap or planning document conflicts with this file, this
file wins. Files under `docs/plans/` are tactical working notes, not a
second source of truth.

## What Atlas Is Becoming

Atlas should become the trusted system of record for local civic actors,
issue ecosystems, and source-linked landscape intelligence.

Atlas can borrow from a few familiar product shapes:

- Crunchbase for structured records about actors, organizations, and ecosystems
- LinkedIn for finding who is doing what, but source-backed instead of self-promotional
- Bloomberg Terminal for local landscape intelligence
- GitHub for provenance, corrections, and stewardship
- Observability tools for tracking what changed over time

Atlas is not a copy of any one of those products. It brings those ideas
into local civic and political research.

Atlas is not just a directory. It is a research product and research
infrastructure for people who need fast, defensible, local civic
intelligence. Its lead users are local journalists, independent
creators, and small media teams. Its closest adjacent institutional
users are national nonprofits, advocacy organizations, and other civic
institutions that need to understand local ecosystems without flattening
them.

Atlas will not try to compete directly with big-tech chatbot products
inside the app. Instead, the app will focus on browse, research runs,
briefs, shortlists, watchlists, trust metadata, and workflow bridges.
Atlas will remain usable from other interfaces through MCP, agent
skills, exports, and structured APIs.

## Product Pillars

### 1. System Of Record

Atlas should be the canonical graph of:

- People
- Organizations
- Initiatives
- Campaigns
- Events
- Places
- Issues
- Sources
- Relationships between all of the above
- Changes over time

That graph should be expressed through actor profiles that are rich
enough to be genuinely useful research objects, not thin directory rows.
Those profiles are one important expression of the product, not the full
category definition.

### 2. Agent-Ready Research Infrastructure

Atlas should expose structured research capabilities and outputs that
work well from external interfaces, not just the first-party app.

### 3. Trust Layer

Atlas should make provenance, source diversity, recency, freshness,
verification, and confidence legible throughout the product.

### 4. Strategic Monitoring

Atlas should help users notice meaningful change in a place or issue
ecosystem without becoming a noisy dashboard product.

### 5. Workflow Bridge

Atlas should fit into real newsroom, creator, nonprofit, and research
workflows without duplicating large adjacent systems 1:1.

Projects and workspaces should act as the main containers for work:
grouping leads, notes, briefs, exports, and follow-up context around a
story, place, issue, or research thread.

## Primary Users

### Local Journalists And Small Media Teams

Atlas should help them:

- Find credible local voices faster
- Understand who matters in a place or issue ecosystem
- Build source-backed briefs and lead lists
- Organize reporting work into reusable projects
- Revisit a place or beat without starting over

### Independent Creators

Atlas should give serious independent producers access to local
landscape intelligence that larger organizations usually build through
manual labor, private networks, or expensive internal tooling.

Atlas should also give them lightweight workspace tools that help them
keep track of research without requiring a full newsroom stack.

### National Nonprofits, Advocacy Organizations, And Civic Institutions

Atlas should help them:

- Understand local ecosystems before outreach or partnership
- Identify credible actors, gaps, and emerging issue areas
- Avoid over-relying on national intermediaries
- Organize and share local landscape research across a team
- Feed vetted research into their existing systems

## Roadmap Rules

- Atlas will not hide its value behind an in-app chatbot shell.
- Atlas will not become a full enterprise CRM.
- Atlas will not gate basic utility for independent creators and small organizations.
- Atlas will not treat trust metadata as optional.
- Atlas will not over-specialize around Rebuilding America, even if Rebuilding America remains an important user.
- Atlas will use AI to remove manual research work.
- Atlas will expose strong structured outputs before it adds decorative AI UX.

## Status Legend

- `Done` means the milestone is materially in place.
- `Now` means the milestone is part of the current product direction and should be actively pursued next.
- `Next` means the milestone is important and likely follows the `Now` set.
- `Later` means the milestone matters, but depends on earlier work or sharper product learning.

## Milestones

### Track 1: System Of Record And Core Data Quality

#### Existing foundation

- `Done` Core entry, source, issue, and discovery-run models exist
- `Done` Public browse and entry-detail surfaces exist
- `Done` Discovery pipeline exists as the core ingestion path
- `Done` Public API exists for entities, places, sources, taxonomy, and discovery runs

#### Core milestones

- `Now` Tighten entity quality so Atlas consistently surfaces specific actors doing specific work in specific places
- `Now` Improve deduplication quality so repeated mentions strengthen trust instead of cluttering results
- `Now` Strengthen source attribution and extraction-context quality across entry pages and downstream outputs
- `Now` Define a stronger canonical actor-profile shape for people, organizations, and initiatives
- `Now` Expand support for hard-to-find but public local signals, including social and community-source patterns where feasible
- `Next` Make profile data richer, including stronger summaries, issue focus, place context, contact surface, and last-seen signals
- `Next` Model richer relationships between people, organizations, initiatives, and places
- `Next` Track stronger freshness and staleness data at both entry and source levels
- `Next` Support stronger issue, place, and source-pattern metadata for ranking and filtering
- `Later` Build more complete historical views so Atlas can show how actors and ecosystems evolve over time

### Track 2: Trust Layer

#### Core milestones

- `Now` Show provenance and source count more clearly throughout browse and detail experiences
- `Now` Add lead-quality signals such as localness, recency, source diversity, and reachability
- `Now` Make source-linked evidence easier to scan through source packets and stronger extraction-context presentation
- `Next` Add confidence states for entries and research outputs
- `Next` Distinguish source patterns such as social-only, single-source, and multi-source confirmation
- `Next` Add stronger freshness warnings and stale-data indicators
- `Next` Add lightweight verification states and review markers
- `Later` Add richer audit history for corrections, verification, and representation changes

### Track 3: Research Product Core

#### Structured research runs

- `Now` Turn the pipeline into a user-facing research engine rather than mainly a back-office ingestion path
- `Now` Ship structured research runs driven by place, issue, and research goal
- `Now` Return ranked leads, key sources, gap analysis, and a concise source-linked brief from those runs
- `Now` Make research outputs inspectable rather than magical, with clear ties back to sources and reasoning signals

#### Research artifacts

- `Now` Add shortlists for saved leads and reusable research sets
- `Now` Add lightweight private notes on entries, sources, and shortlists
- `Next` Add project-level research views that group shortlists, notes, briefs, and follow-up context around one story or research thread
- `Next` Add place briefs that summarize a local issue ecosystem in a reusable format
- `Next` Add issue briefs that summarize actors, sources, and gaps across a topic
- `Next` Add shareable evidence packs that are easy to circulate in editorial or institutional settings
- `Later` Add richer comparative research views across places or issue areas

#### Research acceleration

- `Now` Improve ranking for "who matters here" and "who should I talk to" use cases
- `Next` Add recommended lead sets for common jobs such as interview sourcing, local partner scans, or ecosystem mapping
- `Next` Surface blind spots and likely missing actor categories more explicitly
- `Later` Add stronger comparative and longitudinal analysis tools for repeat users

### Track 4: Strategic Monitoring

#### Monitoring UX

- `Now` Design monitoring as high-signal updates rather than a noisy dashboard
- `Next` Add watchlists for places
- `Next` Add watchlists for issues
- `Next` Add watchlists for actor clusters or saved research sets
- `Next` Add "what changed since last time" views
- `Next` Add digest-style monitoring outputs for tracked places and issues
- `Later` Add stronger change classification, such as new actors, stale actors, rising issues, and source-attention shifts

### Track 5: Workflow Bridge

#### Small-actor workflow support

- `Now` Add lightweight shortlist and note workflows that help small actors work without a full CRM
- `Next` Add project workspaces that help users group leads, notes, briefs, and exports around a specific reporting or research goal
- `Next` Add simple project statuses, owners, and last-updated signals
- `Next` Add stronger exports for reporters, creators, and small teams
- `Next` Add lightweight follow-up tracking where it genuinely helps smaller actors
- `Later` Add simple reusable templates for common research jobs

#### Team collaboration

- `Next` Add shared project workspaces for small newsrooms, creator teams, and nonprofit research teams
- `Next` Add team-visible notes and shared saved research objects
- `Next` Add lightweight collaboration features such as assignment, ownership, and simple activity history
- `Later` Add more structured roles and permissions where they help teams collaborate without turning Atlas into heavy enterprise software

#### Institutional workflow support

- `Next` Add team-oriented workspaces that fit existing institutional research practices
- `Next` Add spreadsheet-friendly export flows for institutional users
- `Next` Add CRM sync for selected leads, notes, and metadata
- `Next` Support pushing Atlas-vetted leads into existing newsroom or nonprofit systems
- `Later` Add deeper sync surfaces where real customer demand exists

### Track 6: Public Product And Discovery UX

#### Browse and search

- `Done` Public browse, search, and entry-detail flows exist
- `Now` Improve browse/search relevance for real research tasks, not just generic exploration
- `Now` Improve query-to-result flow for place-plus-issue use cases
- `Next` Make public entry pages more legible and persuasive as research objects
- `Next` Make it easier to pivot from a single actor to nearby actors, related issues, and relevant place context
- `Later` Add more distinctive public experiences for place-first and issue-first exploration

#### Product framing

- `Now` Present Atlas as a trusted research product, not just a directory
- `Next` Make user-facing language reflect source-linked local intelligence more clearly
- `Later` Make the public product better at showing why Atlas is uniquely useful without requiring insider context

### Track 7: Agent, API, And External Interfaces

#### Agent-ready infrastructure

- `Now` Keep Atlas usable through MCP and agent-oriented interfaces
- `Now` Make research outputs structured and machine-readable enough to be consumed well outside the app
- `Next` Add stronger research-run outputs for agent workflows
- `Next` Make key research artifacts exportable in stable formats

#### Platform surfaces

- `Done` Public API exists as a useful base layer
- `Next` Improve API support for structured research outputs and workflow bridges
- `Next` Keep API and exports focused on enabling workflows rather than becoming the primary product
- `Later` Add more platform surfaces only where they clearly reinforce the core product

### Track 8: Representation, Stewardship, And Network Effects

#### Civic-actor profiles and public records

- `Now` Make actor profiles a first-class product surface, not just a thin detail page
- `Now` Make every strong profile clearly answer who this actor is, what they do, where they operate, why they matter, and how Atlas knows
- `Next` Add stronger profile sections for related actors, issue footprint, source trail, and public contact surfaces
- `Next` Make profile pages more legible as reusable research records that can support reporting, outreach, and local ecosystem understanding
- `Later` Add richer profile history and change-over-time views

#### Organization participation

- `Next` Add claim and correction flows for organizations represented in Atlas
- `Next` Let organizations improve their public representation without undermining source-linked editorial integrity
- `Next` Add a healthier path for civic actors to suggest updates and missing context
- `Later` Add stronger stewardship patterns that improve the graph over time

#### Shared trust and contribution

- `Next` Make it easier to report stale or incorrect information
- `Next` Add healthier loops for data improvement and editorial review
- `Later` Build stronger network effects through better representation, better data quality, and better reuse over time

### Track 9: User Segmentation And Go-To-Market Support

#### Local journalists and media

- `Now` Optimize core flows for finding interview leads and understanding local issue landscapes
- `Next` Improve source packets, briefs, and exports for editorial workflows
- `Later` Add more newsroom-friendly integrations where demand is clear

#### Independent creators

- `Now` Keep the app useful without expensive infrastructure or institutional tooling
- `Next` Add high-leverage research artifacts and exports that fit solo or very small teams
- `Later` Add creator-friendly templates and reuse patterns as usage becomes clearer

#### National nonprofits, advocacy organizations, and civic institutions

- `Next` Improve place and issue briefs for local landscape understanding
- `Next` Improve trust and qualification signals for partner and ecosystem research
- `Later` Add more workflow bridges where those organizations already rely on adjacent systems

## How To Update This File

When Atlas direction changes, update this file before or alongside other
strategy docs. Keep it current enough that it can function as the
default answer to "what are we building next and why?"

When milestones move:

- Promote `Next` to `Now` when it becomes active
- Promote `Now` to `Done` when it is materially in place
- Move work to `Later` if it remains valuable but no longer belongs in the near path
- Remove milestones only when the strategy has genuinely changed

## Related Documents

- [Atlas Product Vision](./the-atlas-product.md)
- [Atlas Motivation](./design/motivation.md)
- [Atlas One-Page Strategy And Roadmap](./plans/2026-04-10-atlas-one-page-strategy-and-roadmap.md)
